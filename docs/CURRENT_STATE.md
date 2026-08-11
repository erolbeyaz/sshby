# Mevcut durum

Son güncelleme: 2026-08-11

## Fazlar

| Faz | Kapsam | Durum |
|---|---|---|
| 0 | Monorepo, tema, Docker altyapısı | tamam |
| 1 | Kayıt, giriş, roller, oturum yönetimi | tamam |
| 2 | Credential kasası, klasör ağacı, sunucu envanteri | tamam |
| 3 | WebSocket terminal, paralel oturumlar, TOFU | tamam |
| 4 | SFTP dosya yöneticisi | tamam |
| 5 | Sunucu metrik paneli | tamam |
| 6 | Elasticsearch denetim akışı | tamam |
| 7 | Yapılandırma dışa/içe aktarma | tamam |
| 8 | Helm chart, güvenlik sıkılaştırma, dokümantasyon | **sırada** |
| 9 | Keycloak/OIDC | plan dışı, sonraki aşama |

## Çalışan özellikler

**Gösterge paneli** — ana sayfa: sürüm, çalışma süresi, veritabanı sağlığı,
bağlı/toplam sunucu, envanter sayaçları, hızlı eylemler, bağlantı durumlu sunucu
listesi ve son etkinlikler. Etkinlikler `audit_outbox`'tan okunur; arka plan
komutları (`source: system`) elenir. Sunuculara açılışta ping ATILMAZ — "bağlı"
sayısı gerçekten açık olan SSH oturumlarından türer.

**Arayüz düzeni** — solda dikey menü: Terminal ve Gösterge Paneli (sayfaya
götürür), ardından Ana Bilgisayarlar, Kimlik Bilgileri, Bağlantılar, Hızlı
Bağlantı (panel açar). Seçili bölüm vurgulu kalır ve içeriği hemen sağdaki
panelde **kayarak** açılır; aynı öğeye tekrar tıklamak paneli kapatır. Panel
genişliği sürüklenebilir ve `localStorage`da saklanır.

Yönetim işleri (kullanıcı yönetimi, denetim akışı, yapılandırma aktarımı)
yalnızca sağ üstteki hesap menüsünde. Üst bar bunun dışında marka, sunucu
sayısı, denetim rozeti ve dil seçicisi taşır.

`/` terminal çalışma alanıdır (açık oturum varsa onu gösterir, yoksa gösterge
paneline düşer); `/dashboard` her koşulda gösterge panelini açar — açık
oturumu olan kullanıcı da özetlere bakabilmeli.

Terminal açık değilken ana ekran sunucu kartlarıyla açılır: her kart durum
noktası, adres, etiketler ve tek tıkla bağlanma düğmesi taşır.

**Yan paneller** (dosyalar, metrikler, geçmiş) terminalin sağında açılır ve
aralarındaki sınır sürüklenerek boyutlandırılır; genişlik panel türü başına
saklanır. Etkin terminal sekmesi değiştiğinde, o sunucunun dosya paneli
**açıksa** öne gelir — açık değilse kendiliğinden açılmaz.

**Kimlik** — e-posta/parola kaydı (argon2id), ilk kullanıcı admin olur, JWT
access + httpOnly refresh, oturum listeleme/iptal, kullanıcı yönetimi ekranı.

**Kasa** — parola ve SSH anahtarı kayıtları, AES-256-GCM zarf şifreleme,
anahtarlar için `SHA256:` parmak izi (ssh-keygen ile birebir uyumlu doğrulandı),
kullanıcıya özel, kaç sunucuda kullanıldığı sayacı.

**Envanter** — iç içe klasörler, sürükle-bırak taşıma ve sıralama, döngüsel
taşıma engeli, klasör silinince sunucular köke taşınır (silinmez), etiketler.

Klasör ağacındaki her klasörün "alt klasör ekle" eylemi var; klasör formunda
üst klasör seçilebildiği için var olan bir klasör başka bir dala da
taşınabilir (kendi alt ağacı seçeneklerden düşer). Klasör seçici aranabilir ve
eşleşme yoksa yazılan adı doğrudan oluşturur — sunucu formunu terk etmeden
klasör açmak için.

Sunucu formu bölümlere ayrıldı: **protokoller** (yalnızca SSH), **bağlantı
ayrıntıları** (adres, port, kolay ad, kimlik bilgisi, SSH kullanıcısı),
**klasör ve gelişmiş** (klasör, etiketler, varsayılan dizin, özel notlar,
üstte sabitle). Notlar serbest metin; sabitlenen sunucular ağacın ve
listelerin başında toplanır.

