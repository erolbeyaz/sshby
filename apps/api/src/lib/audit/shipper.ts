import { and, asc, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { auditEventSchema, type AuditEvent } from '@sshby/shared';
import { db } from '../../db/client.js';
import { auditOutbox } from '../../db/schema.js';
import { env } from '../../env.js';
import { logger } from '../logger.js';
import { getSetting } from '../settings.js';
import { sendBulk } from './elasticsearch.js';

/**
 * Denetim göndericisi: `audit_outbox` → Elasticsearch.
 *
 * Outbox deseni bilinçli. Denetim yazımı kullanıcının işlemini bloklamamalı ama
 * olay da kaybolmamalı; olayı önce aynı veritabanına yazıp ayrı bir döngüde
 * taşımak ikisini birden sağlıyor. ES kapalıyken kayıtlar birikir, ES geri
 * geldiğinde hiçbir şey kaybetmeden akar.
 *
 * Tek kopya varsayımı YOK: birden çok API kopyası aynı kuyruğu işleyebilsin
 * diye satırlar `for update skip locked` ile kilitleniyor.
 */

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Son turun sonucu — sağlık ucu ve katı mod bunu okuyor. */
let lastResult: { at: number; ok: boolean; message: string } = {
  at: 0,
  ok: true,
  message: 'henüz çalışmadı',
};

export function auditShipperStatus(): typeof lastResult & { pendingUnknown: boolean } {
  return { ...lastResult, pendingUnknown: lastResult.at === 0 };
}

/**
 * Üstel geri çekilme: 5sn, 10sn, 20sn… en fazla 10 dakika.
 *
 * Sınır olmadan bir gecelik kesintiden sonra ilk denemeyi günler sonra
 * yapardık; 10 dakika, ES geri geldiğinde makul sürede yakalamayı sağlıyor.
 */
function backoffSeconds(attempts: number): number {
  return Math.min(5 * 2 ** attempts, 600);
}

/**
 * Gönderilmiş satırları siler.
 *
 * `shipped_at` işaretlemek yetmiyor: tablo süresiz büyür ve gönderici her
 * turda daha fazla satırın üzerinden geçer.
 *
 * Ama saklama süresi kısa da olamaz. `audit_outbox` yalnızca bir kuyruk değil,
 * aynı zamanda **yerel denetim deposu**: komut geçmişi paneli ve gösterge
 * panelindeki son etkinlikler buradan okuyor ve Elasticsearch açık olmayan
 * kurulumlarda başka kaynak yok. Bu yüzden varsayılan 30 gün (bkz.
 * `AUDIT_RETAIN_SHIPPED_MS`); uzun vadeli arşiv Elasticsearch'ün işi.
 */
async function pruneShipped(): Promise<void> {
  const cutoff = new Date(Date.now() - env.AUDIT_RETAIN_SHIPPED_MS);
  const deleted = await db
    .delete(auditOutbox)
    .where(and(isNotNull(auditOutbox.shippedAt), lt(auditOutbox.shippedAt, cutoff)))
    .returning({ id: auditOutbox.id });

  if (deleted.length > 0) {
    logger.debug({ count: deleted.length }, 'Gönderilmiş denetim satırları temizlendi');
  }
}

async function flushOnce(): Promise<void> {
  const settings = await getSetting('audit.elasticsearch');
  if (!settings.enabled || settings.nodes.length === 0) {
    lastResult = { at: Date.now(), ok: true, message: 'Elasticsearch kapalı' };
    return;
  }

  /**
   * `skip locked`: başka bir kopya aynı satırları işliyorsa bekleme, sıradakine
   * geç. Bu olmadan iki kopya aynı olayı iki kez gönderebilir ya da birbirini
   * bloklardı.
   */
  const rows = await db.transaction(async (tx) => {
    const selected = await tx
      .select({ id: auditOutbox.id, payload: auditOutbox.payload, attempts: auditOutbox.attempts })
      .from(auditOutbox)
      .where(and(isNull(auditOutbox.shippedAt), lte(auditOutbox.nextAttemptAt, new Date())))
      .orderBy(asc(auditOutbox.occurredAt))
      .limit(env.AUDIT_BULK_SIZE)
      .for('update', { skipLocked: true });

    return selected;
  });

  if (rows.length === 0) {
    lastResult = { at: Date.now(), ok: true, message: 'kuyruk boş' };
    // Kuyruk boşken temizlik için uygun an; yoğunken gönderimi geciktirmeyelim.
    await pruneShipped();
    return;
  }

  /**
   * Bozuk bir olay kuyruğu sonsuza kadar tıkamamalı. Şemaya uymayan satırı
   * gönderilmiş sayıp hatasını yazıyoruz — yeniden denemek her turda aynı
   * hatayı üretirdi.
   */
  const valid: { id: string; event: AuditEvent }[] = [];
  const invalid: string[] = [];

  for (const row of rows) {
    const parsed = auditEventSchema.safeParse(row.payload);
    if (parsed.success) valid.push({ id: row.id, event: parsed.data });
    else invalid.push(row.id);
  }

  if (invalid.length > 0) {
    logger.error({ count: invalid.length }, 'Şemaya uymayan denetim olayları atlandı');
    await db
      .update(auditOutbox)
      .set({ shippedAt: new Date(), lastError: 'şema doğrulaması başarısız' })
      .where(sql`${auditOutbox.id} in ${invalid}`);
  }

  if (valid.length === 0) return;

  const result = await sendBulk(
    settings,
    valid.map((v) => v.event),
  );
  const ids = valid.map((v) => v.id);

  if (result.ok) {
    await db
      .update(auditOutbox)
      .set({ shippedAt: new Date(), lastError: null })
      .where(sql`${auditOutbox.id} in ${ids}`);

    lastResult = { at: Date.now(), ok: true, message: result.message };
    if (result.rejected) {
      logger.warn({ rejected: result.rejected }, 'Bazı denetim olayları ES tarafından reddedildi');
    }
    return;
  }

  // Başarısız: deneme sayısını artır, bir sonraki denemeyi ötele.
  const attempts = (rows[0]?.attempts ?? 0) + 1;
  const nextAttemptAt = new Date(Date.now() + backoffSeconds(attempts) * 1000);

  await db
    .update(auditOutbox)
    .set({
      attempts: sql`${auditOutbox.attempts} + 1`,
      lastError: result.message.slice(0, 500),
      nextAttemptAt,
    })
    .where(sql`${auditOutbox.id} in ${ids}`);

  lastResult = { at: Date.now(), ok: false, message: result.message };
  logger.warn({ err: result.message, retryInSeconds: backoffSeconds(attempts) },
    'Denetim gönderimi başarısız, yeniden denenecek');
}

export function startAuditShipper(): void {
  if (timer) return;

  const tick = (): void => {
    // Önceki tur bitmediyse üst üste binme — yavaş bir ES turu kuyruğu çoğaltmasın.
    if (running) return;
    running = true;
    void flushOnce()
      .catch((err: unknown) => {
        lastResult = { at: Date.now(), ok: false, message: 'gönderici hatası' };
        logger.error({ err }, 'Denetim göndericisi beklenmeyen hata');
      })
      .finally(() => {
        running = false;
      });
  };

  timer = setInterval(tick, env.AUDIT_FLUSH_INTERVAL_MS);
  // Kapanışı bu zamanlayıcı geciktirmesin.
  timer.unref();
  logger.info({ intervalMs: env.AUDIT_FLUSH_INTERVAL_MS }, 'Denetim göndericisi başladı');
}

export function stopAuditShipper(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/**
 * Katı mod: denetim ES'e yazılamıyorsa yeni SSH oturumu açılmasına izin verme.
 *
 * "Kayıt tutulamıyorsa bağlanma" politikası olan ortamlar için. Kapalıyken
 * (varsayılan) denetim aksasa bile bağlantı kurulur; olaylar kuyrukta bekler.
 */
export async function assertAuditHealthy(): Promise<void> {
  if (!env.AUDIT_STRICT_MODE) return;

  const settings = await getSetting('audit.elasticsearch');
  if (!settings.enabled) return;

  if (!lastResult.ok) {
    const { serviceUnavailable } = await import('../errors.js');
    throw serviceUnavailable(
      'audit_unavailable',
      `Denetim kaydı Elasticsearch'e yazılamıyor, bu yüzden yeni oturum açılamıyor: ${lastResult.message}`,
    );
  }
}
