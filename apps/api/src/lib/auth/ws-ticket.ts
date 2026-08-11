import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../env.js';

/**
 * WebSocket bileti.
 *
 * Tarayıcının WebSocket API'si özel başlık göndermeye izin vermiyor; access
 * token'ı sorgu dizesine koymak ise onu nginx erişim kayıtlarına, tarayıcı
 * geçmişine ve referrer başlıklarına sızdırır. Bunun yerine istemci normal
 * (Authorization başlıklı) bir HTTP isteğiyle 30 saniyelik, tek bir sunucuya
 * bağlanmaya yetkili bir bilet alıyor. Bilet sızsa bile ömrü ve kapsamı dar.
 */

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'sshby';
const AUDIENCE = 'sshby-ws';

export const WS_TICKET_TTL_SECONDS = 30;

export interface WsTicketClaims {
  sub: string;
  sid: string;
  hostId: string;
  /** Biletin hangi uç için geçerli olduğu — terminal bileti SFTP'de kullanılamaz. */
  scope: 'terminal' | 'metrics' | 'sftp';
}

export async function signWsTicket(claims: WsTicketClaims): Promise<string> {
  return new SignJWT({ sid: claims.sid, hostId: claims.hostId, scope: claims.scope })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${WS_TICKET_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyWsTicket(
  token: string,
  expectedScope: WsTicketClaims['scope'],
): Promise<WsTicketClaims> {
  const { payload } = await jwtVerify(token, secret, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });

  if (
    typeof payload.sub !== 'string' ||
    typeof payload.sid !== 'string' ||
    typeof payload.hostId !== 'string' ||
    payload.scope !== expectedScope
  ) {
    throw new Error('Bilet içeriği beklenen biçimde değil');
  }

  return {
    sub: payload.sub,
    sid: payload.sid,
    hostId: payload.hostId,
    // Yukarıdaki kontrol eşitliği doğruladı; `payload.scope` unknown olduğu için
    // daraltılmış olan değeri kullanıyoruz.
    scope: expectedScope,
  };
}
