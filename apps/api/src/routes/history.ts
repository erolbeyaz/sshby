import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { auditOutbox, hosts } from '../db/schema.js';
import { notFound, requireUuid } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';

/**
 * Komut geçmişi.
 *
 * Kaynak sunucudaki `~/.bash_history` DEĞİL, kendi denetim kaydımız. Üç
 * nedenle:
 *   - Kimin çalıştırdığı bilgisi var; bash_history yalnızca hangi hesabın
 *     altında çalıştığını bilir, sshby kullanıcısını değil.
 *   - Yapıştırılan komutlar da dahil.
 *   - Kabuk oturumu kapanmadan bash_history diske yazılmaz; canlı görüntü
 *     alınamaz.
 */

interface HistoryEntry {
  /** Kronolojik sıra numarası — bash'teki gibi 1'den başlar. */
  sequence: number;
  command: string;
  at: string;
  sessionId: string | null;
}

export async function registerHistoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/history/:hostId', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);
    const hostId = requireUuid(
      (request.params as { hostId?: string }).hostId,
      'Sunucu bulunamadı.',
    );

    const [host] = await db
      .select({ id: hosts.id, name: hosts.name })
      .from(hosts)
      .where(and(eq(hosts.id, hostId), eq(hosts.ownerId, user.id)))
      .limit(1);
    if (!host) throw notFound('Sunucu bulunamadı.');

    const limit = Math.min(Number((request.query as { limit?: string }).limit) || 500, 2000);

    /**
     * Filtreleme JSON alanları üzerinden yapılıyor: denetim olayları tek bir
     * `payload` sütununda duruyor ve şeması ECS'e bağlı. Ayrı bir "komutlar"
     * tablosu tutmak aynı veriyi iki yerde saklamak olurdu.
     *
     * `source = 'user'` koşulu şart: metrik toplayıcının arka planda çalıştırdığı
     * komutlar da denetime düşüyor ve kullanıcının geçmişini boğardı.
     */
    const rows = await db
      .select({
        command: sql<string>`${auditOutbox.payload}->'sshby'->>'command'`,
        at: auditOutbox.occurredAt,
        sessionId: sql<string | null>`${auditOutbox.payload}->'sshby'->>'session_id'`,
      })
      .from(auditOutbox)
      .where(
        and(
          sql`${auditOutbox.payload}->'event'->>'action' = 'ssh.command'`,
          sql`${auditOutbox.payload}->'sshby'->>'source' = 'user'`,
          sql`${auditOutbox.payload}->'user'->>'id' = ${user.id}`,
          sql`${auditOutbox.payload}->'server'->>'host_id' = ${hostId}`,
        ),
      )
      .orderBy(desc(auditOutbox.occurredAt))
      .limit(limit);

    // Sorgu en yeniden eskiye; numaralandırma kronolojik olmalı.
    const chronological = [...rows].reverse();
    const entries: HistoryEntry[] = chronological.map((row, index) => ({
      sequence: index + 1,
      command: row.command ?? '',
      at: row.at.toISOString(),
      sessionId: row.sessionId,
    }));

    return { hostId: host.id, hostName: host.name, entries };
  });
}
