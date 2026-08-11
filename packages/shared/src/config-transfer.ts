import { z } from 'zod';
import { credentialSecretSchema, credentialTypeSchema } from './inventory.js';

/**
 * Yapılandırma dışa/içe aktarma paketi.
 *
 * Paket klasör ağacını, sunucu envanterini ve kasa kayıtlarının meta verisini
 * taşır. Gizli veri (parola, özel anahtar) ham şifreli hâliyle taşınamaz:
 * kasadaki blob kurulumun kök anahtarına bağlı ve AAD'ye sahip kimliği
 * işlenmiş durumda — başka bir kurulumda, hatta aynı kurulumda başka bir
 * kullanıcıda çözülemez. Bu yüzden dışa aktarımda gizli veri çözülüp
 * kullanıcının verdiği paroladan türetilen bağımsız bir anahtarla yeniden
 * şifrelenir.
 *
 * Paket içindeki kimlikler kaynak kurulumun UUID'leridir. Kayıtlar arası
 * bağları (klasör → üst klasör, sunucu → kimlik bilgisi) taşımak için bir
 * anahtar gerekiyor; içe aktarım eski → yeni eşlemesi kurup her kayda yeni
 * UUID verir, yani kaynak kimlikler hedef kuruluma hiç yazılmaz.
 */

export const CONFIG_PACKAGE_FORMAT = 'sshby-config';
export const CONFIG_PACKAGE_VERSION = 1;

/**
 * Gizli verinin pakete nasıl gireceği. Kullanıcının bilinçli seçimi olmalı:
 * `encrypted` kasanın tamamını tek bir dosyaya taşır, `excluded` ise paketi
 * gizli veri içermediği için serbestçe paylaşılabilir kılar.
 */
export const configSecretModeSchema = z.enum(['excluded', 'encrypted']);
export type ConfigSecretMode = z.infer<typeof configSecretModeSchema>;

/**
 * Paket parolasından anahtar türetme. Parametreler pakete yazılır ki ileride
 * maliyeti artırdığımızda eski paketler hâlâ açılabilsin.
 *
 * scrypt seçildi: Node'un içinde var, ek bağımlılık getirmiyor ve bellek-sert
 * olduğu için GPU ile kaba kuvvet denemesini pahalı kılıyor.
 */
export const configKdfSchema = z.object({
  algorithm: z.literal('scrypt'),
  /** base64 */
  salt: z.string().min(1),
  cost: z.number().int().min(16384),
  blockSize: z.number().int().min(1),
  parallelization: z.number().int().min(1),
  keyLength: z.literal(32),
});
export type ConfigKdf = z.infer<typeof configKdfSchema>;

/** Paketin şifreli kasa bölümü — AES-256-GCM, alanlar base64. */
export const configVaultSchema = z.object({
  kdf: configKdfSchema,
  nonce: z.string().min(1),
  tag: z.string().min(1),
  ciphertext: z.string().min(1),
});
export type ConfigVault = z.infer<typeof configVaultSchema>;

/**
 * Kasa çözüldüğünde ortaya çıkan gövde: kaynak credential kimliği → gizli veri.
 * Meta veri (ad, tip, kullanıcı adı) şifresiz bölümde durur; burada yalnızca
 * gerçekten gizli olan alanlar var.
 */
export const configVaultPayloadSchema = z.record(z.string().uuid(), credentialSecretSchema);
export type ConfigVaultPayload = z.infer<typeof configVaultPayloadSchema>;

// ------------------------------------------------------------ paket kayıtları

export const exportedFolderSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string(),
  color: z.string().nullable(),
  sortIndex: z.number().int(),
});
export type ExportedFolder = z.infer<typeof exportedFolderSchema>;

/**
 * Kasa kaydının gizli olmayan yüzü. Gizli veri hariç dışa aktarımda da yazılır:
 * içe aktarırken hedef kurulumda aynı adlı bir kayıt varsa sunucular ona
 * bağlanabilsin, yoksa kullanıcı hangi kimliğin eksik olduğunu görebilsin diye.
 */
