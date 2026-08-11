# Yapılacaklar

Bu dosya **bundan sonra ne yapılacağını** gösterir. Şu an neyin çalıştığı
`CURRENT_STATE.md` içindedir.

## Tamamlananlar

Ayrıntılar için `CURRENT_STATE.md`:

- **Faz 0** — monorepo, tema, Docker altyapısı
- **Faz 1** — kayıt, giriş, roller, oturum yönetimi
- **Faz 2** — credential kasası, klasör ağacı, sunucu envanteri
- **Faz 3** — WebSocket terminal, paralel oturumlar, TOFU
- **Faz 4** — SFTP dosya yöneticisi (sudo modu dahil)
- **Faz 5** — sunucu metrik paneli
- **Faz 6** — Elasticsearch denetim akışı (gönderici, admin ekranı, ILM,
  katı mod)
- **Faz 7** — yapılandırma dışa/içe aktarma (iki gizli veri kipi, üç çakışma
  stratejisi, `config.export` / `config.import` denetim olayları)
- **Quick Connect (hızlı bağlantı)** — envantere kaydetmeden tek seferlik erişim
- **Komut geçmişi** — sunucu başına panel, kaynak `audit_outbox`
- **İki dilli arayüz** — TR/ENG seçici, İngilizce URL ve sekme başlıkları,
  hesap menüsüne taşınan yapılandırma aktarımı, "powered by erolbeyaz" imzası
- **Arayüz düzeni** — sol dikey bölüm menüsü ve açılır panel, bölümlenmiş
  sunucu formu, aranabilir/oluşturulabilir klasör seçici, klasör içinde
  klasör, sunucu notu ve sabitleme

Faz 6'dan kalan tek iş:

- [ ] **Kibana örnek panosu** — indeks deseni ve hazır görselleştirmeler.
      Aktarım çalışıyor, veri `sshby-audit-*` içinde; pano tanımı yapılmadı.

## Faz 8 — Dağıtım ve sıkılaştırma (sırada)

**Kapsam değişti:** Helm çıkarıldı. Gerekçe `DECISIONS.md` → Altyapı; özeti,
Helm'in şablon katmanının bu ölçekte taşıdığı yükten fazlasını çözmemesi.
Yerine önce tek makine Docker dağıtımı, sonra ham Kubernetes manifest'leri.

### 8a — Docker dağıtımı (tamam)

- [x] Üretim compose'u (`docker-compose.prod.yml`) — named volume, özel ağ,
      sağlık kontrolleri, log rotasyonu, bellek sınırları, `no-new-privileges`
- [x] Elasticsearch/Kibana ve test SSH sunucusu üretimden çıkarıldı; ES var
      olan bir kümeye uygulama içinden bağlanıyor
- [x] Gizli anahtarlar zorunlu, varsayılansız (`${DEĞİŞKEN:?…}`)
- [x] `.env.prod.example` ve kurulum/işletim dokümanı (`docs/DEPLOYMENT.md`)

### 8b — Kubernetes manifest'leri

- [ ] Namespace, Deployment (api, web), Service, Ingress
- [ ] Secret (kök anahtar, JWT, DB parolası), ConfigMap
- [ ] Postgres: StatefulSet + PVC ya da dış yönetilen veritabanına yönlendirme
      kararı
- [ ] Migration'lar için Job (deployment öncesi çalışan)
- [ ] Liveness/readiness probları, kaynak istekleri ve sınırları,
      PodSecurityContext (non-root, read-only kök dosya sistemi)
- [ ] Birden çok `api` kopyası: `audit_outbox` zaten `for update skip locked`
      ile güvenli, ama SSH oturumları süreç belleğinde — oturum yapışkanlığı
      (session affinity) gerekip gerekmediği sınanmalı

### 8c — Kalan sıkılaştırma

- [ ] TLS — üretimde ters proxy'ye bırakıldı; Kubernetes'te Ingress + cert
      yönetimi kararı verilecek
- [ ] Rate limit ayarlarını gözden geçir
- [ ] Otomatik yedek (şu an `pg_dump` komutu dokümanda, zamanlayıcı yok)

## Açık kaynak yayına hazırlık

Proje GitHub'a açık kaynak olarak yayınlanacak. Depo şu an kurumsal ağa özel
varsayımlar taşıyor; dışarıdan klonlayan birinin derleyebilmesi için bunların
isteğe bağlı hale gelmesi gerekiyor.

