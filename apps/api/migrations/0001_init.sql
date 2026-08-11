-- sshby ilk şema.
-- Not: Bu dosya uygulandıktan sonra ASLA düzenlenmez; değişiklik için yeni
-- numaralı dosya eklenir (migrate.ts checksum uyuşmazlığında hata verir).

create extension if not exists "pgcrypto";

create type user_role as enum ('admin', 'user');
create type credential_type as enum ('password', 'key');

-- ---------------------------------------------------------------- kullanıcılar

create table users (
  id                  uuid primary key default gen_random_uuid(),
  email               text        not null,
  display_name        text        not null,
  password_hash       text,
  role                user_role   not null default 'user',
  is_active           boolean     not null default true,
  external_idp_sub    text,
  failed_login_count  integer     not null default 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- E-posta zaten küçük harfe indirilerek yazılıyor; bu indeks ikinci savunma hattı.
create unique index users_email_unique on users (email);
create unique index users_external_idp_sub_unique on users (external_idp_sub)
  where external_idp_sub is not null;

create table auth_sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid        not null references users (id) on delete cascade,
  refresh_token_hash  text        not null,
  user_agent          text,
  ip                  text,
  expires_at          timestamptz not null,
  revoked_at          timestamptz,
  created_at          timestamptz not null default now()
);

create unique index auth_sessions_token_hash_unique on auth_sessions (refresh_token_hash);
create index auth_sessions_user_idx on auth_sessions (user_id);
-- Süresi geçmiş oturumların temizlik taraması için.
create index auth_sessions_expires_idx on auth_sessions (expires_at);

-- ------------------------------------------------------------------- envanter

create table folders (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid        not null references users (id) on delete cascade,
  parent_id   uuid        references folders (id) on delete cascade,
  name        text        not null,
  color       text,
  sort_index  integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index folders_owner_idx on folders (owner_id);
create index folders_parent_idx on folders (parent_id);

create table credentials (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid            not null references users (id) on delete cascade,
  name                text            not null,
  type                credential_type not null,
  username            text,
  -- Gizli veri: AES-256-GCM, veri anahtarı (DEK) altında.
  enc_blob            bytea           not null,
  enc_nonce           bytea           not null,
  enc_tag             bytea           not null,
  -- DEK'in kendisi master anahtar (KEK) ile sarılmış hâlde.
  wrapped_dek         bytea           not null,
  dek_nonce           bytea           not null,
  dek_tag             bytea           not null,
  key_version         smallint        not null default 1,
  public_fingerprint  text,
  created_at          timestamptz     not null default now(),
  updated_at          timestamptz     not null default now()
);

create index credentials_owner_idx on credentials (owner_id);
create unique index credentials_owner_name_unique on credentials (owner_id, name);

create table hosts (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid        not null references users (id) on delete cascade,
  folder_id      uuid        references folders (id) on delete set null,
  name           text        not null,
  hostname       text        not null,
  port           integer     not null default 22,
  username       text        not null,
  -- Credential silinirse host bağlanamaz duruma düşer; sessizce başka bir
  -- kimliğe kaymasındansa açıkça bozulması güvenli.
  credential_id  uuid        references credentials (id) on delete set null,
  default_path   text,
  tags           text[]      not null default '{}',
  jump_host_id   uuid        references hosts (id) on delete set null,
  sort_index     integer     not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint hosts_port_range check (port between 1 and 65535)
);

create index hosts_owner_idx on hosts (owner_id);
create index hosts_folder_idx on hosts (folder_id);

-- TOFU kaydı: host kaydı silinse bile adres/port bazlı güven korunur.
create table host_keys (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid        not null references users (id) on delete cascade,
  hostname            text        not null,
  port                integer     not null,
  algorithm           text        not null,
  fingerprint_sha256  text        not null,
  first_seen_at       timestamptz not null default now(),
  accepted_at         timestamptz not null default now()
);

create unique index host_keys_owner_endpoint_unique on host_keys (owner_id, hostname, port);

-- --------------------------------------------------------------------- ayarlar

create table app_settings (
  key         text primary key,
  value       jsonb       not null,
  updated_by  uuid        references users (id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- --------------------------------------------------------------------- denetim

-- Olaylar önce buraya işlemin içinde yazılır, arka plandaki gönderici
-- Elasticsearch'e taşır. ES kapalıyken denetim kaybolmaz.
create table audit_outbox (
  id               uuid primary key default gen_random_uuid(),
  occurred_at      timestamptz not null default now(),
  payload          jsonb       not null,
  attempts         integer     not null default 0,
  last_error       text,
  next_attempt_at  timestamptz not null default now(),
  shipped_at       timestamptz
);

-- Gönderici yalnızca gönderilmemiş ve zamanı gelmiş kayıtları tarar; kısmi
-- indeks sayesinde gönderilmiş milyonlarca satır taramaya dahil olmaz.
create index audit_outbox_pending_idx on audit_outbox (next_attempt_at, occurred_at)
  where shipped_at is null;
-- Gönderilmiş kayıtların budanması için.
create index audit_outbox_shipped_idx on audit_outbox (shipped_at)
  where shipped_at is not null;
