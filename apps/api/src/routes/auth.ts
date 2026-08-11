import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  loginRequestSchema,
  registerRequestSchema,
  type AuthResponse,
  type AuthSessionInfo,
  type PublicUser,
} from '@sshby/shared';
import { db } from '../db/client.js';
import { authSessions, users, type UserRow } from '../db/schema.js';
import { cookieSecure, env } from '../env.js';
import { emitAudit } from '../lib/audit.js';
import { hashPassword, verifyPassword } from '../lib/auth/password.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_COOKIE_NAME,
  signAccessToken,
} from '../lib/auth/tokens.js';
import { badRequest, conflict, forbidden, requireUuid, unauthorized } from '../lib/errors.js';
import { getSetting } from '../lib/settings.js';
import { requireUser } from '../plugins/auth.js';

/** Başarısız giriş denemesi bu sayıya ulaşınca hesap geçici olarak kilitlenir. */
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

/**
 * Refresh cookie'si yalnızca /api/auth altına gönderilir: uygulamanın geri
 * kalanındaki hiçbir istek onu taşımaz, dolayısıyla sızma yüzeyi küçülür.
 */
const REFRESH_COOKIE_PATH = '/api/auth';

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

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

/** Yeni oturum satırı açar, refresh cookie'sini basar ve access token döner. */
async function issueSession(
  user: UserRow,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthResponse> {
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  const [session] = await db
    .insert(authSessions)
    .values({
      userId: user.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      userAgent: request.headers['user-agent'] ?? null,
      ip: request.ip,
      expiresAt,
    })
    .returning({ id: authSessions.id });

  if (!session) throw new Error('Oturum kaydı oluşturulamadı');

  setRefreshCookie(reply, refreshToken);

  const accessToken = await signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    sid: session.id,
  });

  return {
    accessToken,
    expiresInSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
    user: toPublicUser(user),
  };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // ------------------------------------------------------------------ kayıt
  app.post(
    '/auth/register',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const body = registerRequestSchema.parse(request.body);
      const email = body.email.trim().toLowerCase();

      const countRows = await db.select({ count: sql<number>`count(*)::int` }).from(users);
      const isFirstUser = (countRows[0]?.count ?? 0) === 0;

      if (!isFirstUser) {
        const registration = await getSetting('registration');
        if (!registration.open) {
          throw forbidden('Yeni kayıt alımı kapalı. Yöneticinizle görüşün.');
        }
        if (registration.allowedEmailDomains.length > 0) {
          const domain = email.split('@')[1] ?? '';
          if (!registration.allowedEmailDomains.includes(domain)) {
            throw badRequest(
              'email_domain_not_allowed',
              'Bu e-posta alan adıyla kayıt olunamıyor.',
            );
          }
        }
      }

      const passwordHash = await hashPassword(body.password);

      let created: UserRow | undefined;
      try {
        [created] = await db
          .insert(users)
          .values({
            email,
            displayName: body.displayName.trim(),
            passwordHash,
            // İlk kullanıcı admin olmalı; aksi hâlde kimse ayarları yapılandıramaz.
            role: isFirstUser ? 'admin' : 'user',
          })
          .returning();
      } catch (err) {
        // users_email_unique ihlali — yarış durumunda da doğru davranır.
        if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
          throw conflict('email_taken', 'Bu e-posta adresi zaten kayıtlı.');
        }
        throw err;
      }

      if (!created) throw new Error('Kullanıcı oluşturulamadı');

      const result = await issueSession(created, request, reply);

      await emitAudit({
        action: 'auth.register',
        actor: { id: created.id, email: created.email, role: created.role },
        request,
        detail: { firstUser: isFirstUser, role: created.role },
      });

      return reply.status(201).send(result);
    },
  );

  // ------------------------------------------------------------------- giriş
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const body = loginRequestSchema.parse(request.body);
      const email = body.email.trim().toLowerCase();

      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

      /**
       * Hangi adımda başarısız olursak olalım aynı mesajı dönüyoruz: "e-posta
       * kayıtlı mı" bilgisini sızdırmak, iç ağda bile kullanıcı listesi
       * toplamayı kolaylaştırır.
       */
      const genericFailure = unauthorized('E-posta veya parola hatalı.');

      if (!user || !user.passwordHash) {
        await emitAudit({
          action: 'auth.login_failed',
          outcome: 'failure',
          request,
          detail: { email, reason: 'unknown_user' },
        });
        throw genericFailure;
      }

      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        await emitAudit({
          action: 'auth.login_failed',
          outcome: 'failure',
          actor: { id: user.id, email: user.email, role: user.role },
          request,
          detail: { reason: 'locked', lockedUntil: user.lockedUntil.toISOString() },
        });
        throw forbidden(
          `Çok fazla hatalı deneme nedeniyle hesap geçici olarak kilitlendi. ` +
            `${LOCKOUT_MINUTES} dakika sonra tekrar deneyin.`,
        );
      }

      const passwordOk = await verifyPassword(user.passwordHash, body.password);

      if (!passwordOk) {
        const failedCount = user.failedLoginCount + 1;
        const shouldLock = failedCount >= MAX_FAILED_LOGINS;
        await db
          .update(users)
          .set({
            failedLoginCount: failedCount,
            lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));

        await emitAudit({
          action: 'auth.login_failed',
          outcome: 'failure',
          actor: { id: user.id, email: user.email, role: user.role },
          request,
          detail: { reason: 'bad_password', failedCount, locked: shouldLock },
        });
        throw genericFailure;
      }

      if (!user.isActive) {
        await emitAudit({
          action: 'auth.login_failed',
          outcome: 'failure',
          actor: { id: user.id, email: user.email, role: user.role },
          request,
          detail: { reason: 'inactive' },
        });
        throw forbidden('Hesabınız pasife alınmış. Yöneticinizle görüşün.');
      }

      const [updated] = await db
        .update(users)
        .set({
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning();

      const result = await issueSession(updated ?? user, request, reply);

      await emitAudit({
        action: 'auth.login',
        actor: { id: user.id, email: user.email, role: user.role },
        request,
      });

      return result;
    },
  );

  // ------------------------------------------------------------ token yenileme
  app.post(
    '/auth/refresh',
    { config: { rateLimit: { max: 120, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE_NAME];
      if (!token) throw unauthorized('Oturum bulunamadı.');

      const tokenHash = hashRefreshToken(token);
      const [row] = await db
        .select({ session: authSessions, user: users })
        .from(authSessions)
        .innerJoin(users, eq(users.id, authSessions.userId))
        .where(eq(authSessions.refreshTokenHash, tokenHash))
        .limit(1);

      if (!row || row.session.revokedAt || row.session.expiresAt.getTime() <= Date.now()) {
        clearRefreshCookie(reply);
        throw unauthorized('Oturumun süresi dolmuş. Lütfen tekrar giriş yapın.');
      }
      if (!row.user.isActive) {
        clearRefreshCookie(reply);
        throw forbidden('Hesabınız pasife alınmış.');
      }

      /**
       * Dönüşümlü yenileme: eski token kullanılır kullanılmaz iptal edilir ve
       * yerine yenisi verilir. Çalınmış bir token'ın ömrü, meşru kullanıcının
       * bir sonraki yenilemesine kadar kısalır.
       */
      await db
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(eq(authSessions.id, row.session.id));

      const result = await issueSession(row.user, request, reply);

      await emitAudit({
        action: 'auth.token_refresh',
        actor: { id: row.user.id, email: row.user.email, role: row.user.role },
        request,
      });

      return result;
    },
  );

  // ------------------------------------------------------------------- çıkış
  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE_NAME];
    clearRefreshCookie(reply);

    if (token) {
      const [row] = await db
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authSessions.refreshTokenHash, hashRefreshToken(token)),
            isNull(authSessions.revokedAt),
          ),
        )
        .returning({ userId: authSessions.userId });

      if (row) {
        const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
        if (user) {
          await emitAudit({
            action: 'auth.logout',
            actor: { id: user.id, email: user.email, role: user.role },
            request,
          });
        }
      }
    }

    return reply.status(204).send();
  });

  // ---------------------------------------------------------------- oturum bilgisi
  app.get('/auth/me', { preHandler: app.requireAuth }, async (request) => {
    const current = requireUser(request);
    const [row] = await db.select().from(users).where(eq(users.id, current.id)).limit(1);
    if (!row) throw unauthorized();
    return toPublicUser(row);
  });

  /** Kullanıcının açık oturumları — "diğer cihazlardan çık" için. */
  app.get(
    '/auth/sessions',
    { preHandler: app.requireAuth },
    async (request): Promise<AuthSessionInfo[]> => {
      const current = requireUser(request);
      const rows = await db
        .select()
        .from(authSessions)
        .where(and(eq(authSessions.userId, current.id), isNull(authSessions.revokedAt)));

      return rows
        .filter((r) => r.expiresAt.getTime() > Date.now())
        .map((r) => ({
          id: r.id,
          userAgent: r.userAgent,
          ip: r.ip,
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
          current: r.id === current.sessionId,
        }));
    },
  );

  app.delete('/auth/sessions/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const current = requireUser(request);
    const id = requireUuid((request.params as { id?: string }).id);

    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.id, id), eq(authSessions.userId, current.id)));

    if (id === current.sessionId) clearRefreshCookie(reply);
    return reply.status(204).send();
  });
}
