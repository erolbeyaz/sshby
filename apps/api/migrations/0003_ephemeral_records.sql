-- Hızlı bağlantı için geçici kayıtlar.
--
-- Hızlı bağlantı, envantere kalıcı kayıt eklemeden tek seferlik erişim
-- sağlıyor. Bağlantı bilgilerini imzalı bilete gömmek yerine geçici satır
-- yazmak, terminal/SFTP/metrik/geçmiş katmanlarının hepsinin değişmeden
-- çalışmasını sağlıyor — hepsi sunucu kimliğiyle konuşuyor.
--
-- `ephemeral` kayıtlar envanter ve kasa listelerinde görünmez; kullanılmadan
-- 24 saat geçerse süpürülür.

alter table hosts add column if not exists ephemeral boolean not null default false;
alter table credentials add column if not exists ephemeral boolean not null default false;

-- Süpürme sorgusu bu iki sütunu birlikte tarıyor.
create index if not exists hosts_ephemeral_idx on hosts (ephemeral, updated_at)
  where ephemeral;
create index if not exists credentials_ephemeral_idx on credentials (ephemeral, updated_at)
  where ephemeral;
