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

## Şu anda eksik olan

- **Yapılandırma ekranı tarayıcıda elle görülmedi.** API uçtan uca test edildi,
  web tip denetimi ve derlemesi geçti, ama `/yapilandirma` sayfası görsel olarak
  doğrulanmadı. Kullanıcıdan teyit istenmeli.
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
