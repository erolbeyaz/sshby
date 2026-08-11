import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { UserRole } from '@sshby/shared';
import { db } from '../db/client.js';
import { authSessions, users } from '../db/schema.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/auth/tokens.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
  interface FastifyInstance {
    requireAuth: preHandlerHookHandler;
    requireAdmin: preHandlerHookHandler;
  }
}

function readBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

async function authenticate(request: FastifyRequest): Promise<AuthenticatedUser> {
  const token = readBearerToken(request);
  if (!token) throw unauthorized();

  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    throw unauthorized('Oturumunuzun süresi dolmuş. Lütfen tekrar giriş yapın.');
  }

  /**
   * Access token kısa ömürlü ama "kullanıcıyı pasife al" ve "oturumu sonlandır"
   * işlemlerinin anında etkili olması gerekiyor; bu yüzden her istekte kullanıcı
   * ve oturum satırını doğruluyoruz. Tek indeksli iki okuma, denetim gereksinimi
   * olan bir üründe kabul edilebilir bir bedel.
   */
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      isActive: users.isActive,
      revokedAt: authSessions.revokedAt,
      expiresAt: authSessions.expiresAt,
      sessionUserId: authSessions.userId,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(eq(authSessions.id, claims.sid))
    .limit(1);

  if (!row || row.sessionUserId !== claims.sub) throw unauthorized();
  if (row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('Oturum sonlandırılmış. Lütfen tekrar giriş yapın.');
  }
  if (!row.isActive) throw forbidden('Hesabınız pasife alınmış.');

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    sessionId: claims.sid,
  };
}

export function registerAuthPlugin(app: FastifyInstance): void {
  app.decorateRequest('user', null);

  app.decorate('requireAuth', async function (request: FastifyRequest, _reply: FastifyReply) {
    request.user = await authenticate(request);
  } satisfies preHandlerHookHandler);

  app.decorate('requireAdmin', async function (request: FastifyRequest, _reply: FastifyReply) {
    const user = request.user ?? (await authenticate(request));
    request.user = user;
    if (user.role !== 'admin') {
      throw forbidden('Bu işlem yalnızca yönetici rolüyle yapılabilir.');
    }
  } satisfies preHandlerHookHandler);
}

/** Route'lar içinde `request.user`ı non-null olarak almak için. */
export function requireUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) throw unauthorized();
  return request.user;
}
