import { Agent, fetch as undiciFetch, type RequestInit } from 'undici';
import { auditIndexName, type AuditEvent } from '@sshby/shared';
import type { ElasticsearchSettings } from '../settings.js';

/**
 * Elasticsearch istemcisi.
 *
 * `@elastic/elasticsearch` yerine düz HTTP kullanılıyor. İhtiyacımız yalnızca
 * iki uç: `_bulk` ve sağlık kontrolü. Resmî istemci bunun için birkaç megabayt
 * bağımlılık, kendi yeniden deneme mantığı (bizimkiyle çakışır) ve sürüm
 * uyumluluk kontrolü getiriyor — sonuncusu OpenSearch gibi çatallarda bağlantıyı
 * tamamen reddediyor. Düz HTTP hem hafif hem de ES 7/8 ve OpenSearch ile
 * çalışıyor.
 */

export interface EsResult {
  ok: boolean;
  /** Kullanıcıya gösterilebilir Türkçe açıklama. */
  message: string;
  /** Kısmi başarıda: kabul edilmeyen belge sayısı. */
  rejected?: number;
}

/**
 * TLS ayarları isteğe göre değiştiği için her çağrıda değil, ayar imzası
 * değiştiğinde yeni agent kuruluyor — her istekte yeni TLS bağlamı yaratmak
 * pahalı.
 */
let cachedAgent: { key: string; agent: Agent } | null = null;

function agentFor(settings: ElasticsearchSettings): Agent | undefined {
  if (!settings.caCert && !settings.insecureSkipTlsVerify) return undefined;

  const key = `${settings.caCert ?? ''}|${settings.insecureSkipTlsVerify}`;
  if (cachedAgent?.key === key) return cachedAgent.agent;

  cachedAgent?.agent.close().catch(() => undefined);
  const agent = new Agent({
    connect: {
      ...(settings.caCert ? { ca: settings.caCert } : {}),
      // Yalnızca kurulum aşaması için; UI bunu açıkça uyarı ile gösteriyor.
      ...(settings.insecureSkipTlsVerify ? { rejectUnauthorized: false } : {}),
    },
  });
  cachedAgent = { key, agent };
  return agent;
}

function authHeader(settings: ElasticsearchSettings): Record<string, string> {
  if (settings.auth.type === 'basic') {
    const token = Buffer.from(`${settings.auth.username}:${settings.auth.password}`).toString(
      'base64',
    );
    return { authorization: `Basic ${token}` };
  }
  if (settings.auth.type === 'apiKey') {
    return { authorization: `ApiKey ${settings.auth.apiKey}` };
  }
  return {};
}

/** Ağ/TLS hatalarını kullanıcıya anlamlı Türkçeye çevirir. */
function describeError(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code ?? (err as { code?: string }).code;
  const message = err instanceof Error ? err.message : String(err);

  if (code === 'ENOTFOUND') return 'Adres çözümlenemedi. Düğüm adresini kontrol edin.';
  if (code === 'ECONNREFUSED') return 'Bağlantı reddedildi. Elasticsearch çalışmıyor olabilir.';
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') {
    return 'Bağlantı zaman aşımına uğradı. Ağ erişimini kontrol edin.';
  }
  if (code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return 'TLS sertifikası doğrulanamadı. CA sertifikasını girin ya da sertifikayı düzeltin.';
  }
  if (code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
    return 'Sunucu kendinden imzalı sertifika kullanıyor. CA sertifikasını girin.';
  }
  return `Bağlantı kurulamadı: ${message}`;
}

async function request(
  settings: ElasticsearchSettings,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const node = settings.nodes[0];
  if (!node) throw new Error('Elasticsearch düğümü tanımlı değil');

  const url = `${node.replace(/\/+$/, '')}${path}`;
  return (await undiciFetch(url, {
    ...init,
    dispatcher: agentFor(settings),
    headers: { ...authHeader(settings), ...(init.headers as Record<string, string>) },
    // Askıda kalan bir istek gönderme döngüsünü kilitlemesin.
    signal: AbortSignal.timeout(15_000),
  })) as unknown as Response;
}

