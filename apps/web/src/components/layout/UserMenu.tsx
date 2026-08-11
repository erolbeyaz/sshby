import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DatabaseIcon, LogOutIcon, ShieldIcon, UserIcon } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';

export function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const initials = user.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface font-mono text-[11px] font-medium text-fg-dim transition-colors hover:border-fg-dim hover:text-fg"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Hesap menüsü"
      >
        {initials || <UserIcon size={13} aria-hidden="true" />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-50 w-60 overflow-hidden rounded border border-line bg-surface shadow-xl shadow-black/40"
        >
          <div className="border-b border-line px-3.5 py-3">
            <p className="truncate text-[13px] font-medium">{user.displayName}</p>
            <p className="truncate font-mono text-[11.5px] text-fg-dim">{user.email}</p>
            {user.role === 'admin' && (
              <span className="pill mt-2 border-accent/40 text-accent">yönetici</span>
            )}
          </div>

          <div className="p-1">
            {user.role === 'admin' && (
              <Link
                to="/yonetim/kullanicilar"
                role="menuitem"
                className="flex items-center gap-2.5 rounded px-2.5 py-2 text-[13px] text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg"
                onClick={() => setOpen(false)}
              >
                <ShieldIcon size={14} aria-hidden="true" />
                Kullanıcı yönetimi
              </Link>
            )}
            {user.role === 'admin' && (
              <Link
                to="/yonetim/denetim"
                role="menuitem"
                className="flex items-center gap-2.5 rounded px-2.5 py-2 text-[13px] text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg"
                onClick={() => setOpen(false)}
              >
                <DatabaseIcon size={14} aria-hidden="true" />
                Denetim akışı
              </Link>
            )}
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-[13px] text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg"
              onClick={() => void logout()}
            >
              <LogOutIcon size={14} aria-hidden="true" />
              Çıkış yap
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
