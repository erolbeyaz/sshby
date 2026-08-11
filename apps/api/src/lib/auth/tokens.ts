import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { UserRole } from '@sshby/shared';
import { env } from '../../env.js';

/**
 * İki parçalı oturum:
 *  - Access token: kısa ömürlü imzalı JWT, yalnızca istemcinin belleğinde durur.
 *    Sunucu tarafında durum tutmadığı için her istekte veritabanına gitmiyoruz.
 *  - Refresh token: rastgele üretilmiş opak dize, httpOnly cookie'de taşınır ve
 *    veritabanında SHA-256 özetiyle saklanır. Bu sayede tek tek iptal edilebilir
 *    ("tüm cihazlardan çık" özelliği bunun üzerine kurulacak).
 */

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'sshby';
const AUDIENCE = 'sshby-web';

export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: UserRole;
  /** Oturum (refresh) kaydının kimliği — access token'ı oturumla ilişkilendirir. */
  sid: string;
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ email: claims.email, role: claims.role, sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, secret, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });

  if (
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    typeof payload.sid !== 'string' ||
    (payload.role !== 'admin' && payload.role !== 'user')
  ) {
    throw new Error('Token içeriği beklenen biçimde değil');
  }

  return {
    sub: payload.sub,
    email: payload.email,
    role: payload.role,
    sid: payload.sid,
  };
}

/** Refresh token: 32 bayt rastgele, URL güvenli. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Veritabanına yazılan değer. Refresh token yüksek entropili rastgele bir dize
 * olduğu için sözlük saldırısı anlamsız; argon2 yerine SHA-256 yeterli ve her
 * istekte çalışacağı için hızlı olması önemli.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Sabit zamanlı karşılaştırma — özet uzunlukları eşit olduğu için güvenli. */
export function refreshTokenMatches(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const REFRESH_COOKIE_NAME = 'sshby_rt';
