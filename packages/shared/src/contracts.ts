import { z } from 'zod';

/** API sözleşmeleri — api ile web arasında tek doğruluk kaynağı. */

export const userRoleSchema = z.enum(['admin', 'user']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  role: userRoleSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

/**
 * Parola kuralı. Uzunluk, karakter çeşitliliği kurallarından daha etkilidir;
 * kullanıcıyı `P@ssw0rd!` üretmeye iten kısıtlar koymuyoruz.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Parola en az 12 karakter olmalı')
  .max(200, 'Parola en fazla 200 karakter olabilir');

export const registerRequestSchema = z.object({
  email: z.string().email('Geçerli bir e-posta adresi girin').max(254),
  displayName: z.string().min(2, 'En az 2 karakter').max(80),
  password: passwordSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1, 'Parola gerekli').max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  expiresInSeconds: z.number().int(),
  user: publicUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const authSessionSchema = z.object({
  id: z.string().uuid(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  /** İsteği yapan istemcinin şu an kullandığı oturum. */
  current: z.boolean(),
});
export type AuthSessionInfo = z.infer<typeof authSessionSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeSeconds: z.number(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.object({ ok: z.boolean(), detail: z.string().optional() })),
});
export type ReadyResponse = z.infer<typeof readyResponseSchema>;

/**
 * Giriş ekranının, kullanıcı daha oturum açmadan bilmesi gereken ayarlar.
 * Kayıt kapalıysa form gizlenir; bunu istemcide hard-code etmemek için sunucudan gelir.
 */
export const bootstrapInfoSchema = z.object({
  registrationOpen: z.boolean(),
  /** Hiç kullanıcı yoksa true — ilk kaydolan admin olur, UI bunu söyler. */
  firstRun: z.boolean(),
  auditEnabled: z.boolean(),
  auditIndexPattern: z.string().nullable(),
  oidcEnabled: z.boolean(),
});
export type BootstrapInfo = z.infer<typeof bootstrapInfoSchema>;

/** Admin tarafından çalışma zamanında değiştirilen kayıt politikası. */
export const registrationSettingsSchema = z.object({
  /** Hiç kullanıcı yokken bu değere bakılmaz; ilk kayıt her zaman açıktır. */
  open: z.boolean().default(true),
  /** Boş dizi = kısıt yok. Örn. ["sirket.com.tr"] */
  allowedEmailDomains: z.array(z.string()).default([]),
});
export type RegistrationSettings = z.infer<typeof registrationSettingsSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
