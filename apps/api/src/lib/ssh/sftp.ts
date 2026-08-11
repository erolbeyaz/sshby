import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { hosts, type HostRow } from '../../db/schema.js';
import { env } from '../../env.js';
import { resolveCredentialSecret } from '../credentials.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { resolveUsername } from '../../routes/inventory.js';
import { checkHostKey } from './host-key.js';
import { findSessionClient } from './session-registry.js';
import { Client, type SFTPWrapper } from './ssh2.js';

/**
 * SFTP oturumu edinme.
 *
 * Bağlantı stratejisi bilinçli olarak "önce mevcut oturumu kullan":
 *
 *  1. Sunucuya ait açık bir terminal varsa onun SSH bağlantısı üzerinde yeni
 *     bir SFTP kanalı açılır. Hem hızlı, hem de etkileşimli parolayla
 *     bağlanılmış sunucularda tek yol — parolayı saklamadığımız için ikinci
 *     kez kimlik doğrulayamayız.
 *  2. Terminal yoksa ve kasada kayıt varsa yeni bir bağlantı kurulur.
 *  3. İkisi de yoksa kullanıcıdan önce terminal açması istenir.
 *
 * Kendi kurduğumuz bağlantılar boşta kalınca kapanır; terminalden ödünç
 * alınanlara dokunulmaz (sahibi terminal oturumudur).
 */

interface PooledSftp {
  sftp: SFTPWrapper;
  /** Kendi açtığımız bağlantı; ödünç alınmışsa null. */
  ownedClient: Client | null;
  idleTimer: NodeJS.Timeout | null;
}

const pool = new Map<string, PooledSftp>();

const key = (userId: string, hostId: string) => `${userId}:${hostId}`;

function scheduleIdleClose(poolKey: string): void {
  const entry = pool.get(poolKey);
  if (!entry) return;

  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  // Ödünç alınan bağlantıyı biz kapatmayız; yalnızca havuzdan düşürürüz.
  entry.idleTimer = setTimeout(() => {
    pool.delete(poolKey);
    entry.ownedClient?.end();
  }, env.SFTP_IDLE_TIMEOUT_MS);
  entry.idleTimer.unref();
}

function openSftpChannel(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
  });
}

async function connectDedicated(host: HostRow, ownerId: string): Promise<Client> {
  if (!host.credentialId) {
    throw conflict(
      'terminal_required',
      'Bu sunucuda kayıtlı kimlik bilgisi yok. Dosyalara erişmek için önce bir terminal ' +
        'açın; SFTP o bağlantıyı kullanır.',
    );
  }

  const { row: credentialRow, secret } = await resolveCredentialSecret(host.credentialId, ownerId);
  const username = resolveUsername(host.username, credentialRow.username);
  if (!username) {
    throw badRequest('username_required', 'SSH kullanıcı adı belirlenemedi.');
  }

  return new Promise<Client>((resolve, reject) => {
    const client = new Client();

    client.on('ready', () => resolve(client));
    client.on('error', (err: Error) => reject(err));

    client.connect({
      host: host.hostname,
      port: host.port,
      username,
      readyTimeout: env.SSH_CONNECT_TIMEOUT_MS,
      keepaliveInterval: env.SSH_KEEPALIVE_INTERVAL_MS,
      ...(secret.type === 'password'
        ? { password: secret.password }
        : { privateKey: secret.privateKey, passphrase: secret.passphrase }),

      /**
       * Host anahtarı burada SORULMAZ, yalnızca doğrulanır. HTTP isteğinin
       * içinde kullanıcıya soru soramayız ve bilinmeyen bir anahtarı sessizce
       * kabul etmek TOFU'yu anlamsız kılardı.
       */
      hostVerifier: (hostKey: Buffer, verify: (valid: boolean) => void) => {
        void checkHostKey(ownerId, host.hostname, host.port, hostKey).then((verdict) =>
          verify(verdict.kind === 'trusted'),
        );
      },
    });
  });
}

/**
 * Ham SSH bağlantısı — sudo modundaki kabuk komutları bunu kullanır.
 * SFTP ile aynı ödünç alma sırasını izler.
 */
export async function getSshClient(ownerId: string, hostId: string): Promise<Client> {
  const borrowed = findSessionClient(ownerId, hostId);
  if (borrowed) return borrowed;

  const pooled = pool.get(key(ownerId, hostId));
  if (pooled?.ownedClient) return pooled.ownedClient;

  const [host] = await db
    .select()
    .from(hosts)
    .where(and(eq(hosts.id, hostId), eq(hosts.ownerId, ownerId)))
    .limit(1);
  if (!host) throw notFound('Sunucu bulunamadı.');

  return connectDedicated(host, ownerId);
}

export async function getSftp(ownerId: string, hostId: string): Promise<SFTPWrapper> {
  const poolKey = key(ownerId, hostId);
  const existing = pool.get(poolKey);
  if (existing) {
    scheduleIdleClose(poolKey);
    return existing.sftp;
  }

  const [host] = await db
    .select()
    .from(hosts)
    .where(and(eq(hosts.id, hostId), eq(hosts.ownerId, ownerId)))
    .limit(1);
  if (!host) throw notFound('Sunucu bulunamadı.');

  const borrowed = findSessionClient(ownerId, hostId);
  const client = borrowed ?? (await connectDedicated(host, ownerId));

  let sftp: SFTPWrapper;
  try {
    sftp = await openSftpChannel(client);
  } catch (err) {
    if (!borrowed) client.end();
    throw conflict(
      'sftp_unavailable',
      'Sunucuda SFTP alt sistemi açılamadı. SSH yapılandırmasında sftp-server etkin olmayabilir.',
    );
  }

  const entry: PooledSftp = { sftp, ownedClient: borrowed ? null : client, idleTimer: null };
  pool.set(poolKey, entry);

  // Bağlantı kopunca havuzda ölü bir kayıt kalmasın.
  const drop = () => {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    pool.delete(poolKey);
  };
  sftp.on('close', drop);
  client.on('close', drop);

  scheduleIdleClose(poolKey);
  return sftp;
}

/** Kullanıcı bağlantıyı kendi kapatmak isterse (ya da kapanışta). */
export function closeSftp(ownerId: string, hostId: string): void {
  const poolKey = key(ownerId, hostId);
  const entry = pool.get(poolKey);
  if (!entry) return;
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  pool.delete(poolKey);
  entry.ownedClient?.end();
}
