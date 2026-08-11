# Kurulum ve işletim

Tek makinede Docker ile üretim kurulumu. Kubernetes manifest'leri sonraki
aşamada; Helm bilinçli olarak kullanılmıyor (gerekçe: `DECISIONS.md` → Altyapı).

## Gereksinimler

- Docker Engine 24+ ve Docker Compose v2
- 2 GB boş RAM (postgres 1 GB, api 1 GB, web 256 MB varsayılan sınırlar)
- Hedef Linux sunucularına SSH erişimi (22/tcp ya da kendi portları)
- **İsteğe bağlı:** denetim akışı için var olan bir Elasticsearch kümesi

Elasticsearch kurmanıza gerek yok — sshby kendi ES'ini getirmiyor, var olan
bir kümeye yazıyor. ES olmadan da tam çalışır: denetim olayları veritabanındaki
kuyrukta birikir, komut geçmişi ve gösterge panelindeki etkinlikler oradan
okunur.

## Kurulum

```bash
git clone https://github.com/erolbeyaz/sshby.git
cd sshby/deploy/compose
cp .env.prod.example .env
```

`.env` içindeki dört zorunlu değeri doldurun:

```bash
openssl rand -base64 32   # SSHBY_MASTER_KEY
openssl rand -hex 32      # JWT_SECRET
openssl rand -base64 24   # POSTGRES_PASSWORD
                          # PUBLIC_ORIGIN: tarayıcının gördüğü adres
```

> **`SSHBY_MASTER_KEY` kasadaki tüm parolaları ve SSH anahtarlarını koruyan kök
> anahtardır. Kaybedilirse veritabanı yedeğiniz olsa bile hiçbir gizli veri geri
> getirilemez.** Parola yöneticinizde saklayın.

Değerler verilmezse compose başlamaz ve hangisinin eksik olduğunu söyler —
geliştirme anahtarlarıyla üretime çıkmak sessizce mümkün değil.

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

İlk açılışta `migrate` servisi şemayı uygular ve çıkar; `api` onun başarıyla
bitmesini bekler, böylece uygulama hiçbir zaman eksik şemayla açılmaz.

Tarayıcıdan `http://localhost:8088` — **ilk kaydolan kullanıcı yönetici olur.**

## Dışarıya açma ve TLS

Varsayılan olarak yalnızca `127.0.0.1`'e bağlanır. Dışarıdan erişim için:

```env
SSHBY_BIND_ADDRESS=0.0.0.0
```

**Bunu TLS sonlandıran bir ters proxy arkasında yapın.** sshby oturum
çerezleri, SSH parolaları ve dosya içerikleri taşıyor; düz HTTP üzerinde ağı
dinleyen herkes bunları okuyabilir. Ayrıca tarayıcının pano API'si HTTPS
istiyor — sağ tık → Yapıştır düz HTTP'de çalışmaz (Ctrl+V her koşulda çalışır).

Ters proxy kullanırken `PUBLIC_ORIGIN`'i proxy'nin dış adresi yapın
(`https://…`): oturum çerezinin `secure` bayrağı buna bakıyor ve yanlış değer
oturumu sessizce bozar.

WebSocket'ler `/ws` altında; proxy'nin `Upgrade` ve `Connection` başlıklarını
geçirmesi gerekiyor, yoksa terminal açılmaz. nginx örneği:

```nginx
location / {
    proxy_pass http://127.0.0.1:8088;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host       $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    # Büyük dosya yüklemeleri SFTP üzerinden geçiyor.
    client_max_body_size 2g;
    # Uzun süren terminal oturumları boşta kalınca kopmasın.
    proxy_read_timeout 3600s;
}
```

## Elasticsearch'e bağlama

ES ayarları **ortam değişkeninde değil, uygulamanın içinde**: `Yönetim →
Denetim akışı`. Düğüm adresleri, kimlik doğrulama (yok / kullanıcı-parola / API
anahtarı), CA sertifikası, indeks öneki ve saklama süresi oradan girilir;
kaydetmeden önce "Bağlantıyı test et" ile denenebilir.

