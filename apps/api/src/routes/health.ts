import type { FastifyInstance } from 'fastify';
import { pingDatabase } from '../db/client.js';
import { APP_VERSION } from '../version.js';

/**
 * Kubernetes probe'ları:
 *  - /healthz (liveness) hiçbir bağımlılığa bakmaz. Veritabanı düştüğünde
 *    pod'ların yeniden başlatılmasını istemiyoruz — bu sorunu çözmez, sadece
 *    yeniden başlatma fırtınası yaratır.
 *  - /readyz (readiness) veritabanına bakar; DB yoksa pod trafikten çekilir.
 */
export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', { logLevel: 'warn' }, async () => ({
    status: 'ok' as const,
    version: APP_VERSION,
    uptimeSeconds: Math.floor(process.uptime()),
  }));

  app.get('/readyz', { logLevel: 'warn' }, async (_request, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await pingDatabase();
      checks.database = { ok: true };
    } catch (err) {
      checks.database = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }

    const ready = Object.values(checks).every((c) => c.ok);
    return reply.status(ready ? 200 : 503).send({
      status: ready ? ('ready' as const) : ('not_ready' as const),
      checks,
    });
  });
}