/** Admin ekranındaki "bağlantıyı test et" düğmesi. */
export async function testConnection(settings: ElasticsearchSettings): Promise<EsResult> {
  if (settings.nodes.length === 0) {
    return { ok: false, message: 'En az bir düğüm adresi girin.' };
  }

  try {
    const response = await request(settings, '/');
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'Kimlik doğrulama reddedildi. Kullanıcı/parola ya da API anahtarını kontrol edin.' };
    }
    if (!response.ok) {
      return { ok: false, message: `Sunucu ${response.status} döndü.` };
    }

    const body = (await response.json()) as {
      version?: { number?: string; distribution?: string };
      cluster_name?: string;
    };
    const distribution = body.version?.distribution ?? 'elasticsearch';
    return {
      ok: true,
      message: `Bağlantı başarılı — ${distribution} ${body.version?.number ?? '?'} (${body.cluster_name ?? 'küme adı yok'})`,
    };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

/**
 * Olayları bulk API ile gönderir.
 *
 * Dönen sonuç "hepsi ya da hiçbiri" değil: ES tek tek belge reddedebilir
 * (eşleme çakışması gibi). Reddedilen belgeyi sonsuza kadar yeniden denemek
 * kuyruğu tıkar, bu yüzden bulk çağrısı ağ düzeyinde başarılıysa kayıtlar
 * gönderilmiş sayılır ve reddedilenler loglanır.
 */
export async function sendBulk(
  settings: ElasticsearchSettings,
  events: AuditEvent[],
): Promise<EsResult> {
  if (events.length === 0) return { ok: true, message: 'gönderilecek olay yok' };

  const lines: string[] = [];
  for (const event of events) {
    const index = auditIndexName(settings.indexPrefix, new Date(event['@timestamp']));
    lines.push(JSON.stringify({ create: { _index: index } }));
    lines.push(JSON.stringify(event));
  }
  // Bulk gövdesi satır sonuyla BİTMELİ; eksikse ES son satırı yok sayar.
  const body = `${lines.join('\n')}\n`;

  try {
    const response = await request(settings, '/_bulk', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-ndjson' },
    });

    if (!response.ok) {
      return { ok: false, message: `Bulk isteği ${response.status} döndü.` };
    }

    const result = (await response.json()) as {
      errors?: boolean;
      items?: { create?: { status: number; error?: { reason?: string } } }[];
    };

    if (!result.errors) return { ok: true, message: `${events.length} olay gönderildi` };

    const rejected = (result.items ?? []).filter(
      (item) => (item.create?.status ?? 200) >= 300,
    );
    return {
      ok: true,
      rejected: rejected.length,
      message: `${events.length - rejected.length} olay gönderildi, ${rejected.length} reddedildi: ${
        rejected[0]?.create?.error?.reason ?? 'sebep bildirilmedi'
      }`,
    };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

/**
 * Saklama süresi için ILM politikası ve indeks şablonu kurar.
 *
 * Şablon, gönderici indeksleri kendiliğinden yarattığı için gerekli: politika
 * indekse ancak oluşturulurken bağlanabiliyor.
 */
export async function applyRetention(settings: ElasticsearchSettings): Promise<EsResult> {
  if (settings.retentionDays <= 0) {
    return { ok: true, message: 'Saklama süresi kapalı, ILM kurulmadı.' };
  }

  const policyName = `${settings.indexPrefix}-retention`;
  try {
    const policy = await request(settings, `/_ilm/policy/${policyName}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        policy: {
          phases: {
            hot: { actions: { rollover: { max_age: '1d' } } },
            delete: { min_age: `${settings.retentionDays}d`, actions: { delete: {} } },
          },
        },
      }),
    });

    if (!policy.ok) {
      /**
       * ILM Elastic'e özgü; OpenSearch'te uç yok. Bu durumda saklama
       * politikasını kullanıcının kendisi kurmalı — sessizce başarılı
       * saymıyoruz.
       */
      return {
        ok: false,
        message:
          policy.status === 400 || policy.status === 404
            ? 'ILM bu sunucuda desteklenmiyor (OpenSearch olabilir). Saklama süresini kendiniz yapılandırın.'
            : `ILM politikası kurulamadı (${policy.status}).`,
      };
    }

    const template = await request(settings, `/_index_template/${settings.indexPrefix}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        index_patterns: [`${settings.indexPrefix}-*`],
        template: { settings: { 'index.lifecycle.name': policyName } },
      }),
    });

    return template.ok
      ? { ok: true, message: `Saklama süresi ${settings.retentionDays} gün olarak ayarlandı.` }
      : { ok: false, message: `İndeks şablonu kurulamadı (${template.status}).` };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}
