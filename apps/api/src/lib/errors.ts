/**
 * Uygulama hataları. `code` istemcinin dallanma yapabileceği sabit bir dize,
 * `message` kullanıcıya gösterilebilir Türkçe metin. İkisini ayırmak, mesajı
 * değiştirdiğimizde istemci mantığının bozulmasını engelliyor.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);

export const unauthorized = (message = 'Oturum açmanız gerekiyor.') =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'Bu işlem için yetkiniz yok.') =>
  new AppError(403, 'forbidden', message);

export const notFound = (message = 'Kayıt bulunamadı.') => new AppError(404, 'not_found', message);

export const conflict = (code: string, message: string) => new AppError(409, code, message);

export const tooManyRequests = (message = 'Çok fazla deneme yaptınız, lütfen bekleyin.') =>
  new AppError(429, 'too_many_requests', message);

export const serviceUnavailable = (code: string, message: string) =>
  new AppError(503, code, message);

/**
 * Yol parametrelerindeki kimlikleri doğrular.
 *
 * Geçersiz bir UUID doğrudan sorguya gitseydi Postgres "invalid input syntax
 * for type uuid" hatası verir ve kullanıcıya 500 dönerdi — hâlbuki bu, istemci
 * hatasıdır. Kaynağa erişim yetkisini sızdırmamak için 404 dönüyoruz: var olan
 * ve olmayan kimlikler aynı yanıtı almalı.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, notFoundMessage = 'Kayıt bulunamadı.'): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw notFound(notFoundMessage);
  }
  return value;
}
