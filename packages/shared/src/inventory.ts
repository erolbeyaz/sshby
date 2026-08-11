import { z } from 'zod';

/** Kasa, klasör ve sunucu envanteri sözleşmeleri. */

// ------------------------------------------------------------------- kasa

export const credentialTypeSchema = z.enum(['password', 'key']);
export type CredentialType = z.infer<typeof credentialTypeSchema>;

/**
 * Listede dönen credential. Gizli veri ASLA yer almaz — parola ve özel anahtar
 * yalnızca yazılır, hiçbir uçtan geri okunmaz.
 */
export const credentialSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: credentialTypeSchema,
  username: z.string().nullable(),
  /** SHA256:... — anahtarın hangi anahtar olduğunu gizli veri sızdırmadan gösterir. */
  publicFingerprint: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Bu credential'ı kullanan sunucu sayısı; silmeden önce uyarmak için. */
  usedByHostCount: z.number().int().nonnegative(),
});
export type CredentialSummary = z.infer<typeof credentialSummarySchema>;

/** Gizli verinin şekli. Yapılandırma paketinin kasa bölümü de bunu kullanır. */
export const credentialSecretSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('password'),
    password: z.string().min(1, 'Parola boş olamaz').max(1024),
  }),
  z.object({
    type: z.literal('key'),
    privateKey: z.string().min(1, 'Özel anahtar boş olamaz').max(64 * 1024),
    passphrase: z.string().max(1024).optional(),
  }),
]);

export const createCredentialSchema = z
  .object({
    name: z.string().min(1, 'Ad gerekli').max(80),
    username: z.string().max(64).optional(),
  })
  .and(credentialSecretSchema);
export type CreateCredentialRequest = z.infer<typeof createCredentialSchema>;

/** Güncellemede gizli veri isteğe bağlı: yalnızca ad değiştirmek mümkün. */
export const updateCredentialSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  username: z.string().max(64).nullable().optional(),
  secret: credentialSecretSchema.optional(),
});
export type UpdateCredentialRequest = z.infer<typeof updateCredentialSchema>;

// ---------------------------------------------------------------- klasörler

export const folderSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string(),
  color: z.string().nullable(),
  sortIndex: z.number().int(),
});
export type Folder = z.infer<typeof folderSchema>;

export const createFolderSchema = z.object({
  name: z.string().min(1, 'Ad gerekli').max(80),
  parentId: z.string().uuid().nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Geçerli bir renk kodu değil').nullable().optional(),
});
export type CreateFolderRequest = z.infer<typeof createFolderSchema>;

export const updateFolderSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});
export type UpdateFolderRequest = z.infer<typeof updateFolderSchema>;

// ----------------------------------------------------------------- sunucular

export const hostSchema = z.object({
  id: z.string().uuid(),
  folderId: z.string().uuid().nullable(),
  name: z.string(),
  hostname: z.string(),
  port: z.number().int(),
  /** null = kimlik bilgisindeki kullanıcı adı devralınır. */
  username: z.string().nullable(),
  /**
   * Bağlantıda gerçekten kullanılacak kullanıcı adı (sunucu → kimlik bilgisi
   * sırasıyla çözülür). Sunucu hesaplar; istemcinin aynı mantığı her ekranda
   * tekrar kurması gerekmesin diye.
   */
  effectiveUsername: z.string().nullable(),
  credentialId: z.string().uuid().nullable(),
  defaultPath: z.string().nullable(),
  tags: z.array(z.string()),
  jumpHostId: z.string().uuid().nullable(),
  sortIndex: z.number().int(),
});
export type Host = z.infer<typeof hostSchema>;

export const hostInputSchema = z.object({
  name: z.string().min(1, 'Ad gerekli').max(80),
  hostname: z.string().min(1, 'Adres gerekli').max(253),
  port: z.number().int().min(1).max(65535).default(22),
  /**
   * Boş bırakılabilir: o zaman kimlik bilgisindeki kullanıcı adı kullanılır.
   * İkisi de boşsa sunucu anlaşılır bir hata döndürür.
   */
  username: z.string().max(64).nullable().optional(),
  credentialId: z.string().uuid().nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  defaultPath: z.string().max(4096).nullable().optional(),
  tags: z.array(z.string().max(32)).max(20).default([]),
  jumpHostId: z.string().uuid().nullable().optional(),
});
export type HostInput = z.infer<typeof hostInputSchema>;

/**
 * Sürükle-bırak sonucu. Hedef klasör ve yeni sıra tek istekte gönderilir;
 * sunucu kardeşlerin sortIndex değerlerini yeniden numaralandırır.
 */
/**
 * Hızlı bağlantı: envantere kalıcı kayıt eklemeden tek seferlik erişim.
 * Kimlik doğrulama üç yoldan biriyle: elle parola, elle özel anahtar ya da
 * kasadaki mevcut bir kayıt.
 */
export const quickConnectSchema = z
  .object({
    hostname: z.string().min(1, 'Adres gerekli').max(253),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.string().min(1, 'Kullanıcı adı gerekli').max(64),
  })
  .and(
    z.discriminatedUnion('auth', [
      z.object({ auth: z.literal('password'), password: z.string().min(1, 'Parola gerekli') }),
      z.object({
        auth: z.literal('key'),
        privateKey: z.string().min(1, 'Özel anahtar gerekli'),
        passphrase: z.string().optional(),
      }),
      z.object({ auth: z.literal('credential'), credentialId: z.string().uuid() }),
    ]),
  );
export type QuickConnectRequest = z.infer<typeof quickConnectSchema>;

export const moveNodeSchema = z.object({
  kind: z.enum(['folder', 'host']),
  id: z.string().uuid(),
  /** null = kök seviye */
  targetFolderId: z.string().uuid().nullable(),
  /** Hedef klasördeki kardeşler arasında kaçıncı sıraya yerleşecek. */
  position: z.number().int().min(0),
});
export type MoveNodeRequest = z.infer<typeof moveNodeSchema>;

/** Ağacın tamamı tek istekte gelir — envanter küçük, sayfalama gereksiz karmaşa. */
export const inventorySchema = z.object({
  folders: z.array(folderSchema),
  hosts: z.array(hostSchema),
});
export type Inventory = z.infer<typeof inventorySchema>;
