# sshby — Mimari

Şirket içi, tarayıcıdan kullanılan SSH istemcisi. Termix benzeri işlevsellik,
Hoppscotch'un koyu teması.

## Genel yerleşim

```
tarayıcı
   │  HTTP  /api/*        ─┐
   │  WS    /ws/*         ─┤ nginx (web imajı, :8080)
   ▼                       │
 web (nginx + SPA)  ───────┘ proxy → api:3000
   │
 api (Fastify)
   ├── postgres  (kullanıcılar, kasa, envanter, denetim kuyruğu)
   ├── ssh2      → hedef Linux sunucuları
   └── elasticsearch (denetim aktarımı; admin ekranından açılır)
```

Tek origin varsayımı: tarayıcı her şeyi `:8088` üzerinden görür, nginx `/api`yi
ve `/ws`yi api servisine taşır. Bu yüzden üretimde CORS yok.

## Depo yapısı

```
apps/
  api/                Fastify + TypeScript (ESM)
    migrations/       elle yazılmış SQL; sıra numarasıyla uygulanır
    src/
      db/             drizzle şeması, bağlantı havuzu, migration çalıştırıcı
      lib/
        auth/         JWT (access) + opak refresh token + WS bileti
        crypto/       zarf şifreleme, SSH anahtar parmak izi
        audit/        Elasticsearch istemcisi ve outbox göndericisi
        ssh/          ssh2 interop, TOFU host key, komut kaydedici, oturum kaydı
      plugins/        Fastify auth eklentisi (requireAuth / requireAdmin)
      routes/         health, bootstrap, auth, users, settings, credentials,
                      inventory, config, terminal, sftp, metrics, history
  web/                React 18 + Vite + Tailwind
    src/
      components/     layout/, terminal/, sftp/, metrics/, history/, tree/,
                      dialogs/, ui/, brand/
      lib/            api istemcisi, zustand store'ları, react-query kancaları
      pages/          AuthPage, HomePage, HostDetailPage, CredentialsPage,
                      ConfigTransferPage, AdminUsersPage, AdminAuditPage
packages/
  shared/             api ↔ web arasında zod sözleşmeleri (tek doğruluk kaynağı)
deploy/
  compose/            geliştirme/tek makine dağıtımı
  docker/             Dockerfile.api, Dockerfile.web, nginx.conf, güvenlik başlıkları
docs/                 bu dosyalar
```

Kubernetes dağıtımı (`deploy/helm`) **henüz yok** — Faz 8'in konusu.

## Veri modeli (özet)

| tablo | notlar |
|---|---|
| `users` | rol (`admin`/`user`), argon2id parola özeti, kilitleme sayaçları |
| `auth_sessions` | refresh token'ın SHA-256 özeti; tekil oturum iptali için |
| `folders` | kendine referanslı ağaç, `sort_index` ile sıralama |
| `hosts` | `username` NULL olabilir → kimlik bilgisinden devralınır; `ephemeral` = hızlı bağlantı kaydı |
| `credentials` | zarf şifrelemeli gizli veri; sahibe özel; `ephemeral` = hızlı bağlantıya ait |
| `host_keys` | TOFU kayıtları, kullanıcı × adres × port benzersiz |
| `app_settings` | anahtar/değer; Elasticsearch yapılandırması burada |
| `audit_outbox` | denetim olayları önce buraya yazılır, gönderici ES'e taşır |

Her kullanıcının verisi `owner_id` ile ayrılır. Sorgular her zaman sahiplik
koşuluyla filtrelenir; bu tek savunma hattı değil, şifreleme de sahiple bağlı.

## Kimlik doğrulama zinciri

1. **Access token** — kısa ömürlü HS256 JWT, yalnızca tarayıcının belleğinde.
2. **Refresh token** — opak rastgele dize, `httpOnly` cookie, veritabanında
   SHA-256 özetiyle. Tek tek iptal edilebilir.
3. **WebSocket bileti** — 30 saniyelik, tek sunucuya ve tek kapsama yetkili JWT.
   Tarayıcı WS'e başlık ekleyemediği için gerekli; access token'ı sorgu dizesine
   koymak onu nginx loglarına sızdırırdı.

Her istekte kullanıcı ve oturum satırı veritabanından doğrulanır — "kullanıcıyı
pasife al" ve "oturumu sonlandır" anında etkili olsun diye.

## Kasa şifrelemesi

Zarf (envelope) şifreleme:

```
gizli veri ──AES-256-GCM(DEK)──► enc_blob
DEK        ──AES-256-GCM(KEK)──► wrapped_dek     KEK = SSHBY_MASTER_KEY
```

- Her kayıt kendi rastgele DEK'ini alır; kök anahtar hiçbir zaman doğrudan
  kullanıcı verisine uygulanmaz.
- AAD olarak sahip kimliği bağlanır: şifreli satır başka kullanıcıya
  kopyalansa bile çözülemez.
- `key_version` ile rotasyon: yalnızca sarmalanmış DEK'ler yeniden sarılır.
- Gizli veri **hiçbir HTTP yanıtında dönmez**; yalnızca `resolveCredentialSecret`
  çağrısıyla, SSH bağlantısı kurulurken çözülür.

## Terminal akışı

```
istemci                          sunucu
  │ POST /api/terminal/ticket  →  bilet (30 sn)
  │ WS /ws/terminal?ticket=…   →  bilet doğrula, host + kimlik yükle
  │                            ←  status: connecting
  │                            ←  hostkey_prompt   (TOFU gerekiyorsa)
  │ hostkey_decision           →
  │                            ←  auth_prompt      (kasada kayıt yoksa)
  │ auth_response              →
  │                            ←  status: ready + session
  │ ikili çerçeve = tuş        ⇄  ikili çerçeve = ekran çıktısı
  │ JSON çerçeve = kontrol     →  resize / ping
```

