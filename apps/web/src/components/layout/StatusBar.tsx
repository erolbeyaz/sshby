import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useTerminalStore } from '@/lib/terminal-store';

/**
 * Alt durum çubuğu. Denetim indeksi mor renkte ve kalıcı olarak görünür —
 * marka panosundaki kural bunu bir tasarım gereği olarak tanımlıyor.
 */
export function StatusBar({ auditIndex }: { auditIndex: string | null }) {
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const active = tabs.find((t) => t.id === activeTabId) ?? null;

  const duration = useElapsed(active?.state === 'ready' ? active.openedAt : null);

  const label = active
    ? {
        connecting: `SSH · ${active.title} · bağlanıyor…`,
        ready: `SSH · ${active.title} · bağlı`,
        closed: `SSH · ${active.title} · kapandı`,
        error: `SSH · ${active.title} · hata`,
      }[active.state]
    : 'SSH · bağlantı yok';

  return (
    <footer className="flex h-8 shrink-0 items-center gap-5 border-t border-line bg-surface-2 px-4 font-mono text-[11px] text-fg-dim">
      <span
        className={clsx(
          active?.state === 'ready' && 'text-accent',
          active?.state === 'error' && 'text-danger',
        )}
      >
        {label}
      </span>
      {duration && <span>oturum {duration}</span>}
      {tabs.length > 1 && <span>{tabs.length} oturum açık</span>}
      <div className="flex-1" />
      <span className={auditIndex ? 'text-trace' : undefined}>
        {auditIndex ? `iz: ${auditIndex}` : 'iz: yapılandırılmadı'}
      </span>
    </footer>
  );
}

/** Oturum süresi sayacı. `since` null olduğunda sayaç durur ve gizlenir. */
function useElapsed(since: number | null): string | null {
  const [, force] = useState(0);

  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [since]);

  if (since === null) return null;

  const total = Math.floor((Date.now() - since) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
