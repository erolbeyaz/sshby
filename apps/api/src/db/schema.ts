import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Sorgular için tip güvenli şema tanımı.
 *
 * DİKKAT: Şemanın kaynağı `apps/api/migrations/*.sql` dosyalarıdır; bu dosya
 * yalnızca Drizzle'ın sorguları tiplemesi için var. Tablo değiştirdiğinizde
 * ikisini birlikte güncelleyin (kısmi indeksler gibi bazı ayrıntılar burada
 * ifade edilemediği için birebir ayna değildir).
 */

/** Şifreli veriler base64 metin yerine bytea olarak tutulur — %33 yer tasarrufu ve tip güvenliği. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const userRole = pgEnum('user_role', ['admin', 'user']);
export const credentialType = pgEnum('credential_type', ['password', 'key']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    /** OIDC ile açılan hesaplarda null olur (Faz 9). */
    passwordHash: text('password_hash'),
    role: userRole('role').notNull().default('user'),
    isActive: boolean('is_active').notNull().default(true),
    /** Keycloak `sub` değeri — yerel hesabı dış kimlikle eşlemek için (Faz 9). */
    externalIdpSub: text('external_idp_sub'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // E-posta büyük/küçük harf duyarsız benzersiz olmalı: kayıt sırasında zaten
    // küçük harfe indiriyoruz, bu indeks ikinci savunma hattı.
    emailUnique: uniqueIndex('users_email_unique').on(t.email),
    externalSubUnique: uniqueIndex('users_external_idp_sub_unique').on(t.externalIdpSub),
  }),
);

/** Refresh token kayıtları — tekil oturum iptali (uzaktan çıkış) için gerekli. */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Token'ın kendisi değil, SHA-256 özeti saklanır. */
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hashUnique: uniqueIndex('auth_sessions_token_hash_unique').on(t.refreshTokenHash),
    byUser: index('auth_sessions_user_idx').on(t.userId),
  }),
);

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => folders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    /** Kardeşler arası sıra — sürükle-bırak sonrası kalıcı olsun diye. */
    sortIndex: integer('sort_index').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byOwner: index('folders_owner_idx').on(t.ownerId),
    byParent: index('folders_parent_idx').on(t.parentId),
  }),
);

export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: credentialType('type').notNull(),
    /** Anahtar tipi credential'larda varsayılan SSH kullanıcı adı taşıyabilir. */
    username: text('username'),
    /** AES-256-GCM ile DEK altında şifrelenmiş gizli veri (parola veya özel anahtar). */
    encBlob: bytea('enc_blob').notNull(),
    encNonce: bytea('enc_nonce').notNull(),
    encTag: bytea('enc_tag').notNull(),
    /** DEK, master key (KEK) ile sarılmış hâlde. */
    wrappedDek: bytea('wrapped_dek').notNull(),
    dekNonce: bytea('dek_nonce').notNull(),
    dekTag: bytea('dek_tag').notNull(),
    keyVersion: smallint('key_version').notNull().default(1),
    /** Kullanıcıya gösterilebilen, gizli olmayan tanımlayıcı (SHA256:...). */
    publicFingerprint: text('public_fingerprint'),
    /** Hızlı bağlantıyla oluşturuldu; kasada görünmez, süpürülür. */
    ephemeral: boolean('ephemeral').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byOwner: index('credentials_owner_idx').on(t.ownerId),
    nameUniquePerOwner: uniqueIndex('credentials_owner_name_unique').on(t.ownerId, t.name),
  }),
);

export const hosts = pgTable(
  'hosts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    hostname: text('hostname').notNull(),
    port: integer('port').notNull().default(22),
    /** null = kimlik bilgisindeki kullanıcı adı devralınır. */
    username: text('username'),
    /** Hızlı bağlantıyla oluşturuldu; envanterde görünmez, süpürülür. */
    ephemeral: boolean('ephemeral').notNull().default(false),
    /**
     * Credential silinirse host kalır ama bağlanamaz duruma düşer; sessizce
     * başka bir kimliğe kaymasındansa bu daha güvenli.
     */
    credentialId: uuid('credential_id').references(() => credentials.id, { onDelete: 'set null' }),
    /** SFTP tarayıcısının açılışta gideceği dizin. */
    defaultPath: text('default_path'),
    /** Bağlantı bilgisi olmayan ama bağlanırken bilinmesi gereken serbest not. */
    notes: text('notes'),
    /** Sabitlenen sunucular ağacın en üstünde toplanır. */
    pinned: boolean('pinned').notNull().default(false),
    tags: text('tags').array().notNull().default([]),
    jumpHostId: uuid('jump_host_id').references((): AnyPgColumn => hosts.id, {
      onDelete: 'set null',
    }),
    sortIndex: integer('sort_index').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byOwner: index('hosts_owner_idx').on(t.ownerId),
    byFolder: index('hosts_folder_idx').on(t.folderId),
  }),
);

/**
 * TOFU (trust on first use) kaydı. Bir host'un anahtarı ilk bağlantıda buraya
 * yazılır; sonradan değişirse bağlantı kesilir ve olay denetime düşer.
 */
export const hostKeys = pgTable(
  'host_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Host kaydı silinse bile adres/port bazlı güven korunur. */
    hostname: text('hostname').notNull(),
    port: integer('port').notNull(),
    algorithm: text('algorithm').notNull(),
    fingerprintSha256: text('fingerprint_sha256').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex('host_keys_owner_endpoint_unique').on(t.ownerId, t.hostname, t.port),
  }),
);

/** Anahtar/değer uygulama ayarları (Elasticsearch yapılandırması, kayıt aç/kapa vb.). */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Denetim olayları önce buraya, işlemin içinde yazılır; arka plandaki gönderici
 * Elasticsearch'e bulk olarak taşır. Böylece ES kapalıyken denetim kaybolmaz.
 */
export const auditOutbox = pgTable(
  'audit_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** Bir sonraki denemenin en erken zamanı — üstel geri çekilme. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
  },
  (t) => ({
    // Gönderici yalnızca gönderilmemiş ve zamanı gelmiş kayıtları tarar.
    pending: index('audit_outbox_pending_idx').on(t.shippedAt, t.nextAttemptAt),
  }),
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type FolderRow = typeof folders.$inferSelect;
export type HostRow = typeof hosts.$inferSelect;
export type CredentialRow = typeof credentials.$inferSelect;
export type HostKeyRow = typeof hostKeys.$inferSelect;
export type AuditOutboxRow = typeof auditOutbox.$inferSelect;