Tuş vuruşları **ikili**, kontrol mesajları **metin** çerçeve. Ayrımı çerçeve
tipiyle yapmak hem hızlı hem de kullanıcının yazdığı JSON benzeri metnin
yanlış yorumlanmasını imkânsız kılıyor.

## SFTP, metrikler ve geçmiş

Bu üçü **HTTP üzerinden** çalışır, WebSocket üzerinden değil:

- **SFTP** (`/api/sftp/:hostId/*`) — indirme/yükleme doğal olarak akış tabanlı
  ve HTTP bunu bedavaya veriyor. SSH bağlantısı önce açık terminal oturumundan
  ödünç alınır, yoksa kasadaki kimlikle yenisi kurulur (havuzda tutulur, boşta
  kalınca kapanır). Yetki gerektiren dizinler için "sudo modu" SFTP alt sistemi
  yerine kabuk komutları kullanır.
- **Metrikler** (`/api/metrics/:hostId`) — tek bir kabuk komutu tüm metrikleri
  `###ETİKET` bölümleriyle toplar; ajan kurulumu gerekmez.
- **Komut geçmişi** (`/api/history/:hostId`) — `audit_outbox` içindeki
  `ssh.command` olaylarından türetilir, sunucudaki `~/.bash_history`'den değil.

## Yapılandırma taşıma

`POST /api/config/export` ve `POST /api/config/import` (ikisi de POST — paket
parolası gövdede taşınmalı, sorgu dizesine düşerse nginx loglarına yazılırdı).

Paketin şekli `packages/shared/src/config-transfer.ts` içinde; aynı zod şeması
hem sunucuda hem tarayıcıda çalışıyor, böylece yanlış dosya seçildiğinde
kullanıcı ağ turu beklemeden uyarılıyor.

```
kasa satırı ──open(KEK/DEK, ownerId)──► düz gizli veri
                                            │
                        scrypt(paket parolası, salt)
                                            ▼
                                    AES-256-GCM ──► paket.vault
```

Gizli veri kurulumdan kuruluma ham taşınamaz: kasadaki blob kök anahtara bağlı
ve AAD'sinde sahibin kimliği var. Bu yüzden dışa aktarımda çözülüp paket
parolasından türetilen bağımsız bir anahtarla yeniden şifreleniyor
(`lib/crypto/config-package.ts`). İçe aktarım aynı yolu ters yürür ve gizli
veriyi hedef kurulumun kendi zarf şifrelemesiyle kasaya yazar.

Paket kaynak kurulumun UUID'lerini taşır ama bunlar hedefe hiç yazılmaz: içe
aktarım eski → yeni eşlemesi kurup her kayda yeni kimlik verir. Eşleme atlanan
ve üzerine yazılan kayıtlarda hedefteki mevcut satırı işaret eder, böylece
paketteki bir sunucu atlanmış bir klasörün hedefteki karşılığına bağlanır.
Sunucular birbirine referans verdiği için atlama sunucusu bağları ikinci bir
geçişte kuruluyor.

## Denetim

Olaylar önce `audit_outbox` tablosuna yazılır (ES kapalıyken kaybolmasın),
arka plandaki gönderici bunları bulk API ile Elasticsearch'e taşır. Alan adları
ECS ile hizalı (`event.*`, `user.*`, `server.*`), ECS'te karşılığı olmayanlar
`sshby.*` altında.

```
emitAudit() ──► audit_outbox ──► gönderici (2 sn) ──► ES _bulk
                    │                   │
                    │                   └─ hata: attempts++, üstel geri çekilme
                    └─ ES kapalıysa burada bekler, kaybolmaz
```

Gönderici satırları `for update skip locked` ile kilitler; birden çok API
kopyası aynı kuyruğu güvenle işleyebilir. Şemaya uymayan bir olay gönderilmiş
sayılıp hatası yazılır — bozuk bir satır kuyruğu sonsuza kadar tıkamamalı.

Arka plan işlerinin (metrik toplayıcı) çalıştırdığı komutlar
`sshby.source: 'system'` ile işaretlenir; kullanıcının gerçek komutlarını
boğmamaları için geçmiş ve denetim görünümlerinde bu alana göre elenirler.

Komut kaydı sezgiseldir ve sınırları `lib/ssh/command-recorder.ts` başında
yazılıdır. Doğru yapmak zorunda olduğu üç şey: parolaları kaydetmemek, tam
ekran uygulama içindeki tuşları komut saymamak, yapıştırılan komutları
kaçırmamak.

## Ön yüz durum yönetimi

- **react-query** — sunucu verisi (envanter, kasa, kullanıcılar, SFTP dizinleri,
  metrikler, komut geçmişi).
- **zustand** — istemci durumu:
  - `auth-store` — oturum, token yenileme
  - `workspace-store` — seçili sunucu, ağaç filtresi, komut paleti
  - `terminal-store` — açık terminal/dosya/metrik/geçmiş sekmeleri, düzen,
    ızgara bölme oranları, yan panellerin açıklığı

Çalışma alanı katmanı `AppShell` içinde, **yönlendiricinin dışında** yaşar.
Sayfa değişince sökülmez, yalnızca gizlenir — sökülseydi WebSocket kapanır ve
SSH oturumları ölürdü. Aynı kural sekmeler arası geçişte de geçerli: etkin
olmayan panel gizlenir, DOM'dan çıkarılmaz.

Terminal, dosya, metrik ve geçmiş panelleri birbirinden **bağımsız** sekme
listeleridir; biri kapanınca diğerleri etkilenmez.
