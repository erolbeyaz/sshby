import { useRef } from 'react';
import clsx from 'clsx';
import { useT } from '@/lib/i18n';

/**
 * Panelin genişliğini ayarlayan sürükleme çizgisi.
 *
 * Genişlik doğrudan `event.clientX` değildi: panelin solunda bölüm menüsü
 * duruyor ve panel ekranın solundan başlamıyor. `clientX`i genişlik saymak
 * menü genişliği kadar (168 px) sıçramaya yol açıyordu — kullanıcı çubuğa
 * dokunur dokunmaz panel sağa fırlıyordu.
 *
 * Bunun yerine sürükleme başlarken panelin **sol kenarı** bir kez ölçülüp
 * sabitleniyor; genişlik o kenara olan mesafe. Çubuk nerede durursa dursun
 * doğru çalışır.
 */
export function SidebarResizer({
  width,
  min = 200,
  max = 560,
  onChange,
}: {
  width: number;
  min?: number;
  max?: number;
  onChange: (width: number) => void;
}) {
  const t = useT();
  const dragging = useRef(false);
  /** Panelin sol kenarının ekrandaki x konumu; sürükleme boyunca sabit. */
  const originRef = useRef(0);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('sidebar.resizeAria')}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={clsx(
        'w-[5px] shrink-0 cursor-col-resize bg-transparent transition-colors',
        'hover:bg-accent/40 focus-visible:bg-accent/40',
      )}
      onPointerDown={(event) => {
        event.preventDefault();
        dragging.current = true;
        // Çubuğun solundaki kenar = çubuğun sol kenarı eksi panelin genişliği.
        originRef.current = event.currentTarget.getBoundingClientRect().left - width;
        // Fare yakalama: imleç terminalin üzerine geçse bile olaylar buraya gelir.
        event.currentTarget.setPointerCapture(event.pointerId);
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        const next = event.clientX - originRef.current;
        onChange(Math.min(max, Math.max(min, next)));
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
        document.body.style.removeProperty('cursor');
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10;
        if (event.key === 'ArrowLeft') onChange(Math.max(min, width - step));
        else if (event.key === 'ArrowRight') onChange(Math.min(max, width + step));
        else return;
        event.preventDefault();
      }}
      onDoubleClick={() => onChange(300)}
      title={t('sidebar.resizeTitle')}
    />
  );
}
