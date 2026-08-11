import { useT } from '@/lib/i18n';

/**
 * Uygulama imzası.
 *
 * Her ekranda görünür: giriş ekranında formun altında, oturum açıldıktan sonra
 * alt durum çubuğunda — durum çubuğu yönlendiricinin dışında yaşadığı için tek
 * yere koymak her sayfayı kapsıyor.
 *
 * Çevrilmez: bir isim, arayüz metni değil. Soluk renkte ve küçük punto ile
 * duruyor çünkü uygulamanın işiyle yarışmaması gerekiyor.
 */
export function Signature({ className }: { className?: string }) {
  const t = useT();
  return (
    <span className={className ?? 'font-mono text-[10.5px] text-fg-dim/70'}>
      {t('brand.poweredBy')}
    </span>
  );
}
