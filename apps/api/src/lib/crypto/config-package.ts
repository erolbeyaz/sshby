import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import {
  configVaultPayloadSchema,
  type ConfigKdf,
  type ConfigVault,
  type ConfigVaultPayload,
} from '@sshby/shared';
import { badRequest } from '../errors.js';

/**
 * Yapılandırma paketinin kasa bölümünün şifrelenmesi.
 *
 * Kasadaki zarf şifrelemeden (`envelope.ts`) bilinçli olarak ayrı: oradaki
 * anahtar kurulumun kök anahtarı ve AAD'ye sahip kimliği bağlı, yani üretilen
 * blob yalnızca bu kurulumda ve yalnızca o kullanıcıda çözülebilir. Taşınabilir
 * bir paketin anahtarı ise kullanıcının verdiği paroladan türemek zorunda —
 * hedef kurulum kaynağın kök anahtarını bilmiyor.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;

/**
 * OWASP'ın scrypt önerisi (N=2^16, r=8, p=2 → ~64 MB). Bellek-sert olması
 * paketi ele geçiren birinin GPU ile sözlük saldırısı yapmasını pahalılaştırır;
 * dosya bir kez dışarı çıktığında deneme sayısını sınırlayacak bir sunucu yok.
 */
const DEFAULT_KDF: Omit<ConfigKdf, 'algorithm' | 'salt' | 'keyLength'> = {
  cost: 65536,
  blockSize: 8,
  parallelization: 2,
};

/**
 * scrypt'in bellek ihtiyacı 128·N·r; Node'un varsayılan 32 MB sınırı bunun
 * altında kalıyor, bu yüzden açıkça yükseltiliyor. Üst sınır aynı zamanda
 * savunma: paketteki parametreler dışarıdan geliyor ve şişirilmiş bir N
 * değeri API sürecini bellekle boğabilirdi.
 */
const MAX_SCRYPT_MEMORY = 192 * 1024 * 1024;

function memoryFor(kdf: Pick<ConfigKdf, 'cost' | 'blockSize'>): number {
  return 128 * kdf.cost * kdf.blockSize;
}

async function deriveKey(password: string, kdf: ConfigKdf): Promise<Buffer> {
  const needed = memoryFor(kdf);
  if (needed > MAX_SCRYPT_MEMORY) {
    throw badRequest(
      'package_kdf_unsupported',
      'Paketin anahtar türetme parametreleri bu sürümün desteklediğinden ağır. ' +
        'Paket başka bir sshby sürümüyle oluşturulmuş olabilir.',
    );
  }

  return scryptAsync(password.normalize('NFC'), Buffer.from(kdf.salt, 'base64'), KEY_BYTES, {
    N: kdf.cost,
    r: kdf.blockSize,
    p: kdf.parallelization,
    // scrypt tahsisin biraz üstünde bir tavan istiyor; tam eşitlikte reddediyor.
    maxmem: needed + 1024 * 1024,
  });
}

/**
 * AAD olarak paket biçimi ve sürümü bağlanır: bir paketin kasa bölümü başka
 * sürümdeki bir paketin içine taşınırsa çözülmez.
 */
const AAD = Buffer.from('sshby:config-package:v1', 'utf8');

export async function sealConfigVault(
  payload: ConfigVaultPayload,
  password: string,
): Promise<ConfigVault> {
  const salt = randomBytes(SALT_BYTES);
  const kdf: ConfigKdf = {
    algorithm: 'scrypt',
    salt: salt.toString('base64'),
    keyLength: KEY_BYTES,
    ...DEFAULT_KDF,
  };

  const key = await deriveKey(password, kdf);
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, nonce);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);

    return {
      kdf,
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  } finally {
    key.fill(0);
  }
}

/**
 * Yanlış parola GCM etiketi doğrulamasında yakalanır; ayrı bir parola kontrolü
 * yok çünkü kimlik doğrulamalı şifrelemede etiket zaten bu işi yapıyor.
 */
export async function openConfigVault(
  vault: ConfigVault,
  password: string,
): Promise<ConfigVaultPayload> {
  const key = await deriveKey(password, vault.kdf);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(vault.nonce, 'base64'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(vault.tag, 'base64'));

    let plaintext: string;
    try {
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(vault.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw badRequest(
        'invalid_package_password',
        'Paket parolası yanlış ya da dosya bozulmuş. Parolayı kontrol edip tekrar deneyin.',
      );
    }

    const parsed = configVaultPayloadSchema.safeParse(JSON.parse(plaintext));
    if (!parsed.success) {
      throw badRequest(
        'invalid_package_vault',
        'Paketin kasa bölümü tanınmadı; dosya bozulmuş olabilir.',
      );
    }
    return parsed.data;
  } finally {
    key.fill(0);
  }
}
