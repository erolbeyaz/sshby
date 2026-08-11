# Kararlar

Neden böyle yapıldığı, sonradan sorgulanmasın diye. Her madde bir kez tartışıldı
ve bir bedeli var; değiştirmeden önce bedelini okuyun.

## Altyapı

**Docker Compose ile geliştirme, Helm ile üretim.** Kullanıcının hedefi
Kubernetes. Compose tek makinede hızlı döngü sağlıyor, Helm chart'ı Faz 8'de.

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
