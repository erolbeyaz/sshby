# sshby — çalışma kılavuzu

Bu depoda çalışan herkes (insan ya da model) için.

## Yeni oturuma başlarken

Bir oturumun başında, proje durumunu anlamak için şu dosyaları **bu sırayla**
okuyun:

1. `docs/CURRENT_STATE.md`
2. `AGENTS.md` (bu dosya)
3. `docs/ARCHITECTURE.md`
4. `docs/DECISIONS.md`
5. `docs/TODO.md`
6. `docs/NEXT_SESSION.md`

Bunlar oturum başında bir kez okunur; her görevde baştan okumak gerekmez.
Sonrasında yalnızca görevle ilgili olanı gerektiğinde yeniden açın.

Dokümanları okuduktan sonra **geçmiş bir konuşmanın var olduğunu varsaymayın.**
Depodaki dokümanlar tek başına yeterli olmalı; değilse eksik olan yazılmalı.

## Dosyaların sorumlulukları

| dosya | cevapladığı soru |
|---|---|
| `docs/CURRENT_STATE.md` | Şu anda gerçekte ne çalışıyor? |
| `docs/TODO.md` | Bundan sonra ne yapılacak? |
| `docs/ARCHITECTURE.md` | Sistem nasıl çalışıyor? |
| `docs/DECISIONS.md` | Neden böyle tasarlandı? |
| `AGENTS.md` | Bu depoda nasıl çalışılmalı? |
| `docs/NEXT_SESSION.md` | Bir sonraki oturum nereden devam etmeli? |
| `README.md` | Kullanıcı/geliştirici için genel proje görünümü |

**Nihai gerçek koddur** ve gerçekten doğrulanmış çalışma zamanı davranışıdır.
Doküman ile kod çelişiyorsa:

1. Önce gerçek implementasyonu doğrulayın.
2. Sonra ilgili dokümanı düzeltin.

Bir dokümandaki eski bilgiyi diğerlerine yayarak çelişkiyi "çözmeye" çalışmayın.

## Dil

**Kod yorumları ve commit mesajları Türkçe.** Değişken/fonksiyon adları
İngilizce (kod tabanının geri kalanıyla tutarlı olsun diye).

**Arayüz iki dilli: Türkçe ve İngilizce.** Kullanıcıya görünen hiçbir metin
bileşenin içine gömülmez; hepsi sözlükten gelir:

- `apps/web/src/lib/locales/tr.ts` — anahtar kümesinin tek doğruluk kaynağı
- `apps/web/src/lib/locales/en.ts` — `tr`nin anahtarlarıyla tiplenmiş

Bir anahtar Türkçeye eklenip İngilizcesi yazılmazsa **`pnpm typecheck` düşer**;
eksik çeviri çalışma zamanına kalmaz. Bileşende `useT()` ile kullanılır:

```tsx
const t = useT();
<button aria-label={t('vault.deleteAria', { name: cred.name })}>
```

Uyulması gerekenler:

- Yeni bir kullanıcı metni yazarken önce sözlüğe anahtar ekleyin. `aria-label`,
  `title` ve `placeholder` da kullanıcı metnidir.
- **URL yolları ve `<title>` her zaman İngilizce**, dilden bağımsız. Gerekçe:
  `DECISIONS.md` → Çok dillilik.
- **API hata mesajları arayüzde çevrilir.** Sunucu sabit bir `code` gönderiyor;
  `useApiError()` bunu `error.<code>` anahtarına eşliyor. Yeni bir hata kodu
  eklediğinizde sözlüğe de ekleyin — yoksa kullanıcı sunucunun Türkçe metnini
  görür (bilinçli geri düşüş, ama İngilizce arayüzde tutarsız durur).
- Tarih/saat biçimlendirmesinde `localeTag(lang)` kullanın, sabit `'tr-TR'`
  değil.
