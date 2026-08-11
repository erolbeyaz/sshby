import { z } from 'zod';

/** SFTP sözleşmeleri. */

export const sftpEntryTypeSchema = z.enum(['file', 'directory', 'symlink', 'other']);
export type SftpEntryType = z.infer<typeof sftpEntryTypeSchema>;

export const sftpEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: sftpEntryTypeSchema,
  size: z.number().int().nonnegative(),
  /** Unix zaman damgası, saniye. */
  modifiedAt: z.number().int(),
  /** Sekizlik izin dizesi: "0644". */
  mode: z.string(),
  owner: z.number().int().nullable(),
  group: z.number().int().nullable(),
  /** Sembolik bağlarda hedefin dizin olup olmadığı; çözülemezse null. */
  linkTargetType: sftpEntryTypeSchema.nullable(),
});
export type SftpEntry = z.infer<typeof sftpEntrySchema>;

export const sftpListResponseSchema = z.object({
  path: z.string(),
  /** Üst dizin; kökteysek null. */
  parent: z.string().nullable(),
  entries: z.array(sftpEntrySchema),
});
export type SftpListResponse = z.infer<typeof sftpListResponseSchema>;

/**
 * Yol doğrulaması. Boş bayt dosya sistemi çağrılarını kesebildiği için
 * reddediliyor; onun dışında kısıtlama yok — kullanıcı zaten aynı kimlikle
 * kabuğa erişebiliyor, dizin hapsi güvenlik tiyatrosu olurdu.
 */
export const remotePathSchema = z
  .string()
  .min(1, 'Yol boş olamaz')
  .max(4096)
  .refine((v) => !v.includes('\0'), 'Yol geçersiz karakter içeriyor');

/** `df` çıktısından türetilen bağlama noktası bilgisi. */
export const storageMountSchema = z.object({
  mount: z.string(),
  filesystem: z.string(),
  usedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
});
export type StorageMount = z.infer<typeof storageMountSchema>;

export const sftpMkdirSchema = z.object({ path: remotePathSchema });
export type SftpMkdirRequest = z.infer<typeof sftpMkdirSchema>;

export const sftpRenameSchema = z.object({
  from: remotePathSchema,
  to: remotePathSchema,
});
export type SftpRenameRequest = z.infer<typeof sftpRenameSchema>;

export const sftpChmodSchema = z.object({
  path: remotePathSchema,
  /** Sekizlik: "0644", "755" gibi. */
  mode: z
    .string()
    .regex(/^0?[0-7]{3}$/, 'İzin üç sekizlik basamak olmalı (örn. 644)'),
});
export type SftpChmodRequest = z.infer<typeof sftpChmodSchema>;

export const sftpDeleteSchema = z.object({
  path: remotePathSchema,
  /** Dizin silme ayrı bir çağrı gerektirir; istemci ne sildiğini bilmeli. */
  directory: z.boolean().default(false),
});
export type SftpDeleteRequest = z.infer<typeof sftpDeleteSchema>;
