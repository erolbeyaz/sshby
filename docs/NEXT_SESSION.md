# Sonraki oturum

## Aktif faz

**Faz 8c — kalan sıkılaştırma.** 8a (tek makine Docker) ve 8b (Kubernetes
manifest'leri) tamamlandı.

Faz 8'in kapsamı kullanıcı kararıyla değişti: **Helm kullanılmıyor.** Yerine
Docker ile tam çalışan bir kurulum ve ham Kubernetes manifest'leri (kustomize
ile tek komut). Gerekçe `DECISIONS.md` → Altyapı.

**Kubernetes manifest'leri hiçbir kümede sınanmadı.** Resmi şema doğrulaması
(v1.30) ve tutarlılık kontrolleri geçti, `kubectl kustomize` çıktısı üretildi —
ama gerçek bir kümeye uygulanmadı. İlk deneme kullanıcıda.

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

Ardından **arayüz düzeni yeniden kuruldu**: gezinme sol dikey menüye taşındı,
bölümler sağa açılan panelde gösteriliyor, sunucu formu bölümlere ayrıldı,
klasör seçici aranabilir/oluşturulabilir hâle geldi ve klasör içinde klasör
açmak ağaçtan da form üzerinden de mümkün. `hosts` tablosuna `notes` ve
`pinned` eklendi (migration `0004`).

## Şu anda eksik olan

- **Arayüz tarayıcıda elle görülmedi.** Tip denetimi, derleme ve dağıtılan
  paket içeriği doğrulandı; API tarafı 29/29 + 12/12 geçti. Yeni düzenin
  (sol menü, panel, sunucu formu, klasör seçici), dil değiştirmenin ve
  imzanın görsel teyidi kullanıcıda.
- **Sunucudan gelen serbest metinler çevrilmiyor** — içe aktarma raporundaki
  uyarılar ve gönderici durum mesajları Türkçe üretiliyor. Kayıt adları
  içerdikleri için şablonlanmaları gerekir.
- **Kibana örnek panosu** — Faz 6'dan kalan tek iş. Veri `sshby-audit-*` içinde
  akıyor ama hazır görselleştirme yok.
- **Helm chart yok** — `deploy/helm` dizini henüz oluşturulmadı.

## Sonraki hedefler

Faz 8c kapsamında (ayrıntı: `docs/TODO.md`):

- Rate limit ayarlarını gözden geçir
- Yedekleme için CronJob (`pg_dump` komutu dokümanda, zamanlayıcı yok)
- NetworkPolicy — namespace trafiği kısıtlanmıyor
- Kibana örnek panosu (Faz 6'dan kalan tek iş)

Sonra **açık kaynak yayına hazırlık** (`TODO.md`): kurumsal CA'yı isteğe bağlı
yapmak, `AGENTS.md`'deki gerçek e-posta ve test parolalarını temizlemek, lisans
ve katkı rehberi.

`api` yatay ölçekleme bilinçli olarak ertelendi: oturum durumunu paylaşmak
(Redis ya da oturumu sahibi pod'a yönlendiren bir katman) gerekiyor. Gerekçe
`DECISIONS.md` → Kubernetes.

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