- **Efekt bağımlılıklarına dikkat:** `t` dil değiştiğinde yeni referans alır.
  SSH oturumu kuran efektlerde bağımlılık olarak vermeyin; `TerminalPane`
  içindeki `tRef` desenini izleyin — yoksa dil seçmek açık oturumları koparır.

Sunucu tarafındaki metinler (API hata mesajları, denetim uyarıları) Türkçe
kalır; çeviri katmanı yalnızca arayüzde.

## ⚠ Veritabanı testte paylaşılıyor

Testler kullanıcının **canlı verisiyle aynı Postgres örneğini** kullanıyor.

- Gerçek kullanıcı: `erolbeyaz@gmail.com`
- Test hesapları: `erol@sirket.com.tr` (admin), `ayse@sirket.com.tr`

**`delete from hosts` gibi global komutlar yasak.** Bir kez yapıldı ve
kullanıcının kaydettiği sunucular silindi. Temizlik yalnızca API üzerinden,
yalnızca test kullanıcısının kendi kayıtlarında yapılır:

```
GET /api/inventory → her host için DELETE /api/hosts/:id
GET /api/credentials → her kayıt için DELETE /api/credentials/:id
```

Şüphede kalınca önce kimin verisi olduğuna bakın:

```sql
select h.name, u.email from hosts h join users u on u.id = h.owner_id;
```

## Komutlar

```bash
# Her şeyi derle ve ayağa kaldır (şema değiştiyse ŞART: migrate ayrı imaj)
docker compose -f deploy/compose/docker-compose.yml up -d --build

# Yalnızca tek servis
docker compose -f deploy/compose/docker-compose.yml up -d --build api

# Tip denetimi (imaj derlemeden)
docker build -f deploy/docker/Dockerfile.web --target build -t sshby-web-build .
docker run --rm --entrypoint sh sshby-web-build -c "cd /app && pnpm --filter @sshby/web typecheck"

# Loglar
docker compose -f deploy/compose/docker-compose.yml logs api --tail 50
```

Uygulama: http://localhost:8088

**Şema değiştirdiyseniz servis adı vermeden derleyin** — `migrate` ayrı bir
imaj ve `--build api` onu kapsamaz. Göç uygulanmadan API eski şemayla açılır.

## Test betikleri

`scratchpad/` altında (depoya girmiyor). Node betikleri compose ağında
çalıştırılır:

```bash
docker run --rm --network sshby_default \
  -v "<scratchpad>/test-faz3.mjs:/app/t.mjs" -w /app \
  -e BASE=http://web:8080 --entrypoint node sshby-api /app/t.mjs
```

Betiği `/app` altına bağlamak şart, yoksa `ws` paketi çözülemiyor.

**Sıra önemli:** `test-faz2.ps1` `test-ssh-01..03` sunucularını kurar,
`test-faz3.mjs` onları kullanır, `test-username.mjs` hepsini silip kendi
verisini kurar. Faz 3'ü çalıştırmadan önce Faz 2'yi çalıştırın.

## PowerShell tuzakları (bu ortamda ısırdı)

- **Değişken adları büyük/küçük harf duyarsız.** `$h` döngü değişkeni, kimlik
  başlıklarını tutan `$H`'yi ezer.
- **`Get-Content`/`Set-Content` kodlaması.** UTF-8 dosyayı ANSI okuyup UTF-8
  yazmak Türkçe karakterleri bozar. Dosya düzenlemek için Edit aracını kullanın;
  mecbursanız `[System.IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)`.
- **Gövdesiz DELETE'e `Content-Type` göndermeyin** — Fastify boş JSON gövdesini
  reddeder.
- **Tek nesne dönen `Where-Object` sonucunda `.Count` güvenilmez** — `@()` ile
  sarın.

## Kod tarzı

- Yorumlar **neden**i anlatır, ne yaptığını değil. Bir karar tartışmalıysa
  bedelini de yazın.
- Kullanıcıya dönen her hata mesajı, kullanıcının ne yapması gerektiğini
  söylemeli. `internal_error` son çare.
