import { env } from '../../env.js';
import { conflict } from '../errors.js';
import { getSshClient } from './sftp.js';
import { verifySudo, type SudoContext } from './shell-fs.js';

/**
 * Sudo parolasının bellek içi saklanması.
 *
 * Parola yalnızca burada, süreç belleğinde yaşar: veritabanına, kasaya,
 * denetim kaydına ve loglara asla yazılmaz. Boşta kalınca silinir, API
 * yeniden başlarsa kaybolur — ikisi de kasıtlı.
 *
 * Bu, kasadaki kimlik bilgilerinden farklı bir güven modeli: kasa uzun ömürlü
 * ve şifreli, bu ise oturumluk ve şifresiz. Kalıcı olsaydı, "yükseltilmiş
 * yetkiyi saklama" kararını kullanıcı adına vermiş olurduk.
 */

interface Entry {
  password: string;
  timer: NodeJS.Timeout;
}

const cache = new Map<string, Entry>();

const key = (userId: string, hostId: string) => `${userId}:${hostId}`;

function schedule(cacheKey: string, entry: Entry): void {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    const current = cache.get(cacheKey);
    // Parolayı bellekte gereğinden uzun tutmamak için üzerine yazıp siliyoruz.
    if (current) current.password = '';
    cache.delete(cacheKey);
  }, env.SUDO_PASSWORD_TTL_MS);
  entry.timer.unref();
}

/** Parolayı doğrular ve kabul edilirse önbelleğe alır. */
export async function rememberSudoPassword(
  userId: string,
  hostId: string,
  password: string,
): Promise<void> {
  const client = await getSshClient(userId, hostId);
  await verifySudo({ client, password });

  const cacheKey = key(userId, hostId);
  const entry: Entry = { password, timer: setTimeout(() => undefined, 0) };
  cache.set(cacheKey, entry);
  schedule(cacheKey, entry);
}

export function forgetSudoPassword(userId: string, hostId: string): void {
  const cacheKey = key(userId, hostId);
  const entry = cache.get(cacheKey);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.password = '';
  cache.delete(cacheKey);
}

export function hasSudoPassword(userId: string, hostId: string): boolean {
  return cache.has(key(userId, hostId));
}

/**
 * Sudo bağlamını verir. Parola yoksa istemciye "önce parola gerekiyor"
 * denir — sessizce yetkisiz bir komut çalıştırmak yerine.
 */
export async function getSudoContext(userId: string, hostId: string): Promise<SudoContext> {
  const cacheKey = key(userId, hostId);
  const entry = cache.get(cacheKey);
  if (!entry) {
    throw conflict(
      'sudo_password_required',
      'Sudo modu için parolanız gerekiyor.',
    );
  }

  // Her kullanım süreyi tazeler: aktif kullanırken sürekli sormak anlamsız.
  schedule(cacheKey, entry);

  return { client: await getSshClient(userId, hostId), password: entry.password };
}
