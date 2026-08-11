# Sonraki oturum

## Aktif faz

**Faz 8 — Dağıtım ve sıkılaştırma.** Henüz başlanmadı.

## Mevcut durum

Faz 0–7 tamamlandı. Son biten iş **Faz 7 — yapılandırma dışa/içe aktarma**:
`POST /api/config/export` ve `POST /api/config/import`, iki gizli veri kipi
(hariç / parola korumalı şifreli paket), üç çakışma stratejisi, `/yapilandirma`
ekranı ve `config.export` / `config.import` denetim olayları. 29/29 doğrulandı —
şifreli paket temiz bir ortama geri yüklendikten sonra içe aktarılan kimlikle
gerçek SSH bağlantısı kuruldu.

Uygulama compose ile ayakta: http://localhost:8088

Faz 7 sonrası ayrıca **arayüz iki dilli hale getirildi** (TR/ENG), URL yolları
ve sekme başlıkları İngilizceye çevrildi, yapılandırma aktarımı ayrı sayfadan
hesap menüsündeki diyaloğa taşındı ve "powered by erolbeyaz" imzası eklendi.

## Şu anda eksik olan

- **Arayüz tarayıcıda elle görülmedi.** Tip denetimi, derleme ve dağıtılan
  paket içeriği doğrulandı, API 29/29 geçti; dil değiştirme, yapılandırma
  diyaloğu ve imzanın görsel teyidi kullanıcıda.
- **Sunucudan gelen serbest metinler çevrilmiyor** — içe aktarma raporundaki
  uyarılar ve gönderici durum mesajları Türkçe üretiliyor. Kayıt adları
  içerdikleri için şablonlanmaları gerekir.
- **Kibana örnek panosu** — Faz 6'dan kalan tek iş. Veri `sshby-audit-*` içinde
  akıyor ama hazır görselleştirme yok.
- **Helm chart yok** — `deploy/helm` dizini henüz oluşturulmadı.

## Sonraki hedefler

Faz 8 kapsamında (ayrıntı: `docs/TODO.md`):

- Helm chart: Deployment, Service, Ingress, Secret, ConfigMap, pre-upgrade
  migration hook
- TLS — tarayıcı pano API'sinin (sağ tık → Yapıştır) çalışması için de gerekli
- Kaynak sınırları, sağlık probları, PodSecurityContext
- Rate limit ayarlarını gözden geçir
- Kurulum ve işletim dokümanı

Açık kaynak yayına hazırlık maddeleri (kurumsal CA'yı isteğe bağlı yapma,
`AGENTS.md`'deki gerçek e-posta ve test parolalarını yer tutucuyla değiştirme)
Faz 8 ile birlikte ilerletilebilir.

## Önce okunacak dosyalar

Bu sırayla:

1. `docs/CURRENT_STATE.md`
2. `AGENTS.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DECISIONS.md`
5. `docs/TODO.md`

`README.md` genel proje tanıtımıdır; çalışma durumu için doğruluk kaynağı
değildir.

## Kritik kurallar

- **Test veritabanı gerçek kullanıcı verisiyle paylaşılıyor.** Global
  `DELETE`/`TRUNCATE` çalıştırma. Temizlik yalnızca API üzerinden ve yalnızca
  test kullanıcısının kendi kayıtlarında yapılır.
- **`schema.ts` ve `apps/api/migrations/NNNN_*.sql` birlikte güncellenir.**
  Şema değiştiyse servis adı vermeden derle — `migrate` ayrı bir imaj.
- **Mevcut mimari kararları `DECISIONS.md` okumadan değiştirme.**
- **Gizli veri (parola, anahtar, sudo parolası, ES parolası, paket parolası)
  hiçbir HTTP yanıtına, denetim kaydına ya da loga sızmamalı.**
- **Bir değişikliği "çalışıyor" diye bildirmeden önce gerçekten çalıştır.**
