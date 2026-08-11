import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { auditIndexName, type BootstrapInfo } from '@sshby/shared';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { getSetting } from '../lib/settings.js';

/**
 * Giriş ekranının oturum açmadan önce ihtiyaç duyduğu bilgiler. Kasıtlı olarak
 * kimlik doğrulamasız: hangi bilgiler burada duruyorsa anonim bir istemciye
 * açık demektir, o yüzden yalnızca UI'ın davranışını belirleyen bayraklar var.
 */
export async function registerBootstrapRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/bootstrap',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (): Promise<BootstrapInfo> => {
      const rows = await db.select({ count: sql<number>`count(*)::int` }).from(users);
      const firstRun = (rows[0]?.count ?? 0) === 0;

      const [registration, elastic] = await Promise.all([
        getSetting('registration'),
        getSetting('audit.elasticsearch'),
      ]);

      return {
        // İlk çalıştırmada kayıt her zaman açık — yoksa kimse admin olamaz.
        registrationOpen: firstRun || registration.open,
        firstRun,
        auditEnabled: elastic.enabled,
        auditIndexPattern: elastic.enabled ? auditIndexName(elastic.indexPrefix) : null,
        oidcEnabled: false,
      };
    },
  );
}
