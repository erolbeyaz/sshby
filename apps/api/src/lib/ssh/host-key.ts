import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { hostKeys } from '../../db/schema.js';
import { fingerprintHostKey } from '../crypto/ssh-key.js';

/**
 * TOFU (trust on first use) host anahtarı doğrulaması.
 *
 * OpenSSH'ın `known_hosts` davranışının veritabanı karşılığı. Anahtar
 * kullanıcı başına saklanıyor: aynı IP'yi farklı ekiplerin farklı sunucular
 * için kullandığı ortamlarda ortak bir güven listesi yanlış alarm üretir.
 */

export type HostKeyVerdict =
  | { kind: 'trusted'; fingerprint: string; algorithm: string }
  | { kind: 'unknown'; fingerprint: string; algorithm: string }
  | { kind: 'changed'; fingerprint: string; algorithm: string; knownFingerprint: string };

/**
 * SSH tel biçimindeki genel anahtarın algoritma adını okur.
 * Biçim: uint32 uzunluk + algoritma adı + (anahtar verisi).
 */
function readAlgorithm(key: Buffer): string {
  if (key.length < 4) return 'bilinmeyen';
  const length = key.readUInt32BE(0);
  if (length <= 0 || length > 64 || key.length < 4 + length) return 'bilinmeyen';
  return key.subarray(4, 4 + length).toString('ascii');
}

export async function checkHostKey(
  ownerId: string,
  hostname: string,
  port: number,
  key: Buffer,
): Promise<HostKeyVerdict> {
  const fingerprint = fingerprintHostKey(key);
  const algorithm = readAlgorithm(key);

  const [known] = await db
    .select()
    .from(hostKeys)
    .where(
      and(
        eq(hostKeys.ownerId, ownerId),
        eq(hostKeys.hostname, hostname),
        eq(hostKeys.port, port),
      ),
    )
    .limit(1);

  if (!known) return { kind: 'unknown', fingerprint, algorithm };
  if (known.fingerprintSha256 === fingerprint) return { kind: 'trusted', fingerprint, algorithm };

  return { kind: 'changed', fingerprint, algorithm, knownFingerprint: known.fingerprintSha256 };
}

/** Kullanıcı kabul ettiğinde çağrılır; değişen anahtarın üzerine yazar. */
export async function trustHostKey(
  ownerId: string,
  hostname: string,
  port: number,
  algorithm: string,
  fingerprint: string,
): Promise<void> {
  await db
    .insert(hostKeys)
    .values({
      ownerId,
      hostname,
      port,
      algorithm,
      fingerprintSha256: fingerprint,
    })
    .onConflictDoUpdate({
      target: [hostKeys.ownerId, hostKeys.hostname, hostKeys.port],
      set: { algorithm, fingerprintSha256: fingerprint, acceptedAt: new Date() },
    });
}
