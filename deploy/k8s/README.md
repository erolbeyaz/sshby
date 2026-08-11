# Kubernetes manifest'leri

Şablonsuz, düz `kubectl apply` ile giden dosyalar. Helm bilinçli olarak
kullanılmıyor — gerekçe: `docs/DECISIONS.md` → Altyapı.

Tek makine Docker kurulumu için: `docs/DEPLOYMENT.md`.

## Dosyalar

| Dosya | İçerik |
|---|---|
| `00-namespace.yaml` | `sshby` namespace'i, Pod Security etiketleri |
| `01-configmap.yaml` | Gizli olmayan ayarlar (`PUBLIC_ORIGIN`, denetim politikası…) |
| `02-secret.example.yaml` | **Örnek** — kopyalayıp doldurun, bu dosyayı uygulamayın |
| `03-postgres.yaml` | Küme içi Postgres (StatefulSet + PVC). Yönetilen DB varsa **atlayın** |
| `04-migrate-job.yaml` | Şema migration'ları |
| `05-api.yaml` | API Deployment + Service |
| `06-web.yaml` | Web (nginx) Deployment + Service |
| `07-ingress.yaml` | Ingress + TLS |

## Önce imajlar (Harbor)

İmajlar depoda hazır gelmiyor — kaynaktan derlenip sizin kayıt defterinize
gönderiliyor. Depo kökünden:

```bash
docker build -f deploy/docker/Dockerfile.api -t sshby-api:0.1.0 .
```

```bash
docker build -f deploy/docker/Dockerfile.web -t sshby-web:0.1.0 .
```

Harbor'a etiketleyip gönderin (`library` Harbor'ın varsayılan projesi):

```bash
docker login prod-harbor.hedefyatirimbankasi.com.tr
```

```bash
docker tag sshby-api:0.1.0 prod-harbor.hedefyatirimbankasi.com.tr/library/sshby-api:0.1.0 && docker push prod-harbor.hedefyatirimbankasi.com.tr/library/sshby-api:0.1.0
```

```bash
docker tag sshby-web:0.1.0 prod-harbor.hedefyatirimbankasi.com.tr/library/sshby-web:0.1.0 && docker push prod-harbor.hedefyatirimbankasi.com.tr/library/sshby-web:0.1.0
```

`kustomization.yaml` bu adrese göre **hazır ayarlı**. Sürüm yükseltirken
yalnızca oradaki `newTag` değerini değiştirin; manifest dosyalarındaki `image:`
satırlarına dokunmayın — kayıt defteri adresi tek yerde dursun diye
kustomize'ın `images:` bölümü kullanılıyor.

Harbor'daki etiketleri listelemek için:

```bash
curl -su KULLANICI https://prod-harbor.hedefyatirimbankasi.com.tr/api/v2.0/projects/library/repositories/sshby-api/artifacts?page_size=20 | grep -o '"name":"[^"]*"'
```

`latest` yerine sürüm etiketi kullanın: `latest` ile hangi sürümün çalıştığını
sonradan anlamak mümkün olmuyor ve `imagePullPolicy` davranışı sürprizli.

**Harbor kimlik doğrulama istiyorsa** (proje public değilse) küme de giriş
yapabilmeli:

```bash
kubectl create secret docker-registry harbor-cred -n sshby --docker-server=prod-harbor.hedefyatirimbankasi.com.tr --docker-username=KULLANICI --docker-password=PAROLA
```

```bash
kubectl patch serviceaccount default -n sshby -p '{"imagePullSecrets":[{"name":"harbor-cred"}]}'
```

Bu iki komut namespace oluşturulduktan sonra çalıştırılmalı ve manifest'lere
dokunmaz.

### Postgres imajı

Postgres **üç yerde** kullanılıyor: veritabanının kendisi, migrate Job'unun
`wait-for-postgres` initContainer'ı ve api'nin `wait-for-schema`
initContainer'ı. `kustomization.yaml`'daki tek `postgres` girdisi üçünü birden
çeviriyor ve şu an Harbor'daki `latest` etiketine bakıyor.

