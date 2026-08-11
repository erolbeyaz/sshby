import { useEffect, useRef, type ReactNode } from 'react';
import { XIcon } from 'lucide-react';

/**
 * Basit modal. `<dialog>` yerine elle kurulmuş: Firefox'ta `<dialog>`
 * animasyonları ve odak sırası hâlâ tutarsız, burada davranışı tam kontrol
 * etmek daha az sürpriz üretiyor.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    // Açılışta ilk odaklanabilir öğeye geç — klavyeyle çalışanlar için önemli.
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      'input, textarea, select, button',
    );
    focusable?.focus();

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-12 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`panel w-full ${wide ? 'max-w-2xl' : 'max-w-md'} shadow-2xl shadow-black/50`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-[12.5px] text-fg-dim">{description}</p>}
          </div>
          <button type="button" className="btn-ghost rounded p-1" onClick={onClose} aria-label="Kapat">
            <XIcon size={16} />
          </button>
        </div>

        <div className="px-5 py-5">{children}</div>

        {footer && (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>
        )}
      </div>
    </div>
  );
}
