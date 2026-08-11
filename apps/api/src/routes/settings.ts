import { isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { auditOutbox } from '../db/schema.js';
import { emitAudit } from '../lib/audit.js';
import { applyRetention, testConnection } from '../lib/audit/elasticsearch.js';
import { auditShipperStatus } from '../lib/audit/shipper.js';
import {
  elasticsearchSettingsSchema,
  getSetting,
  registrationSettingsSchema,
  setSetting,
  type ElasticsearchSettings,
} from '../lib/settings.js';
import { requireUser } from '../plugins/auth.js';

/**
 * Çalışma zamanı ayarları.
 *
 * Her değişiklik denetime yazılır; ayar DEĞERLERİ değil yalnızca anahtarı
 * kaydedilir, çünkü gizli veri (ES parolası, API anahtarı) taşıyorlar.
 */

/** Gizli alanları maskeler — ayarları okurken parola geri dönmemeli. */
function maskElasticsearch(settings: ElasticsearchSettings) {
  return {
    ...settings,
    auth:
      settings.auth.type === 'basic'
        ? { type: 'basic' as const, username: settings.auth.username, password: '' }
        : settings.auth.type === 'apiKey'
          ? { type: 'apiKey' as const, apiKey: '' }
          : settings.auth,
    /** Parola/anahtarın kayıtlı olup olmadığını UI'ın bilmesi gerekiyor. */
    hasSecret: settings.auth.type !== 'none',
  };
}

/**
 * Boş bırakılan gizli alanı "değiştirme" olarak yorumlar.
 *
 * UI parolayı hiç görmediği için formu geri gönderdiğinde alan boş gelir;
 * bunu "parolayı sil" saymak, ayarı her kaydedişte kimlik doğrulamayı
 * bozardı.
 */
function mergeSecrets(
  incoming: ElasticsearchSettings,
  existing: ElasticsearchSettings,
): ElasticsearchSettings {
  if (incoming.auth.type === 'basic' && incoming.auth.password === '') {
    if (existing.auth.type === 'basic') {
      return { ...incoming, auth: { ...incoming.auth, password: existing.auth.password } };
    }
  }
  if (incoming.auth.type === 'apiKey' && incoming.auth.apiKey === '') {
    if (existing.auth.type === 'apiKey') {
      return { ...incoming, auth: { ...incoming.auth, apiKey: existing.auth.apiKey } };
    }
  }
  return incoming;
}

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings/registration', { preHandler: app.requireAdmin }, async () =>
    getSetting('registration'),
  );

  app.put('/settings/registration', { preHandler: app.requireAdmin }, async (request) => {
    const actor = requireUser(request);
    const body = registrationSettingsSchema.parse(request.body);
    const saved = await setSetting('registration', body, actor.id);

    await emitAudit({
      action: 'settings.change',
      actor,
      request,
      settingKey: 'registration',
      detail: { open: saved.open, domainCount: saved.allowedEmailDomains.length },
    });

    return saved;
  });

  // ------------------------------------------------------- Elasticsearch

  app.get('/settings/elasticsearch', { preHandler: app.requireAdmin }, async () =>
    maskElasticsearch(await getSetting('audit.elasticsearch')),
  );

  app.put('/settings/elasticsearch', { preHandler: app.requireAdmin }, async (request) => {
    const actor = requireUser(request);
    const incoming = elasticsearchSettingsSchema.parse(request.body);
    const existing = await getSetting('audit.elasticsearch');
    const saved = await setSetting(
      'audit.elasticsearch',
      mergeSecrets(incoming, existing),
      actor.id,
    );

    await emitAudit({
      action: 'settings.change',
      actor,
      request,
      settingKey: 'audit.elasticsearch',
      // Gizli veri değil, yalnızca yapılandırmanın şekli denetime düşüyor.
      detail: {
        enabled: saved.enabled,
        nodeCount: saved.nodes.length,
        authType: saved.auth.type,
        indexPrefix: saved.indexPrefix,
        retentionDays: saved.retentionDays,
        insecureSkipTlsVerify: saved.insecureSkipTlsVerify,
      },
    });

    return maskElasticsearch(saved);
  });

  /**
   * Bağlantı testi kaydedilmiş ayarla değil, GÖNDERİLEN ayarla çalışır:
   * kullanıcı kaydetmeden önce denemek istiyor. Boş bırakılan gizli alanlar
   * kayıtlı değerle tamamlanır.
   */
  app.post('/settings/elasticsearch/test', { preHandler: app.requireAdmin }, async (request) => {
    const incoming = elasticsearchSettingsSchema.parse(request.body);
    const existing = await getSetting('audit.elasticsearch');
    return testConnection(mergeSecrets(incoming, existing));
  });

  /** ILM politikası ve indeks şablonunu kurar. */
  app.post('/settings/elasticsearch/retention', { preHandler: app.requireAdmin }, async (request) => {
    const actor = requireUser(request);
    const settings = await getSetting('audit.elasticsearch');
    const result = await applyRetention(settings);

    await emitAudit({
      action: 'settings.change',
      actor,
      request,
      settingKey: 'audit.elasticsearch.retention',
      outcome: result.ok ? 'success' : 'failure',
      detail: { retentionDays: settings.retentionDays },
    });

    return result;
  });

  /** Gönderici durumu — admin ekranı bunu gösteriyor. */
  app.get('/settings/elasticsearch/status', { preHandler: app.requireAdmin }, async () => {
    const [pending] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditOutbox)
      .where(isNull(auditOutbox.shippedAt));

    return { ...auditShipperStatus(), pendingCount: pending?.count ?? 0 };
  });
}
