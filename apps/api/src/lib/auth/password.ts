import { hash, verify } from '@node-rs/argon2';

/**
 * Parola özetleme. Argon2id, OWASP'ın 2024 önerdiği parametrelerle:
 * 19 MiB bellek, 2 tur, 1 paralellik. Bellek maliyeti GPU'yla kaba kuvvet
 * denemesini pahalı kılan asıl etken.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain);
  } catch {
    // Bozuk ya da tanınmayan özet biçimi: doğrulama başarısız sayılır.
    return false;
  }
}