export const exportedCredentialSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: credentialTypeSchema,
  username: z.string().nullable(),
  /** SHA256:... — hangi anahtar olduğunu gizli veri sızdırmadan tanıtır. */
  publicFingerprint: z.string().nullable(),
});
export type ExportedCredential = z.infer<typeof exportedCredentialSchema>;

export const exportedHostSchema = z.object({
  id: z.string().uuid(),
  folderId: z.string().uuid().nullable(),
  name: z.string(),
  hostname: z.string(),
  port: z.number().int(),
  username: z.string().nullable(),
  credentialId: z.string().uuid().nullable(),
  defaultPath: z.string().nullable(),
  tags: z.array(z.string()),
  jumpHostId: z.string().uuid().nullable(),
  sortIndex: z.number().int(),
});
export type ExportedHost = z.infer<typeof exportedHostSchema>;

export const configPackageSchema = z
  .object({
    format: z.literal(CONFIG_PACKAGE_FORMAT),
    version: z.literal(CONFIG_PACKAGE_VERSION),
    exportedAt: z.string().datetime(),
    /** Bilgi amaçlı; içe aktarımda kullanılmaz, doğrulanmaz. */
    exportedBy: z.string().optional(),
    secrets: configSecretModeSchema,
    folders: z.array(exportedFolderSchema),
    credentials: z.array(exportedCredentialSchema),
    hosts: z.array(exportedHostSchema),
    vault: configVaultSchema.optional(),
  })
  .superRefine((pkg, ctx) => {
    if (pkg.secrets === 'encrypted' && !pkg.vault) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vault'],
        message: 'Şifreli pakette kasa bölümü eksik — dosya bozulmuş olabilir.',
      });
    }
    if (pkg.secrets === 'excluded' && pkg.vault) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vault'],
        message: 'Gizli veri içermeyen pakette kasa bölümü bulunamaz.',
      });
    }
  });
export type ConfigPackage = z.infer<typeof configPackageSchema>;

// -------------------------------------------------------------------- istekler

/**
 * Paket parolası en az 12 karakter: zayıf bir parola kasanın tamamını tek
 * dosyada açığa çıkarır ve dosya bir kez dışarı çıktığında saldırgan sınırsız
 * deneme hakkına sahip olur.
 */
export const configExportSchema = z.discriminatedUnion('secrets', [
  z.object({ secrets: z.literal('excluded') }),
  z.object({
    secrets: z.literal('encrypted'),
    password: z.string().min(12, 'Paket parolası en az 12 karakter olmalı').max(1024),
  }),
]);
export type ConfigExportRequest = z.infer<typeof configExportSchema>;

/**
 * Aynı adlı kayıtla karşılaşınca ne yapılacağı.
 * - `rename` — yeni kayıt "(2)" ekiyle oluşturulur; hiçbir veri kaybolmaz
 * - `skip`   — mevcut kayıt korunur, paketteki atlanır
 * - `overwrite` — mevcut kayıt paketteki değerlerle güncellenir
 */
export const importConflictStrategySchema = z.enum(['rename', 'skip', 'overwrite']);
export type ImportConflictStrategy = z.infer<typeof importConflictStrategySchema>;

export const configImportSchema = z.object({
  package: configPackageSchema,
  /** Şifreli paketi açmak için; gizli veri içermeyen pakette gerekmez. */
  password: z.string().max(1024).optional(),
  conflictStrategy: importConflictStrategySchema.default('rename'),
});
export type ConfigImportRequest = z.infer<typeof configImportSchema>;

const importCountsSchema = z.object({
  created: z.number().int().nonnegative(),
  renamed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  overwritten: z.number().int().nonnegative(),
});
export type ImportCounts = z.infer<typeof importCountsSchema>;

/**
 * İçe aktarım raporu. `warnings` sessizce yapılan tavizleri sayar — gizli
 * verisi olmayan kimlik bilgisi, kimliksiz kalan sunucu gibi. Kullanıcı neyin
 * eksik geldiğini görmeden "içe aktarıldı" demek yanıltıcı olurdu.
 */
export const configImportResultSchema = z.object({
  folders: importCountsSchema,
  credentials: importCountsSchema,
  hosts: importCountsSchema,
  warnings: z.array(z.string()),
});
export type ConfigImportResult = z.infer<typeof configImportResultSchema>;
