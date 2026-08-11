# Kararlar

Neden böyle yapıldığı, sonradan sorgulanmasın diye. Her madde bir kez tartışıldı
ve bir bedeli var; değiştirmeden önce bedelini okuyun.

## Altyapı

**Docker Compose ile hem geliştirme hem üretim; Kubernetes'e ham manifest ile.**

Önceki karar "Compose ile geliştirme, Helm ile üretim" idi. Gerekçesi hedefin
Kubernetes olmasıydı — o hedef değişmedi, ama Helm'in getirdiği şablon katmanı
(values şeması, chart sürümleme, `helm upgrade` durumu) bu ölçekteki bir
uygulama için taşınan yükten fazlasını çözmüyordu. Kullanıcı Helm'i öğrenme ve
bakım maliyetini almak istemedi.

Yerine iki aşama:

1. **Tek makine Docker dağıtımı** (`docker-compose.prod.yml`) — bugün çalışan
   kurulum şekli. Geliştirme dosyasından ayrı: Elasticsearch/Kibana ve test SSH
   sunucusu yok, gizli anahtarların varsayılanı yok.
2. **Kubernetes ham manifest'leri** — Deployment/Service/Ingress/Secret,
   şablonsuz. Okunabilir, `kubectl apply -f` ile giden, ne yaptığı gözle
   görülen dosyalar.

**Elasticsearch uygulamayla birlikte kurulmaz.** Üretim compose'unda ES yok;
denetim var olan bir kümeye gönderiliyor. Kurumlarda ES zaten merkezi bir
hizmet ve uygulama başına bir küme kaldırmak ne istenen ne de sürdürülebilir.
ES olmadan da tam çalışır: olaylar veritabanı kuyruğunda birikir.

**Üretimde gizli anahtarların varsayılanı yok.** Compose'un `${DEĞİŞKEN:?mesaj}`
sözdizimi değer verilmediğinde yığını hata ile durduruyor. Geliştirme
dosyasındaki `dev-only-…` varsayılanları üretime sızarsa kasa herkesin bildiği
bir anahtarla şifrelenmiş olurdu; bunun sessizce olabilmesi kabul edilemez.

**ES ayarları ortam değişkeninde değil, veritabanında.** Ortam değişkenindeki
bir ES parolası `docker inspect` çıktısında ve süreç listesinde görünür. Ayarlar
`app_settings` tablosunda yaşıyor, parolalar yanıtlarda maskeleniyor ve adres
değiştirmek konteyner yeniden başlatmayı gerektirmiyor.

**Web varsayılan olarak yalnızca `127.0.0.1`'e bağlanır.** Dışarı açmak bilinçli
bir adım olmalı (`SSHBY_BIND_ADDRESS=0.0.0.0`): uygulama oturum çerezleri, SSH
parolaları ve dosya içerikleri taşıyor ve TLS'i kendisi sonlandırmıyor.

**Veritabanı parolası URL-güvenli olmalı.** `DATABASE_URL`'e gömüldüğü için
base64 alfabesindeki `/` adresi bölüyor ve `pg` kullanıcı adını host sanıyor.
Sinsi tarafı, Postgres konteynerinin sağlıklı başlaması: parolayı ortam
değişkeninden alıyor, adresten değil. Hata yalnızca migration aşamasında ve
`getaddrinfo EAI_AGAIN` gibi ilgisiz görünen bir mesajla ortaya çıkıyor.
Öneri `openssl rand -hex`.

## Kubernetes

**Kayıt defteri adresi kustomize'ın `images:` bölümünde, manifest'lerde değil.**
Manifest'ler `sshby-api` / `sshby-web` kısa adlarını taşıyor; Harbor (ya da
başka bir kayıt defteri) yolu `kustomization.yaml`da tek yerde duruyor. Aksi
hâlde kayıt defterini değiştirmek üç dosyada arama-değiştirme demekti ve biri
unutulduğunda hata ancak pod çekilemediğinde görülüyordu.

**`api` tek kopya (`replicas: 1`, `strategy: Recreate`).** SSH oturumları süreç
belleğinde yaşıyor. Terminal WebSocket'i bir pod'a bağlanıp orada kalıyor, sorun
değil — ama SFTP, metrik ve komut geçmişi HTTP üzerinden geliyor ve istek başka
bir pod'a düşerse orada o oturum yok: SFTP açık terminalden bağlantı ödünç
alamıyor, kasadaki kimlikle yeniden bağlanmaya çalışıyor ve etkileşimli
parolayla açılmış oturumlarda bu imkânsız (parolayı saklamıyoruz). Sudo parolası
da süreç belleğinde.

