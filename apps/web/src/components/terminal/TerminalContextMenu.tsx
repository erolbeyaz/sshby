import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ClipboardPasteIcon, CopyIcon, EraserIcon, TextSelectIcon } from 'lucide-react';
import clsx from 'clsx';

interface MenuProps {
  x: number;
  y: number;
  hasSelection: boolean;
  onClose: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}

/** Terminalde sağ tık menüsü. */
export function TerminalContextMenu({
  x,
  y,
  hasSelection,
  onClose,
  onCopy,
  onPaste,
  onSelectAll,
  onClear,
}: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  // Menü ekranın dışına taşmasın: ölçüp gerekiyorsa içeri al.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPosition({
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    // `capture`: terminal kendi tıklama işleyicisini çalıştırmadan önce kapansın.
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  function run(action: () => void) {
    action();
    onClose();
  }

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-40 min-w-[196px] overflow-hidden rounded border border-line bg-surface py-1 shadow-xl shadow-black/50"
      style={{ left: position.x, top: position.y }}
      /**
       * Menüye tıklamak odağı terminalden almamalı.
       *
       * Varsayılan davranışta düğme odağı alıyordu; menü kapandıktan sonra
       * klavye hiçbir yere gitmiyor, kullanıcı yapıştırdığı komutu
       * çalıştırmak için önce terminale yeniden tıklamak zorunda kalıyordu.
       * mousedown'ın varsayılanını engellemek odağın hiç kaymamasını sağlar;
       * tıklama olayı yine de çalışır.
       */
      onMouseDown={(event) => event.preventDefault()}
    >
      <Item
        icon={<CopyIcon size={13} />}
        label="Kopyala"
        shortcut="Ctrl+C"
        disabled={!hasSelection}
        onClick={() => run(onCopy)}
      />
      <Item
        icon={<ClipboardPasteIcon size={13} />}
        label="Yapıştır"
        shortcut="Ctrl+V"
        onClick={() => run(onPaste)}
      />
      <div className="my-1 border-t border-line" />
      <Item
        icon={<TextSelectIcon size={13} />}
        label="Tümünü seç"
        onClick={() => run(onSelectAll)}
      />
      <Item
        icon={<EraserIcon size={13} />}
        label="Ekranı temizle"
        onClick={() => run(onClear)}
      />
    </div>
  );
}

function Item({
  icon,
  label,
  shortcut,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors',
        disabled
          ? 'cursor-default text-fg-dim/40'
          : 'text-fg-dim hover:bg-surface-2 hover:text-fg',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <span className="shrink-0 font-mono text-[11px] text-fg-dim/60">{shortcut}</span>}
    </button>
  );
}
