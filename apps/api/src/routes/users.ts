import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { userRoleSchema, type PublicUser } from '@sshby/shared';
import { z } from 'zod';
import { db } from '../db/client.js';
import { authSessions, users, type UserRow } from '../db/schema.js';
import { emitAudit } from '../lib/audit.js';
import { badRequest, notFound, requireUuid } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

/**
 * Sistemde en az bir etkin admin kalmasını garanti eder. Yönetici kendini
 * yanlışlıkla kilitlerse uygulamayı kimse yapılandıramaz hâle gelir; bu yüzden
 * son admini düşüren işlemleri reddediyoruz.
 */
async function assertNotLastAdmin(targetUserId: string): Promise<void> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.id, targetUserId)));

  if ((rows[0]?.count ?? 0) === 0) {
    throw badRequest(
      'last_admin',
      'Sistemdeki son yönetici hesabı bu şekilde değiştirilemez. Önce başka bir yönetici tanımlayın.',
    );
  }
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users', { preHandler: app.requireAdmin }, async (): Promise<PublicUser[]> => {
    const rows = await db.select().from(users).orderBy(asc(users.createdAt));
    return rows.map(toPublicUser);
  });

  app.patch('/users/:id/role', { preHandler: app.requireAdmin }, async (request) => {
    const actor = requireUser(request);
    const id = requireUuid((request.params as { id?: string }).id);
    const { role } = z.object({ role: userRoleSchema }).parse(request.body);

    const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target) throw notFound('Kullanıcı bulunamadı.');
    if (target.role === role) return toPublicUser(target);

    if (target.role === 'admin') await assertNotLastAdmin(target.id);

    const [updated] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!updated) throw notFound('Kullanıcı bulunamadı.');

    await emitAudit({
      action: 'user.role_change',
      actor,
      request,
      targetUserId: target.id,
      detail: { from: target.role, to: role, targetEmail: target.email },
    });

    return toPublicUser(updated);
  });

  app.patch('/users/:id/active', { preHandler: app.requireAdmin }, async (request) => {
    const actor = requireUser(request);
    const id = requireUuid((request.params as { id?: string }).id);
    const { isActive } = z.object({ isActive: z.boolean() }).parse(request.body);

    const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target) throw notFound('Kullanıcı bulunamadı.');
    if (target.isActive === isActive) return toPublicUser(target);

    if (!isActive && target.role === 'admin') await assertNotLastAdmin(target.id);

    const [updated] = await db
      .update(users)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!updated) throw notFound('Kullanıcı bulunamadı.');

    // Pasife alınan kullanıcının açık oturumları hemen kapatılmalı; aksi hâlde
    // elindeki refresh token'la çalışmaya devam eder.
    if (!isActive) {
      await db
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(eq(authSessions.userId, id));
    }

    await emitAudit({
      action: isActive ? 'user.activate' : 'user.deactivate',
      actor,
      request,
      targetUserId: target.id,
      detail: { targetEmail: target.email },
    });

    return toPublicUser(updated);
  });
}