`sessionAffinity: ClientIP` kısmi çare olurdu ama proxy arkasındaki NAT'lı
istemcilerde güvenilmez. Gerçek çözüm oturum durumunu paylaşmak — yapılmadı.
`RollingUpdate` yerine `Recreate`, çünkü tek kopyada bile yükseltme anında iki
pod'u yan yana çalıştırıp aynı sorunu üretiyordu. Denetim kuyruğu ölçeklemeye
hazır (`for update skip locked`); darboğaz orada değil.

**Sıralama `initContainer`larla kuruldu, apply sırasıyla değil.** Compose'daki
`service_completed_successfully` bağımlılığının Kubernetes karşılığı yok.
Migration Job'u postgres'i, `api` de `schema_migrations` tablosunun varlığını
bekliyor. Böylece `kubectl apply -k` tek komutla ve sıra gözetmeden
çalışabiliyor; uygulama hiçbir zaman eksik şemayla açılmıyor.

**Migration Job'unda `ttlSecondsAfterFinished`.** Job'un `spec`i değiştirilemez,
aynı adla ikinci kez apply etmek hata veriyor. TTL bitince Job kendini siliyor
ve bir sonraki yükseltmede aynı dosya sorunsuz uygulanabiliyor.

**`commonLabels` yerine `labels`.** Eskisi etiketleri Deployment ve StatefulSet
selector'larına da ekliyordu; selector değiştirilemez bir alan olduğu için var
olan bir kuruluma sonradan etiket eklemek `kubectl apply`i kırıyordu.

**Elle yazılmış SQL migration'lar, drizzle-kit üretimi değil.** Şemanın ne zaman
ne olacağı gözle görülür, üretimde sürpriz DDL çıkmaz. Şema tipleri yine
`schema.ts`ten gelir; `schema.ts` ve `migrations/*.sql` **elle birlikte**
güncellenir.

**`node-linker=hoisted`.** pnpm'in sembolik bağ ağacı Docker aşamaları arasında
kopyalanınca kırılıyor. Düz `node_modules` tek parça taşınabiliyor.

**Bookworm-slim, Alpine değil.** glibc üzerinde native paketlerin hazır derlemesi
sorunsuz iniyor; musl'da derleyici kurmak gerekiyordu.

**`NODE_EXTRA_CA_CERTS`.** Kurumsal ağda TLS trafiği bir güvenlik ağ geçidi
(Forcepoint Cloud Security Gateway) tarafından kesiliyor; node imajında sistem
CA deposu olmadığı için `update-ca-certificates` yerine bu değişken kullanılıyor.

Bu bir **derleme ortamı çözümüdür**, uygulamanın özelliği değil. SSH bağlantıları
TLS kullanmaz, dolayısıyla bu sertifikanın hedef sunuculara erişimle hiçbir
ilgisi yoktur; çalışma zamanında yalnızca Elasticsearch'e HTTPS ile bağlanırken
anlam kazanabilir.

Depo açık kaynak yayınlanacağı için bu bağımlılık **isteğe bağlı hale
getirilecek**: kurumsal ağ dışında derleyen birinin sertifika dosyası olmadan da
derleyebilmesi gerekiyor. Ayrıntı: `TODO.md` → açık kaynak yayına hazırlık.

## Güvenlik

**Zarf şifreleme (KEK/DEK).** Kök anahtar hiçbir zaman doğrudan kullanıcı
verisine uygulanmaz; rotasyon gigabaytları yeniden şifrelemeyi gerektirmez.
AAD'ye sahip kimliği bağlanır.

**Gizli veri hiçbir yanıtta dönmez.** Kasa kaydı yazılır, okunmaz — yalnızca
üzerine yazılabilir. Listede kullanıcıya `SHA256:...` parmak izi gösterilir.

**Ctrl+C seçim yokken SIGINT gönderir.** Her koşulda kopyalamaya çevirmek
terminalin en temel tuşunu bozardı. Seçim varken kopyalar (VS Code ve Windows
Terminal de böyle).