- Sözleşmeler `packages/shared` içinde zod ile. api ve web aynı şemayı kullanır.
- Yeni tablo/sütun: `schema.ts` **ve** `migrations/NNNN_*.sql` birlikte.

## Dokümantasyon güncelliği

Her geliştirme görevinde, kod değişikliği bittikten sonra görevin dokümantasyon
etkisi değerlendirilmelidir. Kod ile doküman birbirinden kopmamalı.

**Kullanıcının ayrıca "dokümanları güncelle" demesini beklemeyin.** Ancak bir
değişiklik gerçekten dokümantasyonu etkilemiyorsa, sırf dosya değiştirmiş olmak
için doküman değiştirmeyin.

### Hangi dosya ne zaman güncellenir

**`docs/CURRENT_STATE.md`** — şunlardan biri değiştiyse: tamamlanan özellikler,
aktif faz, çalışan özellikler, bilinen sınırlar, doğrulanmış test sonuçları,
mevcut ortam davranışı. Bu dosya proje tarihçesi değil, **şu anda gerçekten
neyin çalıştığının** özetidir.

**`docs/TODO.md`** — tamamlanan işleri işaretleyin veya kaldırın, yeni ortaya
çıkan gerçek işleri ekleyin, geçerliliğini yitirenleri temizleyin. Tamamlanmış
büyük özelliklerin uzun checklist'lerini sonsuza kadar tutmayın; ayrıntı
`CURRENT_STATE.md`'de bulunur.

**`docs/ARCHITECTURE.md`** — sistem mimarisi, veri modeli, servis ilişkileri,
protokoller, HTTP/WebSocket akışları, güvenlik akışları, önemli veri akışları,
durum yönetimi yaklaşımı ya da dağıtım mimarisi değiştiyse. Sıradan kod
refactor'larında dokunmayın.

**`docs/DECISIONS.md`** — yeni ve önemli bir mimari, güvenlik, protokol, veri
modeli, dağıtım ya da kullanıcı davranışı kararı verildiyse kararı ve
**nedenini** ekleyin. Sıradan implementasyon ayrıntılarını karar seviyesine
çıkarmayın. Mevcut bir karar değiştiyse eski gerekçeyi sessizce silmeyin —
kararın **neden değiştiğini** kaydedin.

**`README.md`** — kullanıcıya dönük özellikler, kurulum, kullanım, desteklenen
yetenekler, geliştirme komutları, dağıtım şekli, yol haritası ya da dış
bağımlılıklar değiştiyse. README **var olmayan bir özelliği tamamlanmış gibi
göstermemeli.**

**`docs/NEXT_SESSION.md`** — aktif çalışma, son tamamlanan önemli iş, mevcut
eksik/engel, sıradaki somut işler ya da bir sonraki oturumun devam noktası
değiştiğinde. Bu dosya proje günlüğü değildir; yalnızca yeni bir oturumun
önceki konuşma olmadan devam edebilmesi için gereken güncel bilgiyi taşır.
Tamamlanmış handoff ayrıntılarını zamanla temizleyin.

### Güncellemenin varsayılan olarak zorunlu olduğu durumlar

- yeni bir özellik tamamlandıysa
- bir faz tamamlandıysa
- aktif faz değiştiyse
- yeni REST uç noktası eklendiyse veya değiştiyse
- yeni WebSocket mesajı / protokol davranışı eklendiyse veya değiştiyse
- veri modeli değiştiyse
- migration eklendiyse
- önemli mimari yaklaşım değiştiyse
- önemli güvenlik kararı alındıysa
- bilinen bir sınır çözüldüyse
- yeni bir bilinen sınır ortaya çıktıysa
- dağıtım davranışı değiştiyse
- yapılandırma / ortam değişkeni davranışı değiştiyse
- TODO'daki bir iş tamamlandıysa
- bir sonraki oturumun devam noktası değiştiyse
- önemli bir teknik karar verildiyse

