import { useCallback, useEffect, useRef, type RefObject } from 'react';
import clsx from 'clsx';
import { useT } from '@/lib/i18n';

/**
 * Izgara panellerini ayıran, sürüklenebilir çizgi.
 *
 * Fare yakalama (`setPointerCapture`) kullanıyoruz: sürükleme sırasında imleç
 * terminalin üzerine geçtiğinde olaylar çizgiye gelmeye devam ediyor. Aksi
 * hâlde xterm imleci yakalıyor ve sürükleme yarıda kesiliyor.
 */
export function GridSplitter({
  orientation,
  percent,
  containerRef,
  onChange,
  onReset,
}: {
  orientation: 'vertical' | 'horizontal';
  percent: number;
  containerRef: RefObject<HTMLElement>;
  onChange: (percent: number) => void;
  /** Çift tık: tek bir sınırı değil, o eksenin tamamını eşitler. */
  onReset: () => void;
}) {
  const t = useT();
  const draggingRef = useRef(false);

  const compute = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const value =
        orientation === 'vertical'
          ? ((clientX - rect.left) / rect.width) * 100
          : ((clientY - rect.top) / rect.height) * 100;
      onChange(value);
    },
    [containerRef, onChange, orientation],
  );

  // Sürükleme bitmeden bileşen sökülürse imleç kilitli kalmasın.
  useEffect(() => {
    return () => {
      if (draggingRef.current) document.body.style.removeProperty('cursor');
    };
  }, []);

  const vertical = orientation === 'vertical';

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={vertical ? t('splitter.column') : t('splitter.row')}
      tabIndex={0}
      className={clsx(
        'absolute z-10 bg-transparent transition-colors hover:bg-accent/40 focus-visible:bg-accent/40',
        vertical
          ? 'top-0 h-full w-[7px] -translate-x-1/2 cursor-col-resize'
          : 'left-0 h-[7px] w-full -translate-y-1/2 cursor-row-resize',
      )}
      style={vertical ? { left: `${percent}%` } : { top: `${percent}%` }}
      onPointerDown={(event) => {
        event.preventDefault();
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        // Sürükleme boyunca imleci sabitle: terminalin metin imleci araya girmesin.
        document.body.style.cursor = vertical ? 'col-resize' : 'row-resize';
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current) return;
        compute(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        draggingRef.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
        document.body.style.removeProperty('cursor');
      }}
      /** Klavyeyle de ayarlanabilsin — fare tek yol olmamalı. */
      onKeyDown={(event) => {
        const step = event.shiftKey ? 10 : 2;
        if (vertical && event.key === 'ArrowLeft') onChange(percent - step);
        else if (vertical && event.key === 'ArrowRight') onChange(percent + step);
        else if (!vertical && event.key === 'ArrowUp') onChange(percent - step);
        else if (!vertical && event.key === 'ArrowDown') onChange(percent + step);
        else return;
        event.preventDefault();
      }}
      onDoubleClick={onReset}
      title={t('splitter.title')}
    />
  );
}