**Terminal** — xterm.js, paralel oturumlar (aynı sunucuya birden fazla, numaralı),
sekme ve ızgara düzeni, sürükleyerek sıralama, sürüklenebilir ayırıcılarla
boyutlandırma, orta tıkla kapatma, sağ tık menüsü, Ctrl+C/Ctrl+V, çok satırlı
yapıştırma (bracketed paste).

Izgara panel sayısına göre kendini ayarlar: 1→1×1, 2→2×1, 3-4→2×2, 5-6→3×2,
7-9→3×3, 10-12→4×3. Her komşu iz çifti arasında bir ayırıcı var; bir sınırı
sürüklemek yalnızca komşu iki izi etkiler, uzaktaki paneller yerinde kalır.

**SFTP** — sunucu başına açılan bağımsız dosya panelleri (terminal sekmelerinden
ayrı, kendi sekme şeritleri var). Solda tembel yüklenen dizin ağacı, sağda
ad/değiştirilme/boyut/izin sütunlu tablo, kırıntı yolu, arama, depolama doluluk
göstergesi. Tek tıkla dizine girilir. Akış tabanlı indirme/yükleme (sürükle-bırak
dahil, ilerleme göstergeli), klasör oluşturma, yeniden adlandırma, silme, chmod.

Bağlantı önce açık terminal oturumundan ödünç alınır; yoksa kasadaki kimlikle
yeni bağlantı kurulur (host anahtarı güvenilir değilse reddedilir — HTTP içinde
soru sorulamaz).

**SFTP sudo modu** — yetki gerektiren dizinlerde SFTP alt sistemi yerine kabuk
komutları kullanılır (`find`, `base64`, `mkdir`…). Yetki hatasında parola istemi
kendiliğinden açılır; "Vazgeç" denen dizinde bir daha sorulmaz (başka dizine
geçilirse yeniden sorulabilir). Parola yalnızca süreç belleğinde tutulur, 15 dakika
kullanılmazsa silinir; diske, denetime ya da loga yazılmaz. Yollar kabuk için
tırnaklanır — komutlar root olarak çalıştığı için bu güvenliğin taşıyıcı kolonu.

**Metrikler** — sunucu başına açılan pano: CPU (halka + 1m/5m/15m yük), bellek
(+takas), disk (bağlama noktası seçici), ağ arayüzleri, çalışma süresi, sistem
bilgisi, işlemler, dinlenen portlar, SSH girişleri, sıcaklık. Veri tek bir
kabuk komutuyla toplanıyor — ajan kurulumu gerekmiyor. Canlı kip 5 sn'de bir
örnekliyor; metrik komutları denetimde `source: system` olarak işaretli.

**Komut geçmişi** — sunucu başına açılan panel; kaynak `audit_outbox`'taki
`ssh.command` olayları (sunucudaki `~/.bash_history` değil). Numaralı liste,
arama, kopyalama. Metrik toplayıcının komutları `source: system` filtresiyle
elenir. Silme düğmesi bilinçli olarak yok — denetim izi kullanıcı tarafından
silinebilir olmamalı.

**Hızlı bağlantı** — envantere kaydetmeden tek seferlik erişim. Sunucu
tarafında `ephemeral` işaretli geçici kayıt oluşur; terminal, SFTP, metrik ve
denetim katmanları değişmeden çalışır. Elle girilen gizli veri kasadakiyle aynı
zarf şifrelemesiyle saklanır ve 24 saat kullanılmazsa süpürülür. Geçici kayıtlar
envanter ağacında ve kasada görünmez, sıralamaya da katılmaz.

**Çok dillilik** — arayüz Türkçe ve İngilizce. Üst barda, hesap düğmesinin
solunda TR/ENG seçici. Tercih `localStorage`da saklanır; seçim yapılmadıysa
tarayıcının diline uyulur. Sözlükler `apps/web/src/lib/locales/` altında;
İngilizce sözlük Türkçenin anahtar kümesiyle tiplendiği için eksik çeviri
derlemeyi düşürür. API hata mesajları da çevrilir (sunucunun `code` alanına
göre), tanınmayan kodda sunucu metnine düşülür.

**URL yolları ve sekme başlıkları İngilizce** ve dilden bağımsız: `/`,
`/vault`, `/server/:id`, `/admin/users`, `/admin/audit`. Eski Türkçe yollar
(`/kasa`, `/sunucu/:id`, `/yonetim/*`) yönlendirme olarak korunuyor.

**İmza** — "powered by erolbeyaz" her ekranda: oturum açıkken alt durum
çubuğunda, giriş ekranında formun altında.

