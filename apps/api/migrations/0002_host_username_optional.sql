-- Sunucudaki SSH kullanıcı adını isteğe bağlı hâle getirir.
--
-- Kasadaki `credentials.username` alanı vardı ama bağlantı kurulurken hiç
-- kullanılmıyordu; kullanıcı aynı bilgiyi iki kez giriyordu. Artık sunucu
-- alanı boş bırakıldığında kimlik bilgisindeki kullanıcı adı devralınır,
-- doldurulduğunda ise onu geçersiz kılar (aynı anahtarla farklı sunucularda
-- farklı hesaba bağlanmak yaygın bir durum).
--
-- Boş dizeyi NULL'a çeviriyoruz: "devral" durumunun tek bir gösterimi olmalı.

alter table hosts alter column username drop not null;

update hosts set username = null where btrim(username) = '';