**Ctrl+V yakalanmaz.** Tarayıcının kendi yapıştırma olayı izin istemeden, HTTPS
gerektirmeden, her tarayıcıda çalışıyor. `navigator.clipboard.readText()` ile
okumaya kalkarsak izin reddedildiğinde yapıştırmayı tamamen kırarız.
Programatik okuma yalnızca sağ tık menüsünde (orada yerel alternatif yok).

**Parola modu mandallıdır.** Ekranda bir parola istemi görülünce bayrak takılır
ve yalnızca Enter temizler. Sıfırlanabilir olduğunda araya giren herhangi bir
çıktı bayrağı düşürüyor ve parola denetime yazılıyordu. Yanlış pozitif hâlinde
en fazla bir meşru komut kaydedilmez — parola sızdırmaya kıyasla kabul edilebilir.

**Kimlik bilgisi zorunlu değil.** Kasada kaydı olmayan sunucuya bağlanırken
parola sorulur ve hiçbir yere yazılmaz. Tek seferlik erişimler için kullanıcıyı
kasaya kayıt eklemeye zorlamak gereksiz gizli veri biriktirir.

**Geçersiz UUID → 404, 500 değil.** Var olan ve olmayan kimlikler aynı yanıtı
almalı; ayrıca Postgres hatasının 500 olarak sızması istemci hatasını sunucu
hatası gibi gösteriyordu.

## Protokol

**WebSocket bileti.** Tarayıcı WS'e `Authorization` başlığı ekleyemiyor; access
token'ı sorgu dizesine koymak onu nginx loglarına, tarayıcı geçmişine ve
referrer başlıklarına sızdırır. 30 saniyelik, tek sunucuya yetkili bilet.