**Yapılandırma taşıma** — hesap menüsünden (çıkışın hemen üstünde) ve komut
paletinden açılan diyalog; her kullanıcı kendi verisiyle çalışır. Klasör ağacı,
sunucu envanteri ve kasa kayıtları tek bir JSON paketine yazılır. Gizli veri için iki kip:
**gizli veri hariç** (paylaşılabilir dosya) ya da **parola korumalı şifreli
paket** (scrypt N=65536, r=8, p=2 → AES-256-GCM). Kasadaki zarf şifreleme
kuruluma ve sahibe bağlı olduğu için gizli veri ham hâliyle taşınmaz; dışa
aktarımda çözülüp paket parolasından türetilen anahtarla yeniden şifrelenir.

Geçici (`ephemeral`) kayıtlar ve TOFU host anahtarları pakete girmez. İçe
aktarmada çakışma çözümü kullanıcının seçimi: yeniden adlandır (varsayılan),
atla, üzerine yaz. Atlanan ve üzerine yazılan kayıtlarda bağlar hedefteki
mevcut kayda kurulur. Gizli verisi olmayan bir kimlik bilgisi oluşturulamaz —
hedefte aynı adlı kayıt varsa sunucular ona bağlanır, yoksa kimlik bilgisiz
gelirler ve rapor bunu tek tek söyler.

**Güvenlik** — TOFU host key doğrulama (değişimde kırmızı MITM uyarısı),
kimlik bilgisiz sunucular için tek seferlik parola istemi, oturum sınırı.

**Denetim** — `audit_outbox` tablosuna ECS hizalı olaylar: bağlantı, kopma,
komutlar, host key olayları, envanter ve kasa değişiklikleri. Parolalar ve tam
ekran uygulama içindeki tuşlar kaydedilmez.

**Elasticsearch aktarımı** — arka plandaki gönderici kuyruğu bulk API ile ES'e
taşır. ES kapalıyken olaylar kuyrukta bekler, açılınca geçmiş kayıtlar da akar.
Başarısızlıkta üstel geri çekilme (5sn → 10 dk). Günlük indeks
(`sshby-audit-YYYY.AA.GG`). Birden çok API kopyası aynı kuyruğu güvenle
işleyebilir (`for update skip locked`).

Admin ekranı (`/yonetim/denetim`): düğüm adresleri, kimlik doğrulama
(yok/kullanıcı-parola/API anahtarı), CA sertifikası, indeks öneki, saklama
süresi, bağlantı testi, ILM politikası kurma ve canlı gönderici durumu.
Parolalar yanıtlarda maskelenir; boş bırakılan gizli alan "değiştirme" demektir.

`AUDIT_STRICT_MODE=true` iken denetim ES'e yazılamıyorsa yeni SSH oturumu
açılmaz ("kayıt tutulamıyorsa bağlanma" politikası). Varsayılan kapalı.

## Doğrulanmış test sonuçları

| paket | sonuç | kapsam |
|---|---|---|
| `test-faz2.ps1` | 13/13 | kasa, klasör, sürükle-bırak, izolasyon |
| `test-faz3.mjs` | 14/14 | bilet, TOFU, kabuk, resize, paralel oturum |
| `test-faz3b.mjs` | 4/4 | host key değişimi, red/kabul |
| `test-username.mjs` | 7/7 | kullanıcı adı devralma |
| `test-etkilesimli.mjs` | 7/7 | kimlik bilgisiz bağlanma |
| `test-sftp.mjs` | 19/19 | listeleme, yükleme, indirme, chmod, rename, silme, izolasyon |
| `test-sudo-modu.mjs` | 18/18 | sudo ile root dizinleri, kabuk kaçışı, ikili veri bütünlüğü |
| `test-gecmis.mjs` | 9/9 | komut geçmişi, sıra numaraları, `system` filtresi, izolasyon |
| `test-hizli.mjs` | 10/10 | hızlı bağlantı, envanterin kirlenmemesi, terminal/SFTP/metrik |
| `test-faz6.mjs` | 13/13 | ES bağlantı testi, parola maskeleme, aktarım, ECS alanları, kuyruk dayanıklılığı |
| `test-faz7.mjs` | 29/29 | paket biçimi, iki gizli veri kipi, yanlış parola reddi, üç çakışma stratejisi, geri yükleme sonrası gerçek SSH, izolasyon |
| `test-arayuz.mjs` | 12/12 | üç seviyeli iç içe klasör, klasör taşıma, döngü koruması, not/sabitleme, sıralama, eski paket uyumu |