**İmaj değiştirirseniz `03-postgres.yaml`'daki uid'yi de değiştirin.** Resmi
imajın kullanıcı kimliği tabana göre farklı:

| İmaj | Sürüm | Taban | postgres uid/gid |
|---|---|---|---|
| `postgres:latest` | 18.x | Debian | **999** |
| `postgres:16-alpine` | 16.x | Alpine | **70** |

Manifest şu an **999** ile ayarlı (Debian). Yanlış uid'de pod veri dizinine
yazamaz ve `initdb` izin hatasıyla durur. Kontrol:

```bash
docker run --rm --entrypoint sh prod-harbor.hedefyatirimbankasi.com.tr/library/postgres:latest -c "id postgres"
```

> **`latest` bir veritabanı için riskli.** Harbor'daki `latest` bir gün
> PostgreSQL 19'a güncellenir ve pod yeniden başlarsa, sunucu mevcut veri
> dizinini açamaz — `database files are incompatible with server` — ve
> veritabanı ayağa kalkmaz. Uygulama imajları için `latest` yalnızca
> "hangi sürüm çalışıyor" belirsizliği demek; veritabanı için **veri
> erişilemezliği** demek.
>
> Önerilen: Harbor'a sürümlü bir etiket de gönderin ve onu kullanın.
>
> ```bash
> docker tag postgres:latest prod-harbor.hedefyatirimbankasi.com.tr/library/postgres:18 && docker push prod-harbor.hedefyatirimbankasi.com.tr/library/postgres:18
> ```
>
> Sonra `kustomization.yaml`'da `newTag: latest` yerine `newTag: '18'` yazın.

Not: tek makine Docker kurulumu (`docker-compose.prod.yml`) PostgreSQL **16**
kullanıyor, bu manifest ise 18. İki kurulum arasında veri taşıyacaksanız
`pg_dump` ile taşıyın — veri dizinini doğrudan kopyalamak major sürümler
arasında çalışmaz.

Yerel kümede (kind, minikube) kayıt defteri olmadan da çalışabilirsiniz:

```bash
kind load docker-image sshby-api:0.1.0 sshby-web:0.1.0
```

## Kurulum

Üç adım: yapılandırmayı düzenleyin, gizli anahtarları oluşturun, tek komutla
uygulayın.

**1. Kendi ortamınıza göre düzenleyin**

| Dosya | Değiştirilecek |
|---|---|
| `kustomization.yaml` | `newName` / `newTag` — Harbor adresiniz ve sürüm |
| `01-configmap.yaml` | `PUBLIC_ORIGIN` — Ingress'teki host ile **aynı** olmalı |
| `07-ingress.yaml` | `host`, `ingressClassName`, TLS ayarı |

**2. Gizli anahtarlar**

Namespace'i önce oluşturun (Secret'ın gideceği yer):

```bash
kubectl apply -f 00-namespace.yaml
```

Sonra anahtarları dosyaya yazmadan oluşturun:

```bash
PGPASS=$(openssl rand -hex 24)
kubectl create secret generic sshby-secrets -n sshby \
  --from-literal=SSHBY_MASTER_KEY="$(openssl rand -base64 32)" \
  --from-literal=SSHBY_MASTER_KEY_VERSION=1 \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=POSTGRES_PASSWORD="$PGPASS" \
  --from-literal=DATABASE_URL="postgres://sshby:$PGPASS@postgres:5432/sshby"
```

> **`POSTGRES_PASSWORD` için `-hex` kullanın.** Değer `DATABASE_URL`'e
> gömülüyor; base64 çıktısındaki bir `/` adresi bölüp migration'ı
> `getaddrinfo EAI_AGAIN` ile düşürür.

> **`SSHBY_MASTER_KEY` kasadaki her şeyi çözen anahtardır.** Kaybedilirse
> veritabanı yedeğiniz olsa bile hiçbir parola veya SSH anahtarı geri gelmez.
> Küme dışında da saklayın.

**3. Tek komutla kurulum**

```bash
kubectl apply -k deploy/k8s
```

