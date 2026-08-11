import { useRef } from 'react';
import clsx from 'clsx';

/**
 * Kenar çubuğunun genişliğini ayarlayan sürükleme çizgisi.
 *
 * Uzun sunucu adları dar bir çubukta okunmuyordu. Genişlik `localStorage`da
 * saklanıyor: kullanıcı bir kez ayarlayıp unutabilmeli.
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
  const dragging = useRef(false);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Sunucular çubuğunun genişliğini ayarla"
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
        // Fare yakalama: imleç terminalin üzerine geçse bile olaylar buraya gelir.
        event.currentTarget.setPointerCapture(event.pointerId);
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        // Çubuk soldan başladığı için genişlik doğrudan imlecin x konumu.
        onChange(Math.min(max, Math.max(min, event.clientX)));
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
      onDoubleClick={() => onChange(250)}
      title="Sürükleyerek genişliği ayarlayın · çift tıkla sıfırla"
    />
  );
}
