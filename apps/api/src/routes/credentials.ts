import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  createCredentialSchema,
  updateCredentialSchema,
  type CredentialSummary,
} from '@sshby/shared';
import { db } from '../db/client.js';
import { credentials, hosts, type CredentialRow } from '../db/schema.js';
import { emitAudit } from '../lib/audit.js';
import { sealSecret, type CredentialSecret } from '../lib/credentials.js';
import { fingerprintPrivateKey } from '../lib/crypto/ssh-key.js';
import { conflict, notFound, requireUuid } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';

/** Yanıt biçimi — gizli alanlar bilinçli olarak dışarıda. */
function toSummary(row: CredentialRow, usedByHostCount: number): CredentialSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    username: row.username,
    publicFingerprint: row.publicFingerprint,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    usedByHostCount,
  };
}

/** Anahtar tipi credential'da parmak izi hesaplanır; parolada anlamsız. */
function fingerprintFor(secret: CredentialSecret): string | null {
  return secret.type === 'key'
    ? fingerprintPrivateKey(secret.privateKey, secret.passphrase)
    : null;
}

export async function registerCredentialRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/credentials',
    { preHandler: app.requireAuth },
    async (request): Promise<CredentialSummary[]> => {
      const user = requireUser(request);

      /**
       * Kullanım sayısı LEFT JOIN + GROUP BY ile alınıyor, ilişkili alt sorguyla
       * değil.
       *
       * Alt sorgu biçiminde Drizzle sütunları tablo adıyla nitelemiyordu
       * (`where "credential_id" = "id"`); içteki `"id"` dıştaki credentials
       * yerine hosts tablosuna bağlanıyor ve sayı her zaman 0 çıkıyordu.
       * JOIN kullanıldığında niteleme garanti.
       */
      const rows = await db
        .select({
          credential: credentials,
          usedBy: sql<number>`count(${hosts.id})::int`,
        })
        .from(credentials)
        .leftJoin(hosts, eq(hosts.credentialId, credentials.id))
        // Geçici (hızlı bağlantı) kayıtları kasada göstermiyoruz.
        .where(and(eq(credentials.ownerId, user.id), eq(credentials.ephemeral, false)))
        // Birincil anahtara göre grupla: Postgres tablonun diğer sütunlarını
        // fonksiyonel bağımlılıkla kabul eder, hepsini tek tek yazmaya gerek yok.
        .groupBy(credentials.id)
        .orderBy(asc(credentials.name));

      return rows.map((r) => toSummary(r.credential, r.usedBy));
    },
  );

  app.post('/credentials', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const body = createCredentialSchema.parse(request.body);

    const secret: CredentialSecret =
      body.type === 'password'
        ? { type: 'password', password: body.password }
        : { type: 'key', privateKey: body.privateKey, passphrase: body.passphrase };

    // Anahtarı kaydetmeden önce ayrıştır: bozuk anahtar kasaya girmesin.
    const publicFingerprint = fingerprintFor(secret);
    const sealed = sealSecret(secret, user.id);

    let created: CredentialRow | undefined;
    try {
      [created] = await db
        .insert(credentials)
        .values({
          ownerId: user.id,
          name: body.name.trim(),
          type: body.type,
          username: body.username?.trim() || null,
          publicFingerprint,
          ...sealed,
        })
        .returning();
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
        throw conflict('credential_name_taken', 'Bu adda bir kimlik bilgisi zaten var.');
      }
      throw err;
    }

    if (!created) throw new Error('Kimlik bilgisi oluşturulamadı');

    await emitAudit({
      action: 'credential.create',
      actor: user,
      request,
      detail: { credentialId: created.id, name: created.name, type: created.type },
    });

    return reply.status(201).send(toSummary(created, 0));
  });

  app.patch('/credentials/:id', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);
    const id = requireUuid((request.params as { id?: string }).id);
    const body = updateCredentialSchema.parse(request.body);

    const [existing] = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.id, id), eq(credentials.ownerId, user.id)))
      .limit(1);
    if (!existing) throw notFound('Kimlik bilgisi bulunamadı.');

    const patch: Partial<typeof credentials.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.username !== undefined) patch.username = body.username?.trim() || null;

    if (body.secret) {
      const publicFingerprint = fingerprintFor(body.secret);
      Object.assign(patch, sealSecret(body.secret, user.id), {
        type: body.secret.type,
        publicFingerprint,
      });
    }

    let updated: CredentialRow | undefined;
    try {
      [updated] = await db
        .update(credentials)
        .set(patch)
        .where(eq(credentials.id, id))
        .returning();
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
        throw conflict('credential_name_taken', 'Bu adda bir kimlik bilgisi zaten var.');
      }
      throw err;
    }
    if (!updated) throw notFound('Kimlik bilgisi bulunamadı.');

    await emitAudit({
      action: 'credential.update',
      actor: user,
      request,
      detail: {
        credentialId: updated.id,
        name: updated.name,
        // Gizli verinin değişip değişmediği denetim için anlamlı bir sinyal.
        secretRotated: Boolean(body.secret),
      },
    });

    const usedBy = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(hosts)
      .where(eq(hosts.credentialId, id));

    return toSummary(updated, usedBy[0]?.count ?? 0);
  });

  app.delete('/credentials/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const id = requireUuid((request.params as { id?: string }).id);

    const [deleted] = await db
      .delete(credentials)
      .where(and(eq(credentials.id, id), eq(credentials.ownerId, user.id)))
      .returning();
    if (!deleted) throw notFound('Kimlik bilgisi bulunamadı.');

    await emitAudit({
      action: 'credential.delete',
      actor: user,
      request,
      detail: { credentialId: deleted.id, name: deleted.name },
    });

    return reply.status(204).send();
  });
}
