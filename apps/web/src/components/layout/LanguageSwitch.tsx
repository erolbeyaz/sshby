import clsx from 'clsx';
import { useI18n, type Lang } from '@/lib/i18n';

/**
 * Dil seçici — hesap düğmesinin hemen solunda.
 *
 * Açılır menü yerine iki düğme: iki seçenek varken menü açtırmak fazladan bir
 * tıklama ve seçili dilin ne olduğunu bakışta gizler. Etiketler kendi
 * dillerinde yazılı (İngilizce arayüzde bile "TR"), çünkü dil adları
 * çevrilmez — kullanıcı anlamadığı bir arayüzde kendi dilini arıyor olabilir.
 */
const OPTIONS: { value: Lang; label: string; title: string }[] = [
  { value: 'tr', label: 'TR', title: 'Türkçe' },
  { value: 'en', label: 'ENG', title: 'English' },
];

export function LanguageSwitch() {
  const { lang, setLang } = useI18n();

  return (
    <div
      className="flex items-center overflow-hidden rounded border border-line"
      role="group"
      aria-label="Language / Dil"
    >
      {OPTIONS.map((option) => {
        const active = lang === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={clsx(
              'px-1.5 py-1 font-mono text-[10.5px] tracking-wide transition-colors',
              active
                ? 'bg-surface text-accent'
                : 'text-fg-dim hover:bg-surface hover:text-fg',
            )}
            onClick={() => setLang(option.value)}
            aria-pressed={active}
            title={option.title}
            lang={option.value}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
