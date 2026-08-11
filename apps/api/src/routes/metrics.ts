import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { MetricsSnapshot } from '@sshby/shared';
import { db } from '../db/client.js';
import { hosts } from '../db/schema.js';
import { emitAudit } from '../lib/audit.js';
import { notFound, requireUuid } from '../lib/errors.js';
import { collectMetrics } from '../lib/ssh/metrics.js';
import { getSshClient } from '../lib/ssh/sftp.js';
import { requireUser } from '../plugins/auth.js';

export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/metrics/:hostId',
    { preHandler: app.requireAuth },
    async (request): Promise<MetricsSnapshot> => {
      const user = requireUser(request);
      const hostId = requireUuid(
        (request.params as { hostId?: string }).hostId,
        'Sunucu bulunamadı.',
      );

      const [host] = await db
        .select()
        .from(hosts)
        .where(and(eq(hosts.id, hostId), eq(hosts.ownerId, user.id)))
        .limit(1);
      if (!host) throw notFound('Sunucu bulunamadı.');

      const client = await getSshClient(user.id, hostId);
      const snapshot = await collectMetrics(client);

      /**
       * `source: 'system'` — bu komutları kullanıcı yazmadı, pano topladı.
       * İşaretlemezsek beş saniyede bir çalışan metrik komutları denetim
       * ekranında kullanıcının gerçek komutlarını boğardı.
       */
      await emitAudit({
        action: 'ssh.command',
        source: 'system',
        actor: user,
        request,
        server: {
          host_id: host.id,
          name: host.name,
          hostname: host.hostname,
          port: host.port,
        },
        command: 'metrik toplama',
      });

      return snapshot;
    },
  );
}