Sırayı beklemenize gerek yok: migrate Job'u postgres'i, api de
`schema_migrations` tablosunu bekliyor (initContainer'lar). Her şey aynı anda
uygulansa bile doğru sırada ayağa kalkar.

Ne olduğunu önce görmek isterseniz:

```bash
kubectl kustomize deploy/k8s
```

Durumu izleyin:

```bash
kubectl get pods -n sshby -w
```

```bash
kubectl rollout status deployment/api -n sshby
```

Adresinize gidin — **ilk kaydolan kullanıcı yönetici olur.**

Yönetilen bir veritabanı kullanıyorsanız `kustomization.yaml`'daki
`03-postgres.yaml` satırını silin; Secret'taki `DATABASE_URL` yeterli.

## Güncelleme

Yeni sürümü derleyip Harbor'a gönderin, `kustomization.yaml`'daki `newTag`
değerini yükseltin, sonra:

```bash
kubectl delete job sshby-migrate -n sshby --ignore-not-found
```

```bash
kubectl apply -k deploy/k8s
```

Job silme adımı gerekli: Job'un `spec`i değiştirilemez, aynı adla ikinci kez
uygulamak hata verir. `ttlSecondsAfterFinished: 600` sayesinde 10 dakika sonra
kendini zaten siler — o süre geçtiyse silme komutunu atlayabilirsiniz.

Migration'lar tekrar çalıştırıldığında uygulanmış olanları atlar; api'nin
`wait-for-schema` initContainer'ı da `schema_migrations` tablosunu bekler,
yani uygulama eksik şemayla açılmaz.

## Neden `api` tek kopya

`05-api.yaml` içinde `replicas: 1` ve `strategy: Recreate`. Ölçeklemeden önce:

SSH oturumları süreç belleğinde yaşıyor. Terminal WebSocket'i bir pod'a bağlanıp
orada kalır, sorun değil — ama **SFTP, metrik ve komut geçmişi HTTP üzerinden**
geliyor. İstek başka bir pod'a düşerse orada o oturum yoktur: SFTP açık
terminalden bağlantı ödünç alamaz ve kasadaki kimlikle yeniden bağlanmaya
çalışır. Etkileşimli parolayla açılmış oturumlarda bu imkânsız, çünkü parolayı
saklamıyoruz. Sudo parolası da aynı şekilde süreç belleğinde.

`sessionAffinity: ClientIP` kısmi çare olurdu ama proxy arkasındaki NAT'lı
istemcilerde güvenilmez. Gerçek çözüm oturum durumunu paylaşmak — yapılmadı.

Denetim kuyruğu ölçeklemeye hazır (`for update skip locked`); darboğaz orada
değil. `web` durumsuz olduğu için 2 kopya çalışıyor.

## Elasticsearch

Manifest'lerde ES ayarı yok — bilinçli. Denetim akışının hedefi uygulamanın
içinden yapılandırılıyor (`Yönetim → Denetim akışı`) ve veritabanında
saklanıyor. Ortam değişkenine koymak ES parolasını `kubectl describe`
çıktısında görünür kılardı. ES olmadan da tam çalışır: olaylar veritabanı
kuyruğunda birikir.

## Doğrulama

Manifest'ler resmi şemalara karşı denetlenebilir:

```bash
docker run --rm -v "$PWD:/w" -w /w ghcr.io/yannh/kubeconform:latest -strict -summary *.yaml
```

## Bilinen sınırlar

- **`api` yatay ölçeklenmiyor** (yukarıdaki gerekçe).
- **Postgres tek kopya.** Yüksek erişilebilirlik gerekiyorsa yönetilen bir
  veritabanı ya da bir Postgres operatörü kullanın; bu manifest onu çözmüyor.
- **Yedekleme yok.** `pg_dump` komutu `docs/DEPLOYMENT.md` içinde; CronJob'a
  bağlamak size kalmış.
- **NetworkPolicy yok.** Namespace'e giriş/çıkış trafiği kısıtlanmıyor.
- **Postgres `readOnlyRootFilesystem: false`** — çalışma zamanında birkaç yere
  yazıyor; salt okunur kök için her birine ayrı `emptyDir` gerekir.
