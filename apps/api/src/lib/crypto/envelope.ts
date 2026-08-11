import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../../env.js';

/**
 * Zarf şifreleme (envelope encryption).
 *
 * Her gizli veri kendi rastgele veri anahtarıyla (DEK) şifrelenir; DEK de kök
 * anahtarla (KEK) sarılır. Kök anahtar değiştirildiğinde yalnızca sarmalanmış
 * DEK'leri yeniden sarmak yeterlidir — gigabaytlarca veriyi yeniden şifrelemek
 * gerekmez. Ayrıca kök anahtar hiçbir zaman doğrudan kullanıcı verisine
 * uygulanmaz, bu da aynı anahtarla şifrelenen blok sayısını sınırlar.
 */

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const DEK_BYTES = 32;

function parseKey(value: string, label: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error(`${label} base64 kodlanmış tam 32 bayt olmalı`);
  }
  return key;
}

/**
 * Sürüm → kök anahtar eşlemesi. Rotasyonda eski kayıtları çözebilmek için
 * önceki anahtarlar da yüklenir; yeni kayıtlar her zaman güncel sürümle yazılır.
 */
function loadKeyRing(): Map<number, Buffer> {
  const ring = new Map<number, Buffer>();
  ring.set(env.SSHBY_MASTER_KEY_VERSION, parseKey(env.SSHBY_MASTER_KEY, 'SSHBY_MASTER_KEY'));

  if (env.SSHBY_MASTER_KEY_PREVIOUS) {
    for (const entry of env.SSHBY_MASTER_KEY_PREVIOUS.split(',')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const separator = trimmed.indexOf(':');
      if (separator === -1) {
        throw new Error('SSHBY_MASTER_KEY_PREVIOUS biçimi "<sürüm>:<base64>" olmalı');
      }
      const version = Number(trimmed.slice(0, separator));
      if (!Number.isInteger(version) || version < 1) {
        throw new Error(`SSHBY_MASTER_KEY_PREVIOUS içinde geçersiz sürüm: ${trimmed.slice(0, separator)}`);
      }
      if (ring.has(version)) continue;
      ring.set(version, parseKey(trimmed.slice(separator + 1), `SSHBY_MASTER_KEY_PREVIOUS[${version}]`));
    }
  }

  return ring;
}

const keyRing = loadKeyRing();
export const CURRENT_KEY_VERSION = env.SSHBY_MASTER_KEY_VERSION;

function keyForVersion(version: number): Buffer {
  const key = keyRing.get(version);
  if (!key) {
    throw new Error(
      `Şifreleme anahtarı sürüm ${version} yüklü değil. ` +
        'Eski kayıtları çözebilmek için SSHBY_MASTER_KEY_PREVIOUS içinde tanımlayın.',
    );
  }
  return key;
}

/** Veritabanına yazılan şifreli paket. */
export interface SealedSecret {
  encBlob: Buffer;
  encNonce: Buffer;
  encTag: Buffer;
  wrappedDek: Buffer;
  dekNonce: Buffer;
  dekTag: Buffer;
  keyVersion: number;
}

/**
 * `aad` (ek doğrulanmış veri) olarak sahip kimliği bağlanır: bir kullanıcının
 * şifreli satırı başka bir kullanıcının satırına kopyalansa bile çözülemez.
 */
function aadFor(ownerId: string): Buffer {
  return Buffer.from(`sshby:credential:v1:${ownerId}`, 'utf8');
}

export function seal(plaintext: string, ownerId: string): SealedSecret {
  const dek = randomBytes(DEK_BYTES);
  const aad = aadFor(ownerId);

  const encNonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, dek, encNonce);
  cipher.setAAD(aad);
  const encBlob = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const encTag = cipher.getAuthTag();

  const dekNonce = randomBytes(NONCE_BYTES);
  const wrapper = createCipheriv(ALGORITHM, keyForVersion(CURRENT_KEY_VERSION), dekNonce);
  wrapper.setAAD(aad);
  const wrappedDek = Buffer.concat([wrapper.update(dek), wrapper.final()]);
  const dekTag = wrapper.getAuthTag();

  // DEK'i bellekte gereğinden uzun tutma.
  dek.fill(0);

  return { encBlob, encNonce, encTag, wrappedDek, dekNonce, dekTag, keyVersion: CURRENT_KEY_VERSION };
}

export function open(sealed: SealedSecret, ownerId: string): string {
  const aad = aadFor(ownerId);

  const unwrapper = createDecipheriv(ALGORITHM, keyForVersion(sealed.keyVersion), sealed.dekNonce);
  unwrapper.setAAD(aad);
  unwrapper.setAuthTag(sealed.dekTag);
  const dek = Buffer.concat([unwrapper.update(sealed.wrappedDek), unwrapper.final()]);

  try {
    const decipher = createDecipheriv(ALGORITHM, dek, sealed.encNonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.encTag);
    return Buffer.concat([decipher.update(sealed.encBlob), decipher.final()]).toString('utf8');
  } finally {
    dek.fill(0);
  }
}

/**
 * Kök anahtar rotasyonu: gizli veriye dokunmadan yalnızca sarmalanmış DEK'i
 * güncel anahtarla yeniden sarar.
 */
export function rewrap(sealed: SealedSecret, ownerId: string): SealedSecret {
  if (sealed.keyVersion === CURRENT_KEY_VERSION) return sealed;

  const aad = aadFor(ownerId);
  const unwrapper = createDecipheriv(ALGORITHM, keyForVersion(sealed.keyVersion), sealed.dekNonce);
  unwrapper.setAAD(aad);
  unwrapper.setAuthTag(sealed.dekTag);
  const dek = Buffer.concat([unwrapper.update(sealed.wrappedDek), unwrapper.final()]);

  try {
    const dekNonce = randomBytes(NONCE_BYTES);
    const wrapper = createCipheriv(ALGORITHM, keyForVersion(CURRENT_KEY_VERSION), dekNonce);
    wrapper.setAAD(aad);
    const wrappedDek = Buffer.concat([wrapper.update(dek), wrapper.final()]);
    return {
      ...sealed,
      wrappedDek,
      dekNonce,
      dekTag: wrapper.getAuthTag(),
      keyVersion: CURRENT_KEY_VERSION,
    };
  } finally {
    dek.fill(0);
  }
}
