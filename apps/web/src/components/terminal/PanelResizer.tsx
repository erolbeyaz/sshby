import { useRef } from 'react';
import clsx from 'clsx';
import { useT } from '@/lib/i18n';

/**
 * Terminal ile sağdaki yan panel (dosyalar / metrikler / geçmiş) arasındaki
 * sürükleme çizgisi.
 *
 * Paneller sabit yüzdeyle açılıyordu; dosya adları uzun olduğunda panel dar,
 * terminalde uzun çıktı okurken geniş kalıyordu ve kullanıcının yapabileceği
 * hiçbir şey yoktu.
 *
 * `SidebarResizer`dan farkı yön: orada çubuk panelin sağında ve genişlik
 * doğrudan imlecin x konumu. Burada çubuk panelin **solunda**, panel sağa
 * yaslı — bu yüzden genişlik pencerenin sağ kenarından imlece olan mesafe.
 */
export function PanelResizer({
  width,
  min = 320,
  onChange,
  onReset,
}: {
  width: number;
  min?: number;
  onChange: (width: number) => void;
  onReset: () => void;
}) {
  const t = useT();
  const dragging = useRef(false);

  /** Terminal tarafı da kullanılabilir kalmalı; panel ekranı yutamaz. */
  const maxWidth = () => Math.max(min, window.innerWidth - 420);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('splitter.column')}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={maxWidth()}
      tabIndex={0}
      className={clsx(
        'w-[5px] shrink-0 cursor-col-resize bg-transparent transition-colors',
        'hover:bg-accent/40 focus-visible:bg-accent/40',
      )}
      onPointerDown={(event) => {
        event.preventDefault();
        dragging.current = true;
        // Fare yakalama: imleç terminalin üzerine geçse bile olaylar buraya gelir.
        event.currentTarget.setPointerCapture(event.pointerId);
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        const next = window.innerWidth - event.clientX;
        onChange(Math.min(maxWidth(), Math.max(min, next)));
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
        document.body.style.removeProperty('cursor');
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10;
        // Sol ok paneli büyütür: panel sağda olduğu için sınır sola kayar.
        if (event.key === 'ArrowLeft') onChange(Math.min(maxWidth(), width + step));
        else if (event.key === 'ArrowRight') onChange(Math.max(min, width - step));
        else return;
        event.preventDefault();
      }}
      onDoubleClick={onReset}
      title={t('splitter.title')}
    />
  );
}
