import { buildApp } from './app.js';
import { closeDatabase } from './db/client.js';
import { env } from './env.js';
import { startAuditShipper, stopAuditShipper } from './lib/audit/shipper.js';
import { logger } from './lib/logger.js';
import { APP_VERSION } from './version.js';

async function main(): Promise<void> {
  const app = await buildApp();

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ version: APP_VERSION, port: env.PORT }, 'sshby-api ayakta');

  // Denetim göndericisi: audit_outbox → Elasticsearch. ES kapalıysa hiçbir şey
  // yapmaz; ayar açıldığı anda kuyruğu boşaltmaya başlar.
  startAuditShipper();

  /**
   * Zarif kapanış. Terminal oturumları uzun ömürlü olduğu için Fastify'ın
   * `close()` çağrısı açık WebSocket'lerin kapanmasını bekler; Helm chart'ında
   * `terminationGracePeriodSeconds` bunu karşılayacak kadar yüksek tutuluyor.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Kapanış başladı');
    try {
      stopAuditShipper();
      await app.close();
      await closeDatabase();
      logger.info('Kapanış tamamlandı');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Kapanışta hata');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Sunucu başlatılamadı');
  process.exit(1);
});
