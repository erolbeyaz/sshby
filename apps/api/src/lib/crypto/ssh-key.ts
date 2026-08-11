import { createHash } from 'node:crypto';
import { utils } from '../ssh/ssh2.js';
import { badRequest } from '../errors.js';

/**
 * Özel anahtarı doğrular ve gizli veri sızdırmayan bir tanımlayıcı üretir.
 *
 * Parmak izini kaydetmek iki işe yarıyor: kullanıcı listede hangi anahtarın
 * hangisi olduğunu görebiliyor, ve aynı anahtarın iki kez eklendiği fark
 * edilebiliyor. Parmak izi genel anahtardan türediği için gizli değildir.
 */
export function fingerprintPrivateKey(privateKey: string, passphrase?: string): string {
  const parsed = passphrase
    ? utils.parseKey(privateKey, passphrase)
    : utils.parseKey(privateKey);

  if (parsed instanceof Error) {
    // ssh2'nin mesajı İngilizce ve teknik; kullanıcıya en olası iki nedeni söylüyoruz.
    throw badRequest(
      'invalid_private_key',
      'Özel anahtar okunamadı. Anahtar bozuk olabilir ya da parola korumalıysa parolasını girmeniz gerekir.',
      { reason: parsed.message },
    );
  }

  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!key) {
    throw badRequest('invalid_private_key', 'Özel anahtar okunamadı.');
  }

  const digest = createHash('sha256').update(key.getPublicSSH()).digest('base64');
  // OpenSSH biçimi: sondaki '=' doldurma karakterleri gösterilmez.
  return `SHA256:${digest.replace(/=+$/, '')}`;
}

/** Sunucu anahtarı parmak izi — TOFU doğrulamasında kullanılır (Faz 3). */
export function fingerprintHostKey(publicKey: Buffer): string {
  const digest = createHash('sha256').update(publicKey).digest('base64');
  return `SHA256:${digest.replace(/=+$/, '')}`;
}
