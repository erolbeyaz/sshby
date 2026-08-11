import { useEffect } from 'react';

/**
 * Tarayıcı sekmesinin başlığını ayarlar.
 *
 * Başlıklar ve URL yolları **her zaman İngilizce**, arayüz dilinden bağımsız.
 * Sekme başlığı ve adres çubuğu uygulamanın dışına taşan yüzeyler: yer imi,
 * geçmiş, paylaşılan bağlantı ve hata raporlarında görünürler; kullanıcının o
 * anki dil seçimine göre değişmeleri bu kayıtları tutarsız kılardı.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · sshby`;
    return () => {
      document.title = 'sshby';
    };
  }, [title]);
}