- [ ] **Kurumsal CA sertifikasını isteğe bağlı yap.** Şu an
      `deploy/docker/certs/corporate-ca.crt` her iki Dockerfile'da koşulsuz
      kopyalanıyor; dosya yoksa derleme kırılır. `ARG` ile isteğe bağlı hale
      getirilmeli, dosya yoksa derleme sorunsuz sürmeli. (Sertifika Forcepoint'in
      genel bulut CA'sı — gizli değil, ama TLS kesmesi olmayan ağlarda anlamsız.)
- [ ] **CA'yı api çalışma imajından çıkar.** `Dockerfile.api`'de `runner`
      katmanı `base`'den türediği için sertifika ve `NODE_EXTRA_CA_CERTS`
      çalışma imajına da geçiyor. Derleme dışında yalnızca Elasticsearch'e
      HTTPS ile bağlanırken gerekebilir; o durumda Kubernetes'te Secret /
      ConfigMap olarak mount edilmeli. İmaja gömmek, API'nin o CA ile
      imzalanmış her şeye güvenmesi demek.
      (`Dockerfile.web` zaten temiz — çalışma katmanı nginx'ten türüyor.)
- [ ] **Gerçek kişisel veriyi depodan çıkar.** `AGENTS.md` içinde gerçek bir
      e-posta adresi ve test parolaları var; açık depoda yer almamalı.
      Yer tutucularla değiştirilmeli.
- [ ] **Son admin korumasi kontrol edilmedi.** Gerçek hesap
      (`erolbeyaz@gmail.com`) artık admin — bu madde çözüldü. Açık kalan tek
      soru: hiç admin kalmadığında ne oluyor? Son admin kendini pasifleştirip
      kurulumu yönetilemez hâle getirebiliyor mu, sınanmadı.
- [ ] **`deploy/docker/certs/README.md` kurum ağını tarif ediyor.** Genel bir
      "TLS kesmesi olan ağlarda ne yapmalı" rehberine dönüştürülmeli.
- [ ] **README'deki kurumsal ağ notunu genelleştir.**
- [ ] Lisans dosyası, katkı rehberi, örnek `.env` gözden geçirmesi

## Faz 9 — OIDC / Keycloak

Mevcut kapsamın dışında; Faz 8 bittikten sonraki aşama.

- [ ] Authorization code + PKCE
- [ ] `users.external_idp_sub` eşlemesi (sütun hazır)
- [ ] Rol eşlemesi (Keycloak grubu → sshby rolü)
- [ ] Yerel parola girişiyle bir arada yaşama

## Teknik borç

- [ ] **Sunucudan gelen serbest metinler çevrilmiyor.** İçe aktarma raporundaki
      uyarılar ve denetim gönderici durum mesajları Türkçe üretiliyor; İngilizce
      arayüzde de Türkçe görünüyorlar. Kayıt adları içerdikleri için
      şablonlanmaları (kod + parametre) gerekir. Sabit `code` taşıyan hatalar
      zaten çevriliyor.


- [ ] **Otomatik test paketi yok.** `pnpm test` betiği ve `vitest` bağımlılığı
      var ama depoda hiç test dosyası yok; doğrulama betikleri scratchpad'de
      duruyor ve depoya girmiyor. En azından zarf şifreleme, komut kaydedici ve
      kullanıcı adı çözümlemesi birim testi hak ediyor.
- [ ] **Dosya gezgini geri düğmesi.** Geçmiş yığını beklenen davranışı
      vermiyor; kullanıcı şimdilik önceliklendirmedi.
- [ ] **Metrik zaman aralıkları.** Pano yalnızca anlık değer gösteriyor;
      1H/6H/24H/7D düğmeleri ve sparkline geçmişi yapılmadı. Örnekleri saklamak
      için depo kararı gerekiyor.
- [ ] **Yanlış parolada yeniden deneme.** Protokolde `retry` alanı tanımlı ama
      yeniden deneme döngüsü kurulmadı; bağlantı kapanıyor.
- [ ] **Atlama sunucusu.** `hosts.jump_host_id` sütunu var, hiçbir yerde
      kullanılmıyor; ya bağlanmalı ya kaldırılmalı.
- [ ] **Izgara bölme oranları kalıcı değil.** Sayfa yenilenince eşit dağılıma
      döner; `localStorage`a yazılabilir.
- [ ] **Sekme sınırı 12.** Izgara 4×3'e kadar uyum sağlıyor ama o boyutta her
      terminal çok küçük kalıyor; sayfalama ya da kaydırma gerekebilir.
- [ ] **Fastify `disableRequestLogging` uyarısı.** Fastify 6'da kaldırılacak,
      `logController` ile değiştirilmeli.
- [ ] **`cpu-features` derleme uyarısı.** ssh2'nin isteğe bağlı bağımlılığı;
      zararsız ama build çıktısını kirletiyor.