Bu betikler **depoda değil, scratchpad'de** tutuluyor; kalıcı bir test paketi
henüz yok (bkz. teknik borç).

Ayrıca elle doğrulananlar: şifre metninin veritabanında düz metin içermemesi,
parolanın denetime ve loglara sızmaması, yapıştırılan komutların denetime
yazılması, UTF-8'in çerçeve sınırında bölünse bile bozulmaması.

## Bilinen sınırlar

- **Komut kaydı sezgiseldir.** Ok tuşlarıyla geçmişten çağrılan komutlar
  izlenemediği için tampon atılır. Kesin adli kayıt için sunucuda
  `auditd`/`snoopy` gerekir.
- **Parola bastırma yalnızca gerçek istemlerde çalışır** (sudo/ssh/su gibi,
  süreç beklerken). Kabuk isteminde yazılan bir parola komut sanılır.
- **Yanlış parola girilirse tekrar sorulmaz** — bağlantı kapanır, yeniden
  bağlanmak gerekir. Protokolde `retry` alanı hazır ama döngü kurulmadı.
- **Atlama sunucusu (jump host) bağlanmadı.** `hosts.jump_host_id` sütunu var,
  kullanılmıyor.
- **Pano API'si HTTPS gerektirir.** Sağ tık → Yapıştır düz HTTP'de çalışmaz;
  Ctrl+V her koşulda çalışır. Faz 8'de TLS bunu çözecek.
- **ILM yalnızca Elasticsearch'te çalışır.** OpenSearch'te `_ilm` ucu yok;
  o durumda saklama politikası kullanıcıya bırakılıyor ve arayüz bunu açıkça
  söylüyor.
- **`audit_outbox` çift rollü.** Hem gönderim kuyruğu hem de yerel denetim
  deposu: komut geçmişi ve gösterge panelindeki etkinlikler buradan okuyor.
  Bu yüzden gönderilmiş satırlar 30 gün saklanıyor
  (`AUDIT_RETAIN_SHIPPED_MS`), hemen silinmiyor. Daha uzun arşiv
  Elasticsearch'ün işi.
- **Helm chart yok.** `deploy/helm` dizini henüz oluşturulmadı; Kubernetes
  dağıtımı Faz 8'de.
- **Yapılandırma paketi TOFU kayıtlarını taşımaz.** Güvenilen host anahtarını
  başka bir kuruluma taşımak, orada ilk bağlantı doğrulamasını kullanıcı
  görmeden atlatmak olurdu. İçe aktarılan sunucularda ilk bağlantıda parmak
  izi yeniden sorulur — bilinçli bir kısıt.
- **Çeviri kapsamı arayüzle sınırlı.** Sunucudan gelen serbest metinler
  (içe aktarma raporundaki uyarılar, denetim gönderici durum mesajları) Türkçe
  üretiliyor ve İngilizce arayüzde de Türkçe görünüyor. Bunlar kayıt adları
  içerdiği için şablonlanmaları gerekir; sabit `code` taşıyan hatalar zaten
  çevriliyor.
- **Arayüz değişiklikleri tarayıcıda elle doğrulanmadı.** Tip denetimi,
  derleme ve dağıtılan paket içeriği doğrulandı; API tarafı 29/29 geçti. Dil
  değiştirme, yapılandırma diyaloğu ve imzanın görsel teyidi kullanıcıda.
- **Metrik panosu yalnızca anlık değer gösteriyor.** Zaman aralığı düğmeleri
  (1H/6H/24H/7D) ve sparkline geçmişi yapılmadı.
- **Dosya gezgini geri düğmesi beklendiği gibi çalışmıyor.** Geçmiş yığını
  hatalı; kullanıcı önceliklendirmedi.
- **Otomatik test paketi yok.** `pnpm test` betiği ve vitest bağımlılığı var
  ama depoda test dosyası yok.
- **Derleme kurumsal ağa bağımlı.** Her iki Dockerfile
  `deploy/docker/certs/corporate-ca.crt` dosyasını koşulsuz kopyalıyor; dosya
  olmadan derleme kırılır. Depo açık kaynak yayınlanmadan önce isteğe bağlı
  hale getirilmeli (bkz. TODO → açık kaynak yayına hazırlık).

## Ortam

- Uygulama: http://localhost:8088
- Test SSH sunucusu: `test-ssh` konteyneri, port 2222, `sshby`/`sshby`
- Postgres, Elasticsearch, Kibana compose içinde ayakta
- Kurumsal ağ: TLS kesmesi var (`NODE_EXTRA_CA_CERTS`), `lscr.io` engelli