### Görev sonu akışı

1. Kod değişikliğini tamamla.
2. İlgili testleri / build / typecheck / doğrulamaları **gerçekten çalıştır**.
3. Değişikliğin dokümantasyon etkisini belirle.
4. İlgili dokümanları **aynı çalışma kapsamında** güncelle.
5. `CURRENT_STATE`, `TODO`, `ARCHITECTURE`, `DECISIONS`, `README` ve
   `NEXT_SESSION` arasında çelişki kalmadığını kontrol et.
6. `git diff` üzerinden kod ve doküman değişikliklerini birlikte gözden geçir.
7. **Commit'le ve `origin/main`'e pushla** (aşağıdaki bölüm).
8. Kullanıcıya bildirirken kısaca söyle: hangi kod değişiklikleri yapıldı,
   hangi doğrulamalar çalıştırıldı, hangi doküman dosyaları güncellendi.

## Git

Uzak depo: `https://github.com/erolbeyaz/sshby.git` (**private**), tek dal:
`main`.

**Her tamamlanan iş push'lanır.** Kullanıcının kalıcı talimatı: çalışma
bilgisayarı dışında bir kopyanın her zaman güncel olması isteniyor. Bir görev
"bitti" diye bildirilmeden önce commit ve push yapılmış olmalı.

Kurallar:

- Commit mesajları **Türkçe** (kod yorumlarıyla aynı kural). Ne yapıldığını
  değil, **neden** yapıldığını da yazın.
- Kimlik depo düzeyinde ayarlı: `Erol Beyaz <erolbeyaz@gmail.com>`. Global
  git yapılandırması kurumsal e-posta taşıyor, ona dokunmayın.
- **Kimlik bilgisi `.git/config`'e yazılmaz.** Push, kimliği tek seferlik URL
  olarak alan bir komutla yapılır; `--set-upstream` ile token'lı bir URL
  kaydedilirse `.git/config` içine sızar. Upstream zaten `origin`'e bağlı.
- Push öncesi staged dosyaları gizli veri için tarayın: `.env`, `*.key`,
  `*.pem`, `settings.local.json`, token benzeri dizeler. `.gitignore` bunları
  zaten engelliyor ama tek savunma hattına bel bağlamayın.
- Depo **private**. Açık kaynak yayınından önce `docs/TODO.md` → "açık kaynak
  yayına hazırlık" maddeleri (bu dosyadaki gerçek e-posta ve test parolaları
  dahil) tamamlanmalı.

### Oturum devri

`docs/NEXT_SESSION.md` şu durumlarda mutlaka güncellenir:

- büyük bir özellik tamamlandığında
- bir faz tamamlandığında
- aktif çalışma yön değiştirdiğinde
- önemli bir engel ortaya çıktığında
- bağlam ciddi şekilde büyüdüğünde
- yeni bir oturuma geçmek mantıklı hale geldiğinde

Dosya **içermemeli**: uzun geçmiş, eski konuşma özeti, tamamlanmış onlarca
küçük görev, gereksiz hata ayıklama geçmişi.

Dosya **içermeli**: nerede kalındı, şu anda ne çalışıyor, ne eksik, sıradaki
somut işler, dikkat edilmesi gereken kritik noktalar.

## Doğrulama beklentisi

Bir değişikliği "çalışıyor" diye bildirmeden önce çalıştırıp gösterin. Bu
projede şimdiye kadar bulunan hataların çoğu, çalıştığı varsayılan koddan çıktı.

Tarayıcı testinde bilinen sınır: test tarayıcısı kare üretmiyor
(`visibilityState: hidden`), bu yüzden `requestAnimationFrame` ve
`ResizeObserver` çalışmıyor. xterm çizimini rAF içinde yaptığı için ekran boş
görünür — **bu bir uygulama hatası değil**. Terminal tamponunu doğrudan okuyarak
doğrulayın; görsel teyit kullanıcıdan istenmeli.
