<p align="left">
  <img src="sshby-images/sshby-lockup.svg" alt="sshby" height="56">
</p>

Tarayıcıdan Linux sunucularına SSH ve SFTP. Her bağlantı ve çalıştırılan her komut
denetim kaydına yazılır.

Şirket içi kullanım için tasarlandı — internete açılması öngörülmemiştir.

## Ne yapar

Bugün çalışan özellikler:

- **Paralel SSH terminalleri** — sekmeler ve bölünmüş paneller, sürükleyerek
  sıralama ve boyutlandırma
- **SFTP dosya yöneticisi** — dizin ağacı, akış tabanlı yükleme/indirme, yetki
  gerektiren dizinler için sudo modu
- **Sunucu metrik paneli** — CPU, bellek, disk, ağ, işlemler, portlar; ajan
  kurulumu gerektirmez
- **Klasör yapısı** — sunucuları sürükle-bırak ile düzenleme
- **Credential kasası** — parola ve SSH anahtarları, AES-256-GCM ile şifreli
- **Komut geçmişi** — sunucu başına, denetim kaydından türetilir
- **Hızlı bağlantı** — envantere kaydetmeden tek seferlik erişim
- **Denetim kaydı** — kim, hangi sunucuda, hangi komutu çalıştırdı; ECS hizalı
- **Elasticsearch aktarımı** — olaylar önce veritabanı kuyruğuna yazılır, arka
  plandaki gönderici bunları Elasticsearch'e taşır. ES kapalıyken hiçbir olay
  kaybolmaz; admin ekranından yapılandırılır.
- **Yapılandırma dışa/içe aktarma** — klasörler, sunucular ve kasa kayıtları tek
  bir JSON paketinde. Gizli veriler ya paketten tamamen çıkarılır ya da verdiğiniz
  paroladan türetilen anahtarla şifrelenir.

Planlanan (henüz yok):

- **Helm chart / Kubernetes dağıtımı** — Faz 8

## Belgeler

| dosya | ne için |
|---|---|
| [AGENTS.md](AGENTS.md) | depoda çalışma kuralları, komutlar, ortam tuzakları |
| [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) | ne bitti, ne çalışıyor, bilinen sınırlar |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | sistem yapısı, veri modeli, akışlar |
| [docs/DECISIONS.md](docs/DECISIONS.md) | kararlar ve gerekçeleri |
| [docs/TODO.md](docs/TODO.md) | kalan fazlar ve teknik borç |
| [docs/NEXT_SESSION.md](docs/NEXT_SESSION.md) | yeni bir oturum nereden devam etmeli |

Yeni bir oturuma başlarken önce `docs/CURRENT_STATE.md` ve `AGENTS.md` okuyun.
Bu dosya (README) genel proje tanıtımıdır; çalışma durumunun doğruluk kaynağı
`docs/CURRENT_STATE.md`'dir.

## Hızlı başlangıç

Tek gereksinim Docker'dır; Node.js kurmanıza gerek yok.

```bash
docker compose -f deploy/compose/docker-compose.yml up -d --build
```

Ardından http://localhost:8088 adresini açın. **İlk kaydolan kullanıcı otomatik olarak
admin olur.**

Tüm host portları `127.0.0.1`'e bağlanır ve çakışma hâlinde değiştirilebilir —
`deploy/compose/` altında bir `.env` açıp yazın:

```
SSHBY_WEB_PORT=9090
SSHBY_POSTGRES_PORT=15432
SSHBY_ELASTIC_PORT=19200
SSHBY_KIBANA_PORT=5601
SSHBY_TEST_SSH_PORT=2222
```

Compose ortamı denemeler için hazır bir SSH hedefi de ayağa kaldırır:

| Alan     | Değer       |
| -------- | ----------- |
| Adres    | `test-ssh`  |
| Port     | `2222`      |
| Kullanıcı| `sshby`     |
| Parola   | `sshby`     |

Kibana http://localhost:5601 adresinde. Denetim aktarımını açmak için uygulamada
**Yönetim → Denetim akışı** ekranından Elasticsearch adresini girip
etkinleştirin; kayıtlar `sshby-audit-*` indeks deseninde görünür.