Bu tercihin nedeni: ES parolası ortam değişkeninde durursa `docker inspect`
çıktısında ve süreç listesinde görünür. Ayarlar veritabanında yaşıyor,
parolalar yanıtlarda maskeleniyor ve adres değiştirmek için konteyner yeniden
başlatmak gerekmiyor.

`AUDIT_STRICT_MODE=true` yaparsanız denetim ES'e yazılamadığında yeni SSH
oturumu açılmaz ("kayıt tutulamıyorsa bağlanma" politikası). Varsayılan kapalı.

## Yedekleme

İki şeyi **birlikte** yedekleyin — biri olmadan diğeri işe yaramaz:

1. **Veritabanı** (envanter, kasa, denetim kuyruğu)
2. **`SSHBY_MASTER_KEY`** (kasadaki gizli veriyi çözen anahtar)

```bash
cd deploy/compose

# Yedek al
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U sshby -d sshby --clean --if-exists > sshby-$(date +%F).sql

# Geri yükle
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U sshby -d sshby < sshby-2026-08-11.sql
```

Veritabanı yedeği kasadaki gizli veriyi **şifreli** taşır; tek başına ele
geçirilse bile kök anahtar olmadan çözülemez. Bu yüzden ikisini aynı yerde
saklamayın.

## Güncelleme

```bash
cd sshby && git pull
cd deploy/compose
docker compose -f docker-compose.prod.yml up -d --build
```

Yeni migration varsa `migrate` servisi uygular. **Servis adı vermeden derleyin**
— `--build api` demek `migrate` imajını kapsamaz ve uygulama eski şemayla
açılır.

Migration'lar tekrar çalıştırıldığında uygulanmış olanları atlar; yeniden
başlatmak veri kaybettirmez.

## Kök anahtar rotasyonu

Yeni anahtarı üretip sürümü artırın, eskisini bırakın:

```env
SSHBY_MASTER_KEY=<yeni-base64-anahtar>
SSHBY_MASTER_KEY_VERSION=2
SSHBY_MASTER_KEY_PREVIOUS=1:<eski-base64-anahtar>
```

Eski anahtarla yazılmış kayıtlar okunmaya devam eder; yeni kayıtlar yeni
anahtarla yazılır. Eski anahtarı, tüm kayıtlar yeniden sarılana kadar
`.env`'de bırakın.

## Günlükler ve sorun giderme

```bash
docker compose -f docker-compose.prod.yml logs api --tail 100 -f
docker compose -f docker-compose.prod.yml ps
```

Günlükler dosya başına 10 MB, 5 dosya ile döner (`logging` bölümü); disk
dolmaz.

| Belirti | Bakılacak yer |
|---|---|
| Compose "required variable … is missing" ile duruyor | `.env` içindeki zorunlu dört değer |
| Giriş yapılıyor ama oturum hemen düşüyor | `PUBLIC_ORIGIN` gerçek dış adresle aynı mı (cookie `secure`) |
| Terminal açılmıyor, sayfa çalışıyor | Ters proxy `Upgrade`/`Connection` başlıklarını geçiriyor mu |
| `api` sağlıksız, `migrate` hata vermiş | `logs migrate` — şema uygulanamamış olabilir |
| Denetim rozeti kırmızı | Yönetim → Denetim akışı → Bağlantıyı test et |

## Bilinen sınırlar

- **Tek makine kurulumu.** Birden çok `api` kopyası çalıştırmak mümkün
  (`audit_outbox` `for update skip locked` ile güvenli) ama compose dosyası
  bunu kurmuyor; ölçekleme Kubernetes aşamasına bırakıldı.
- **Otomatik yedek yok.** Yukarıdaki `pg_dump` komutunu kendi zamanlayıcınıza
  bağlamanız gerekiyor.
- **TLS uygulamada sonlandırılmıyor.** Sertifika yönetimi ters proxy'nin işi;
  sshby düz HTTP dinler ve `PUBLIC_ORIGIN` ile dış adresi öğrenir.
