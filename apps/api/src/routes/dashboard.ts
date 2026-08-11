import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { auditOutbox, credentials, folders, hosts } from '../db/schema.js';
import { auditShipperStatus } from '../lib/audit/shipper.js';
import { getSetting } from '../lib/settings.js';
import { listSessions } from '../lib/ssh/session-registry.js';
import { requireUser } from '../plugins/auth.js';
import { APP_VERSION } from '../version.js';

/**
 * Gösterge paneli özeti.
 *
 * Tek istekte toplanıyor: ana sayfa açılışında altı ayrı çağrı yapmak hem
 * yavaş hem de yükleme sırasında ekranı parça parça doldururdu.
 *
 * Sunucu "çevrimiçi mi" bilgisi için hedeflere ping ATILMIYOR — bu, envanterdeki
 * her sunucuya açılışta bağlantı denemesi demek olurdu. Bunun yerine gerçekten
 * açık olan SSH oturumları sayılıyor; kullanıcının bilmek istediği de bu.
 */
export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);

    const [counts, activity, esSettings] = await Promise.all([
      db
        .select({
          hosts: sql<number>`(
            select count(*)::int from ${hosts}
            where ${hosts.ownerId} = ${user.id} and ${hosts.ephemeral} = false
          )`,
          credentials: sql<number>`(
            select count(*)::int from ${credentials}
            where ${credentials.ownerId} = ${user.id} and ${credentials.ephemeral} = false
          )`,
          folders: sql<number>`(
            select count(*)::int from ${folders} where ${folders.ownerId} = ${user.id}
          )`,
        })
        .from(sql`(select 1) as _`),

      /**
       * Son etkinlikler denetim kuyruğundan okunuyor. Gönderilmiş satırlar bir
       * saat sonra siliniyor, dolayısıyla bu liste yalnızca yakın geçmişi
       * gösterir — uzun geçmiş için Kibana var.
       */
      db
        .select({
          action: sql<string>`${auditOutbox.payload}->'event'->>'action'`,
          outcome: sql<string>`${auditOutbox.payload}->'event'->>'outcome'`,
          serverName: sql<string | null>`${auditOutbox.payload}->'server'->>'name'`,
          at: auditOutbox.occurredAt,
        })
        .from(auditOutbox)
        .where(
          and(
            sql`${auditOutbox.payload}->'user'->>'id' = ${user.id}`,
            // Arka plan metrik komutları listeyi boğmasın.
            sql`${auditOutbox.payload}->'sshby'->>'source' = 'user'`,
          ),
        )
        .orderBy(desc(auditOutbox.occurredAt))
        .limit(20),

      getSetting('audit.elasticsearch'),
    ]);

    const sessions = listSessions(user.id);
    const shipper = auditShipperStatus();

    return {
      version: APP_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
      totals: {
        hosts: counts[0]?.hosts ?? 0,
        credentials: counts[0]?.credentials ?? 0,
        folders: counts[0]?.folders ?? 0,
      },
      sessions: {
        active: sessions.length,
        hosts: [...new Set(sessions.map((s) => s.hostId))].length,
      },
      audit: {
        enabled: esSettings.enabled,
        ok: shipper.ok,
        message: shipper.message,
      },
      activity: activity.map((row) => ({
        action: row.action,
        outcome: row.outcome,
        serverName: row.serverName,
        at: row.at.toISOString(),
      })),
    };
  });

  /** Veritabanı erişilebilir mi — panelde "sağlıklı" rozeti için. */
  app.get('/dashboard/health', { preHandler: app.requireAuth }, async () => {
    try {
      await db.execute(sql`select 1`);
      return { database: 'ok' as const };
    } catch {
      return { database: 'error' as const };
    }
  });
}