> **Kurumsal ağ notu.** Dışarı giden HTTPS trafiği bir güvenlik ağ geçidi
> tarafından kesildiği için imaj build'leri `deploy/docker/certs/corporate-ca.crt`
> dosyasındaki kök sertifikaya güvenir. Ayrıntı ve sertifikayı yenileme adımları:
> [`deploy/docker/certs/README.md`](deploy/docker/certs/README.md).

Kapatmak için:

```bash
docker compose -f deploy/compose/docker-compose.yml down
```

## Depo yapısı

```
apps/api          Fastify + ssh2 — REST, WebSocket terminal, SFTP, metrikler
apps/web          React + Vite + Tailwind + xterm.js
packages/shared   İki tarafın da kullandığı zod şemaları ve tipler
deploy/docker     Dockerfile'lar ve nginx yapılandırması
deploy/compose    Yerel geliştirme / tek makine ortamı
docs              Mimari, kararlar, mevcut durum, yapılacaklar
sshby-images      Marka varlıkları ve marka panosu
```

## Geliştirme

Node.js 22 ve pnpm 9 kuruluysa doğrudan çalıştırabilirsiniz:

```bash
pnpm install
```

Altyapıyı konteynerde, uygulamayı yerelde çalıştırmak en pratik yöntem:

```bash
docker compose -f deploy/compose/docker-compose.yml up -d postgres elasticsearch kibana test-ssh
```

```bash
pnpm db:migrate && pnpm dev
```

Web arayüzü http://localhost:5173, API http://localhost:3000 adresinde açılır.
Yerelde çalıştırırken `.env.example`'ı `.env` olarak kopyalayın ve
`DATABASE_URL` içindeki portu compose'un yayınladığı porta (varsayılan `15432`)
göre düzeltin.

### Faydalı komutlar

| Komut             | Ne yapar                                            |
| ----------------- | --------------------------------------------------- |
| `pnpm build`      | shared → api → web sırasıyla derler                 |
| `pnpm typecheck`  | Tüm paketlerde tip denetimi                          |
| `pnpm lint`       | ESLint                                               |
| `pnpm test`       | Birim testleri                                       |
| `pnpm db:migrate` | `apps/api/migrations/*.sql` dosyalarını uygular      |
| `pnpm db:diff`    | Şema değişikliği için drizzle-kit'e SQL taslağı ürettirir |

Migration'lar elle yazılmış düz SQL dosyalarıdır. Uygulanmış bir dosyayı
**düzenlemeyin** — migration çalıştırıcısı sağlama toplamı uyuşmazlığında hata
verir; değişiklik için yeni numaralı bir dosya ekleyin.

## Güvenlik notları

- `SSHBY_MASTER_KEY` kasadaki tüm kredensiyelleri koruyan kök anahtardır.
  **Kaybedilirse hiçbir parola veya SSH anahtarı geri getirilemez.** Yedeğini
  ayrı bir kasada saklayın.
- Komut denetimi terminal seviyesinde çalışır: tuş vuruşları biriktirilip
  Enter'da komut olarak kaydedilir. `vim`/`less` gibi tam ekran uygulamaların
  içindeki girdi ve alias/heredoc genişletmeleri birebir yansımaz. Kesin denetim
  gerekiyorsa sunucu tarafında `auditd` veya `bash-preexec` ile tamamlayın.
- Sunucu anahtarları ilk bağlantıda kaydedilir (TOFU). Anahtar sonradan
  değişirse bağlantı kesilir ve olay denetime düşer.

## Yol haritası

| Faz   | Kapsam                                            | Durum   |
| ----- | ------------------------------------------------- | ------- |
| Faz 0 | İskelet, tema, Docker altyapısı                   | tamam   |
| Faz 1 | Kayıt, giriş, roller                              | tamam   |
| Faz 2 | Credential kasası, klasörler, sunucular           | tamam   |
| Faz 3 | Paralel SSH terminalleri                          | tamam   |
| Faz 4 | SFTP dosya yöneticisi                             | tamam   |
| Faz 5 | Sunucu metrik paneli                              | tamam   |
| Faz 6 | Elasticsearch denetim akışı                       | tamam   |
| Faz 7 | Yapılandırma dışa/içe aktarma                     | tamam   |
| Faz 8 | Helm chart ve dokümantasyon                       | **sırada** |
| Faz 9 | Keycloak / OIDC entegrasyonu                      | plan dışı, sonraki aşama |

Güncel durum ve bilinen sınırlar için: [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md).
