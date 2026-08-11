import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { credentials, type CredentialRow } from '../db/schema.js';
import { notFound } from './errors.js';
import { open, seal, type SealedSecret } from './crypto/envelope.js';

/** Şifrelenerek saklanan gizli veri. */
export type CredentialSecret =
  | { type: 'password'; password: string }
  | { type: 'key'; privateKey: string; passphrase?: string };

export function sealSecret(secret: CredentialSecret, ownerId: string): SealedSecret {
  return seal(JSON.stringify(secret), ownerId);
}

function toSealed(row: CredentialRow): SealedSecret {
  return {
    encBlob: row.encBlob,
    encNonce: row.encNonce,
    encTag: row.encTag,
    wrappedDek: row.wrappedDek,
    dekNonce: row.dekNonce,
    dekTag: row.dekTag,
    keyVersion: row.keyVersion,
  };
}

/**
 * Elde edilmiş bir satırın gizli verisini çözer.
 *
 * `resolveCredentialSecret` kimliğe göre tek tek sorgu atar; toplu işlerde
 * (yapılandırma dışa aktarımı) satırlar zaten okunmuş oluyor. Aynı kısıt
 * burada da geçerli: çıktısı hiçbir HTTP yanıtına konmamalı — paket dışa
 * aktarımında bile önce kullanıcının parolasıyla yeniden şifrelenir.
 */
export function openCredentialRow(row: CredentialRow, ownerId: string): CredentialSecret {
  return JSON.parse(open(toSealed(row), ownerId)) as CredentialSecret;
}

/**
 * Gizli veriyi çözer. YALNIZCA SSH bağlantısı kurulurken çağrılmalı — hiçbir
 * HTTP yanıtında dönmemeli. Çağrı yerlerini az tutmak bilinçli bir kısıt.
 */
export async function resolveCredentialSecret(
  credentialId: string,
  ownerId: string,
): Promise<{ row: CredentialRow; secret: CredentialSecret }> {
  const [row] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, credentialId), eq(credentials.ownerId, ownerId)))
    .limit(1);

  if (!row) throw notFound('Kimlik bilgisi bulunamadı.');

  const secret = JSON.parse(open(toSealed(row), ownerId)) as CredentialSecret;
  return { row, secret };
}
