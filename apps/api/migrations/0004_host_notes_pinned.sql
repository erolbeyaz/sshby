-- Sunucu kaydına not ve sabitleme.
--
-- Sunucu formu bölümlenmiş bir düzene geçti (bağlantı / klasör / gelişmiş);
-- "gelişmiş" bölümünün iki gerçek alanı var:
--
--   notes  — bu sunucuya özel serbest metin. Bağlantı bilgisi olmayan ama
--            bağlanırken bilinmesi gereken şeyler (bakım penceresi, sahibi,
--            hangi uygulamayı çalıştırdığı) bugüne kadar hiçbir yere
--            yazılamıyordu; kullanıcılar bunu ad alanına sıkıştırıyordu.
--   pinned — sık kullanılan sunucuyu ağacın en üstünde tutar. Envanter
--            büyüdükçe her seferinde aynı üç sunucuyu aramak gerekiyordu.
--
-- Sıralama `pinned desc, sort_index asc`: sabitlenenler kendi aralarındaki
-- sürükle-bırak sırasını korur, listenin başına toplanır.

alter table hosts add column if not exists notes text;
alter table hosts add column if not exists pinned boolean not null default false;

-- Ağaç her çizimde sahibe göre sıralı okuyor; sabitleme sıralamanın parçası.
create index if not exists hosts_owner_pinned_idx on hosts (owner_id, pinned, sort_index);
