import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@/lib/i18n';
import { useTerminalStore } from '@/lib/terminal-store';
import { Signature } from './Signature';

/**
 * Alt durum çubuğu. Denetim indeksi mor renkte ve kalıcı olarak görünür —
 * marka panosundaki kural bunu bir tasarım gereği olarak tanımlıyor.
 */
export function StatusBar({ auditIndex }: { auditIndex: string | null }) {
  const t = useT();
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const active = tabs.find((t) => t.id === activeTabId) ?? null;

  const duration = useElapsed(active?.state === 'ready' ? active.openedAt : null);

  const label = active
    ? {
        connecting: t('status.connecting', { name: active.title }),
        ready: t('status.connected', { name: active.title }),
        closed: t('status.closed', { name: active.title }),
        error: t('status.error', { name: active.title }),
      }[active.state]
    : t('status.noConnection');

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
      {duration && <span>{t('status.session', { duration })}</span>}
      {tabs.length > 1 && <span>{t('status.openSessions', { n: tabs.length })}</span>}
      <div className="flex-1" />
      <Signature />
      <span className={auditIndex ? 'text-trace' : undefined}>
        {auditIndex ? t('status.trace', { index: auditIndex }) : t('status.traceOff')}
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