**WebSocket'ler `/ws` altında, `/api` altında değil.** nginx `/api/` konumunda
`Connection ""` kuruyor (keepalive'lı upstream için gerekli), bu da Upgrade el
sıkışmasını sessizce bozuyor.

**Tuş vuruşları ikili, kontrol mesajları JSON.** Her tuşu JSON'a sarmak gecikme
ve çöp üretirdi; ayrıca çerçeve tipiyle ayırmak kullanıcının yazdığı JSON benzeri
metnin yanlış yorumlanmasını imkânsız kılıyor.

**`ready` kabuk açıldıktan sonra gönderilir.** Daha erken gönderildiğinde istemci
hemen yazmaya başlıyor ama kanal henüz yok; ilk komut sessizce kayboluyordu.

## Ön yüz

**Terminal yönlendiricinin dışında yaşar.** Sayfa değişince sökülmez, gizlenir.
Sökülseydi WebSocket kapanır ve tüm SSH oturumları ölürdü. Aynı kural sekmeler
arası geçiş için de geçerli.

**Tek tık seçer, çift tık bağlanır.** Dosya yöneticisi alışkanlığı. Çift tıklama
keşfedilebilir olmadığı için satırda bir de terminal düğmesi var.

**Ölçüm yalnızca boyut gerçekten değiştiğinde yapılır.** Koşulsuz `fit()`
çağırmak sonsuz döngü üretiyordu: fit → kaydırma çubuğu → kapsayıcı genişliği →
ResizeObserver → fit. Ayrıca A→B→A salınımına karşı 500 ms'lik pencerede
çalışan ikinci bir koruma var.

**`index.html` önbelleğe alınmaz.** Varlıklar içerik özetli adlar taşır ve
sonsuza kadar önbelleklenebilir, ama hangi varlıkların yükleneceğini `index.html`
söyler. Önbellekte kalırsa dağıtım sessizce etkisiz olur.

**nginx güvenlik başlıkları ayrı dosyada.** `add_header` kalıtımı tuzaklı: bir iç
blokta tek bir `add_header` tanımlamak dış bloktan gelen **tümünü** iptal eder.
Başlık ekleyen her blok `security-headers.conf`u `include` etmeli.

## Dosya, metrik ve geçmiş katmanları

**SFTP HTTP üzerinden, WebSocket üzerinden değil.** İndirme/yükleme doğal olarak
akış tabanlı; HTTP bunu bedavaya veriyor (tarayıcı indirmesi, ilerleme, iptal).
Aynısını WebSocket üzerine kurmak çerçeveleme ve akış kontrolünü elle yazmak
demekti.

**SFTP bağlantısı önce terminalden ödünç alınır.** Sunucuya ait açık bir
terminal varsa onun SSH bağlantısında yeni bir SFTP kanalı açılır. Hem hızlı,
hem de etkileşimli parolayla bağlanılmış sunucularda tek yol — parolayı
saklamadığımız için ikinci kez kimlik doğrulayamayız.

**Sudo modu SFTP yerine kabuk komutları kullanır.** SFTP alt sistemi sshd
tarafından giriş yapan kullanıcı kimliğiyle ayrı bir süreç olarak başlatılır;
terminalde `sudo su` yapmak onu etkilemez. `ssh2` SFTP sınıfını dışa
aktarmadığı için `sudo sftp-server`ı sarmak da mümkün değil. Bedeli açık:
`find` çıktısı ayrıştırılıyor, ikili veri base64 ile taşınıyor (~%33 fazladan
trafik). Bu yüzden sudo varsayılan değil, kullanıcının açtığı bir kip.

**Sudo parolası yalnızca süreç belleğinde.** Kasaya yazılmaz, denetime yazılmaz,
15 dakika kullanılmazsa silinir. Kalıcı olsaydı "yükseltilmiş yetkiyi saklama"
kararını kullanıcı adına vermiş olurduk.

**Metrikler tek bir kabuk komutuyla toplanır.** Her metrik için ayrı `exec`
açmak, canlı yenilenen bir panoda toplam gecikmeyi saniyelere çıkarırdı.
Hedef sunuculara ajan kurmak gerekmiyor — kurumsal ortamda benimsenmeyi
kolaylaştıran bilinçli bir kısıt.

**Arka plan komutları `source: 'system'` ile işaretlenir.** Metrik toplayıcı
5 saniyede bir komut çalıştırıyor; işaretlemeseydik denetim ve komut geçmişi
ekranlarında kullanıcının gerçek komutlarını boğardı.

**Komut geçmişi `~/.bash_history`den değil, denetim kaydından türer.** Kendi
kaydımızda kimin çalıştırdığı bilgisi var (bash_history yalnızca Linux hesabını
bilir), yapıştırılan komutlar dahil, ve kabuk kapanmadan görünür.

**Komut geçmişinde "temizle" düğmesi yok.** Kullanıcının kendi denetim izini
silebilmesi denetimi anlamsız kılardı. Yalnızca görünümü temizleyen bir düğme
ise kullanıcıyı sildiğine inandırırdı — daha kötüsü. Yerine arama var.

**Hızlı bağlantı geçici kayıt yazar, bilete gömmez.** İlk plan bağlantı
bilgilerini imzalı bilete gömmekti; uygulamada `ephemeral` işaretli geçici satır
yazmanın çok daha az kod olduğu görüldü. Terminal, SFTP, metrik, geçmiş, TOFU ve
denetim katmanlarının hepsi sunucu kimliğiyle konuşuyor — bilete gömmek beşini
birden değiştirmeyi gerektirirdi. Geçici kayıtlar envanterde/kasada görünmez,
sıralamaya katılmaz ve 24 saat kullanılmazsa süpürülür.

## Denetim aktarımı

**Resmî `@elastic/elasticsearch` istemcisi yerine düz HTTP.** İhtiyacımız yalnızca
iki uç: `_bulk` ve sağlık kontrolü. Resmî istemci birkaç megabayt bağımlılık,
kendi yeniden deneme mantığı (bizimkiyle çakışır) ve sürüm uyumluluk kontrolü
getiriyor — sonuncusu OpenSearch gibi çatallarda bağlantıyı tamamen reddediyor.
Düz HTTP hem hafif hem de ES 7/8 ve OpenSearch ile çalışıyor.

**Outbox deseni.** Denetim yazımı kullanıcının işlemini bloklamamalı ama olay da
kaybolmamalı. Olayı önce aynı veritabanına yazıp ayrı bir döngüde taşımak ikisini
birden sağlıyor: ES kapalıyken kayıtlar birikir, geri geldiğinde hiçbir şey
kaybetmeden akar.

**`for update skip locked`.** Birden çok API kopyası aynı kuyruğu işleyebilsin
diye. Olmasaydı iki kopya aynı olayı iki kez gönderir ya da birbirini bloklardı.

**Şemaya uymayan olay gönderilmiş sayılır.** Bozuk bir satır her turda aynı
hatayı üretip kuyruğu sonsuza kadar tıkardı. Hatası yazılıp geçiliyor.

**Bulk kısmi reddi başarısızlık sayılmaz.** ES tek tek belge reddedebilir
(eşleme çakışması gibi). Reddedilen belgeyi sonsuza kadar yeniden denemek
kuyruğu tıkar; ağ düzeyinde başarılıysa kayıtlar gönderilmiş sayılır,
reddedilenler loglanır.

**Boş bırakılan gizli alan "değiştirme" demektir.** UI parolayı hiç görmüyor
(yanıtlarda maskeli); formu geri gönderdiğinde alan boş geliyor. Bunu "parolayı
sil" saymak, ayarı her kaydedişte kimlik doğrulamayı bozardı.

**Bağlantı testi kaydedilmiş ayarla değil, gönderilen ayarla çalışır.**
Kullanıcı kaydetmeden önce denemek istiyor.

**`audit_outbox` aynı zamanda yerel denetim deposudur.** Yalnızca bir kuyruk
olsaydı gönderim biter bitmez silinebilirdi. Ama komut geçmişi paneli ve
gösterge panelindeki etkinlikler bu tablodan okuyor ve Elasticsearch açık
olmayan kurulumlarda başka kaynak yok. Bu yüzden gönderilmiş satırlar 30 gün
saklanıyor. Bir saatlik saklama denendi ve komut geçmişini boşalttı.

**Gösterge paneli sunuculara ping atmaz.** Envanterdeki her sunucuya açılışta
bağlantı denemesi, elli sunuculu bir kurulumda ana sayfayı kullanılmaz hâle
getirirdi. "Bağlı" sayısı gerçekten açık olan SSH oturumlarından türüyor —
kullanıcının bilmek istediği de bu.

## Yapılandırma taşıma

**Gizli veri pakete ham şifreli hâliyle girmez.** Kasadaki blob kök anahtara
bağlı ve AAD'sinde sahibin kimliği var — başka bir kurulumda, hatta aynı
kurulumda başka bir kullanıcıda çözülemez. Taşınabilir bir paket için tek yol
gizli veriyi çözüp kullanıcının verdiği paroladan türeyen bağımsız bir
anahtarla yeniden şifrelemek. Bedeli açık: dışa aktarım anında gizli veri
süreç belleğinde düz metin olarak bulunuyor.

**scrypt, argon2 değil.** Kasa parolaları `@node-rs/argon2` ile özetleniyor ama
o paket kodlanmış dize döndürüyor, ham anahtar türetmiyor. scrypt Node'un
içinde; bellek-sert olduğu için GPU sözlük saldırısını pahalı kılıyor ve
parametreler pakete yazıldığı için maliyeti ileride artırdığımızda eski
paketler açılmaya devam ediyor. Parametreler dışarıdan geldiği için bellek
tavanı zorunlu — şişirilmiş bir `N` değeri API sürecini boğabilirdi.

**Paket parolası en az 12 karakter.** Dosya bir kez dışarı çıktığında deneme
sayısını sınırlayacak bir sunucu yok; saldırgan çevrimdışı ve sınırsız
deneyebilir.

**Gizli verisi olmayan kimlik bilgisi oluşturulmaz, ada göre eşlenir.** Kasa
satırı şifreli veri olmadan anlamsız. Ama "gizli veri hariç" paketi yalnızca
sunucu listesi taşıyabilseydi, karşı tarafta her sunucunun kimliğini elle
bağlamak gerekirdi. Bunun yerine kimlik meta verisi (ad, tip, parmak izi)
pakete giriyor ve içe aktarımda hedefte aynı adlı bir kayıt aranıyor;
bulunursa sunucular ona bağlanıyor, bulunmazsa kullanıcı adıyla uyarılıyor.

**TOFU host anahtarları pakete girmez.** Güvenilen bir parmak izini başka
kuruluma taşımak, orada ilk bağlantı doğrulamasını kullanıcı hiç görmeden
atlatmak olurdu. İçe aktarılan sunucularda parmak izi yeniden sorulur.

**Çakışma çözümünün varsayılanı "yeniden adlandır".** Hiçbir veriyi
kaybettirmeyen tek seçenek. "Atla" kullanıcının içe aktarma isteğini sessizce
yok sayar, "üzerine yaz" mevcut gizli veriyi ezer; ikisi de kullanıcının açık
seçimi olmalı.

**İçe aktarım tek işlemde (transaction) çalışır.** Yarım kalmış bir aktarım —
klasörler oluşmuş, kimlikler oluşmamış — kullanıcının elinde bağlanamayan bir
ağaç bırakırdı.

**Rapor uyarıları sayıyor ve gösteriyor.** "İçe aktarıldı" yazıp kimlik
bilgisiz gelen sunucuları söylememek, kullanıcının sorunu ancak bağlanmaya
çalışırken fark etmesi demekti.

**Dosya tarayıcıda oluşturulur, sunucudan indirtilmez.** `Content-Disposition`
ile indirtmek parolayı taşıyan isteği bir gezinmeye çevirir; hata durumunda
kullanıcı JSON hata gövdesini dosya olarak indirmiş olurdu.

## Çok dillilik

**Hazır i18n kütüphanesi yerine ~90 satırlık kendi katmanı.** İhtiyaç iki dil,
düz anahtarlar ve basit değişken yerleştirmeden ibaret. react-i18next birkaç
yüz kilobayt, kendi yükleyici/namespace modeli ve çalışma zamanında sessizce
eksik anahtar davranışı getiriyordu.

**Eksik çeviri derleme hatası.** `en` sözlüğü `tr`nin anahtar kümesiyle
tiplenmiş (`Record<keyof typeof tr, string>`). Bir anahtar eklenip çevrilmezse
`typecheck` düşer. Çalışma zamanında anahtar adını göstermek, hatayı
kullanıcının bulmasına bırakmak olurdu.

**URL yolları ve sekme başlıkları her zaman İngilizce.** Adres çubuğu, yer
imleri, paylaşılan bağlantılar ve hata raporları uygulamanın dışına taşan
yüzeyler; kullanıcının o anki dil seçimine göre değişmeleri bu kayıtları
tutarsız kılardı. Türkçe yollar (`/kasa`, `/yonetim/*`) yönlendirme olarak
korunuyor — yer imi olan kullanıcı 404 görmemeli.

**API hata mesajları istemcide çevrilir.** Sunucu her hatada sabit bir `code`
gönderiyor; metni arayüzde seçmek dil değiştiğinde hatanın da değişmesini
sağlıyor. Alternatif — sunucuya `Accept-Language` sözlüğü koymak — ikinci bir
çeviri katmanı ve ~490 mesajın iki dilde bakımı demekti. Tanınmayan kodda
sunucunun kendi mesajına düşülür: yeni bir hata eklendiğinde kullanıcı boş
ekran değil, en azından Türkçe bir açıklama görür.

**Dil tercihi `localStorage`da, kullanıcı kaydında değil.** Tercih tarayıcıya
ait bir görüntüleme ayarı; veritabanına yazmak migration ve bir uç noktası
gerektirirdi. Seçim yapılmadıysa tarayıcının diline uyulur, seçim yapıldığı
anda kaydedilir ve bir daha tarayıcıya bakılmaz.

**Dil düğmeleri kendi dillerinde yazılı.** İngilizce arayüzde bile "TR"
görünür: dil adları çevrilmez, çünkü kullanıcı anlamadığı bir arayüzde kendi
dilini arıyor olabilir.

**`t` efekt bağımlılığı olamaz.** Dil değiştiğinde `t` yeni referans alıyor;
SSH bağlantısını kuran efektin bağımlılığı olsaydı dil seçmek tüm açık
oturumları koparırdı. `TerminalPane` çeviri işlevini ref'te tutuyor — aynı
dosyadaki `copyRef`/`pasteRef` deseninin nedeni de buydu.

**Yapılandırma aktarımı sayfa değil, hesap menüsünde diyalog.** Taşınan şey
kullanıcının kendi envanteri ve kasası; bir uygulama bölümü değil hesap
işlemi. Çıkışın hemen üstünde duruyor ve rol koşulu yok — her kullanıcı kendi
verisini aktarır.

## Arayüz düzeni

**Gezinme sol dikey menüde, üst barda değil.** Bölüm sayısı arttıkça yatay
çubuk dar ekranlarda taşıyordu; dikey liste sınırsız büyüyebiliyor ve her
öğenin adı görünür kalıyor. Seçili öğe vurgulu durur — panelde ne olduğunu
menüye bakarak anlamak, panelin başlığını okumaktan hızlı.

**Bölümler panelde açılır, ayrı sayfada değil.** Panel `main` alanının dışında
yaşıyor; kasaya ya da bağlantılara bakmak terminali söktürmüyor. Aynı öğeye
tekrar tıklamak paneli kapatır: tek düğmeyle aç/kapa, ayrı bir kapatma
hedefi aramaya gerek bırakmıyor.

**Panel açıklığı tek kaynakta (`workspace-store.nav`).** Önce her panelin
kendi `open` bayrağı vardı; menüdeki vurgu ile panelin gerçek durumu
ayrışabiliyordu. Tek bir `nav` alanı bu ikiliği ortadan kaldırdı.

**Sunucu formu bölümlere ayrıldı.** Tek uzun liste hâlindeyken kullanıcı hangi
alanın zorunlu, hangisinin isteğe bağlı olduğunu ayırt edemiyordu; başlıklar
(protokoller / bağlantı ayrıntıları / klasör ve gelişmiş) bu ayrımı görsel
yapıyor.

**Devre dışı protokol kartı konmadı.** Örnek aldığımız arayüzde RDP/VNC/Telnet
kartları kapalı hâlde duruyor. sshby yalnızca SSH konuşuyor; kapalı bir kart
koymak var olmayan bir özelliği "yakında" gibi göstermek olurdu. Yerine tek
SSH kartı ve bunu söyleyen bir not var.

**MAC adresi alanı eklenmedi.** Örnekte var ama oradaki işlevi Wake-on-LAN;
sshby uzaktan makine uyandırmıyor, dolayısıyla alan hiçbir yerde
kullanılmayacak ölü veri olurdu.

**Klasör seçici arar ve oluşturur.** Düz bir `<select>` iç içe klasörlerde
çalışmıyordu: iki ayrı dalda aynı adlı klasör ayırt edilemiyordu. Seçici her
klasörü tam yoluyla ("Üretim › Veritabanı") gösteriyor ve eşleşme yoksa
yazılan adı doğrudan oluşturuyor — kullanıcı sunucu formunu terk edip klasör
açıp geri dönmek zorunda kalmasın diye. Yeni klasör, o an seçili klasörün
altına açılır.

**Seçicideki "oluştur" hemen yazmaz, niyeti taşır.** İlk sürümde seçici
tıklandığı anda POST atıyordu; kullanıcı formu "Vazgeç" ile kapatsa bile
klasör envanterde kalıyordu. Artık seçici `{ kind: 'new', name }` döndürüyor
ve klasörü formu kaydeden bileşen açıyor. Kural: **iptal edilen bir form
hiçbir yan etki bırakmamalı.** Kullanıcı bunu bilsin diye seçicinin altında
"kaydettiğinizde oluşturulacak" notu var.

**Gösterge paneli `/dashboard` rotasına taşındı.** `/` terminal çalışma
alanıdır ve açık oturum varsa onu gösterir; açık oturumu olan kullanıcının
özetlere bakmak için oturumlarını kapatması gerekiyordu. İki ayrı rota, iki
ayrı niyet.

**Yönetim işleri sol menüde değil, hesap menüsünde.** Kullanıcı yönetimi,
denetim ayarları ve yapılandırma aktarımı günlük kullanımda girilen yerler
değil; birincil gezinmede yer kaplamaları, asıl işi (sunucuya bağlanmak)
aşağı itiyordu.

**Panel genişlik animasyonuyla açılır.** Bir anda belirip kaybolduğunda
içeriğin nereden geldiği gözle takip edilemiyordu; kayarak açılmak paneli
menüye görsel olarak bağlıyor. `motion-reduce` altında animasyon kapanır.
İçerik kapanma animasyonu bitince sökülür — sıfır genişlikli bir panelin
düğmeleri sekme sırasında kalmamalı.

**Yan panel genişlikleri sürüklenebilir ve panel türü başına saklanır.**
Dosya/metrik/geçmiş panelleri sabit yüzdeyle açılıyordu: dosya adları uzunken
panel dar, terminalde uzun çıktı okurken geniş kalıyordu. Üçü aynı anda açık
olabildiği için genişlik türe göre ayrı tutuluyor. Tek panel açıkken sınır
yok, alanı doldurur.

**Etkin terminal değişince dosya paneli takip eder — ama kendiliğinden
açılmaz.** Panel açıksa terminalde bakılan sunucudan başkasının dosyalarını
göstermesi kafa karıştırıcıydı. Açık değilse sekme değiştirmek onu açmaz:
kullanıcı dosya paneli istemediyse istemiyordur.

**Reddedilen sudo istemi aynı dizinde tekrarlanmaz.** "Vazgeç" işe
yaramıyordu: istem kapanınca listeleme hatası duruyor, kendiliğinden açma
efekti istemi hemen geri getiriyordu ve kullanıcı paneli kapatıp açmadan
kurtulamıyordu. Reddedilen dizin hatırlanıyor; başka dizine geçilirse
yeniden sorulabilir, çünkü orada yetki durumu farklı olabilir.

**Not ve sabitleme sunucu kaydına eklendi.** `notes`: bağlantı bilgisi olmayan
ama bağlanırken bilinmesi gereken şeyler (bakım penceresi, sahibi, hangi
uygulamayı çalıştırdığı) hiçbir yere yazılamıyordu, kullanıcılar bunu ad
alanına sıkıştırıyordu. `pinned`: envanter büyüdükçe her seferinde aynı üç
sunucuyu aramak gerekiyordu. Sıralama `pinned desc, sort_index asc` —
sabitlenenler kendi aralarındaki sürükle-bırak sırasını korur.

**Kopyalanan sunucu sabitlemeyi devralmaz.** Sabitleme kullanıcının o kayda
özel tercihi; kopya ile birlikte çoğalması listenin başını doldururdu. Not
devralınır, çünkü kopyanın konusu genelde aynı makinedir.

**Paketteki `notes`/`pinned` isteğe bağlı.** Zorunlu yapmak, önceki sürümle
alınmış her yapılandırma paketini okunamaz kılardı.

## Sonradan düzeltilenler (tekrarlanmasın)

| hata | kök neden |
|---|---|
| `ssh2` çalışma zamanında patlıyordu | CJS paketi; ESM'de adlandırılmış import çalışmıyor → `lib/ssh/ssh2.ts` interop |
| Kasa sayacı hep 0 | Drizzle ilişkili alt sorguda sütunları nitelemiyordu → LEFT JOIN + GROUP BY |
| Terminal yarım ekranda | Sekme sarmalayıcısında `flex flex-col` yoktu; `flex-1` anlamsız kalıyordu |
| Yapıştırınca sayfa donuyordu | Yukarıdaki yükseklik hatasının yarattığı ölçüm geri besleme döngüsü |
| Başkasının credential'ı atanabiliyordu | Envanter uçlarında sahiplik doğrulaması yoktu |
| Sudo ile yükleme hiç bitmiyordu | Kanalın okunabilir tarafı tüketilmiyordu; çift yönlü akışta `close` iki taraf da bitmeden gelmiyor |
| Yanlış sudo parolası 5 dk asılı kalıyordu | Parola yazıldıktan sonra stdin kapatılmıyordu; sudo yeni deneme için girdi bekliyordu |
| base64 yüklemede dosya bozuluyordu | Parçalar tek tek kodlanınca her parçanın sonuna `=` dolgusu geliyor ve `base64 -d` orada duruyordu |
| Terminal kapanınca dosya paneli boşalıyordu | Panel terminal çalışma alanının içindeydi; terminal sekmesi yokken hiç çizilmiyordu |
| Hızlı bağlantı sonrası `sortIndex` kayıyordu | Geçici kayıtlar ağaçta görünmedikleri hâlde sıra sayacını ilerletiyordu |
| Klasör "Vazgeç"e rağmen oluşuyordu | Seçici tıklanınca hemen POST atıyordu; artık niyeti taşıyor, kaydeden bileşen oluşturuyor |
| Panele dokununca genişlik sıçrıyordu | Genişlik `clientX` sanılıyordu ama panelin solunda 168 px menü var; sürükleme başında panelin kenarı ölçülüp sabitleniyor |
| Bağlantıya tıklamak hiçbir şey yapmıyor görünüyordu | Sekme etkinleşiyordu ama `/dashboard`ta kalınıyordu; artık çalışma alanına da geçiliyor |
| Sudo istemi "Vazgeç"ten sonra geri geliyordu | İstem kapanınca listeleme hatası duruyor, otomatik açma efekti yeniden tetikleniyordu; reddedilen dizin hatırlanıyor |
