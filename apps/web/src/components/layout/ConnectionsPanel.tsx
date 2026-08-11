import { useEffect, useMemo, useState } from 'react';
import { ChevronLeftIcon, FolderIcon, SearchIcon, TerminalIcon, XIcon } from 'lucide-react';
import clsx from 'clsx';
import { useTerminalStore, type SessionState } from '@/lib/terminal-store';

const STATE_COLOR: Record<SessionState, string> = {
  connecting: 'bg-warn animate-pulse',
  ready: 'bg-accent',
  closed: 'bg-[#4A4A4A]',
  error: 'bg-danger',
};

const STATE_LABEL: Record<SessionState, string> = {
  connecting: 'Bağlanıyor',
  ready: 'Bağlı',
  closed: 'Kapandı',
  error: 'Hata',
};

function formatDuration(since: number): string {
  const total = Math.floor((Date.now() - since) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}sa ${minutes % 60}dk süredir bağlı`;
  }
  if (minutes > 0) return `${minutes}dk ${seconds}sn süredir bağlı`;
  return `${seconds}sn süredir bağlı`;
}

interface Connection {
  id: string;
  hostId: string;
  title: string;
  kind: 'SSH' | 'Dosyalar';
  state: SessionState;
  openedAt: number;
  /** Terminal sekmesine ait olanlar tıklanınca o sekmeye geçer. */
  tabId: string | null;
}

/**
 * Açık bağlantıların panelin tamamını kaplayan listesi.
 *
 * Kaynak istemci durumu: her terminal sekmesi bir SSH bağlantısı, açık dosya
 * paneli de bağlı olduğu sunucu için ayrı bir "Dosyalar" bağlantısı. Sunucu
 * tarafındaki oturum kaydını sormak yerine buradan türetiyoruz; kullanıcının
 * görmek istediği kendi penceresindeki durum.
 */
export function ConnectionsPanel({ onClose }: { onClose: () => void }) {
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const setActive = useTerminalStore((s) => s.setActive);
  const closeTab = useTerminalStore((s) => s.closeTab);
  const fileTabs = useTerminalStore((s) => s.fileTabs);
  const activeFileTabId = useTerminalStore((s) => s.activeFileTabId);
  const setActiveFileTab = useTerminalStore((s) => s.setActiveFileTab);
  const closeFileTab = useTerminalStore((s) => s.closeFileTab);
  const [query, setQuery] = useState('');

  // Süre metinleri canlı kalsın.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (tabs.length === 0) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [tabs.length]);

  const connections = useMemo<Connection[]>(() => {
    const items: Connection[] = tabs.map((tab) => ({
      id: `ssh-${tab.id}`,
      hostId: tab.hostId,
      title: tab.title,
      kind: 'SSH',
      state: tab.state,
      openedAt: tab.openedAt,
      tabId: tab.id,
    }));

    // Her açık dosya paneli ayrı bir bağlantı olarak listeleniyor.
    for (const fileTab of fileTabs) {
      items.push({
        id: `files-${fileTab.id}`,
        hostId: fileTab.hostId,
        title: fileTab.title,
        kind: 'Dosyalar',
        state: 'ready',
        openedAt: 0,
        tabId: fileTab.id,
      });
    }
    return items;
  }, [tabs, fileTabs]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr');
    return needle
      ? connections.filter((c) => c.title.toLocaleLowerCase('tr').includes(needle))
      : connections;
  }, [connections, query]);

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3.5">
        <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Bağlantılar</h2>
        <button
          type="button"
          className="btn-ghost rounded p-1.5"
          onClick={onClose}
          aria-label="Bağlantılar panelini kapat"
        >
          <ChevronLeftIcon size={15} />
        </button>
      </div>

      <div className="relative shrink-0 px-3 py-2.5">
        <SearchIcon
          size={13}
          className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-fg-dim"
          aria-hidden="true"
        />
        <input
          className="input py-1.5 pl-7 pr-2 text-[12.5px]"
          placeholder="Bağlantıları ara…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Bağlantılarda ara"
        />
      </div>

      <div className="flex shrink-0 items-center gap-2 px-3.5 pb-1.5">
        <span className="eyebrow flex-1">Açık</span>
        <span className="pill">{filtered.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {filtered.length === 0 && (
          <p className="px-3.5 py-6 text-center text-[12.5px] text-fg-dim">
            {query ? 'Eşleşen bağlantı yok.' : 'Açık bağlantı yok.'}
          </p>
        )}

        {filtered.map((connection) => {
          const highlighted =
            connection.kind === 'SSH'
              ? connection.tabId === activeTabId
              : connection.tabId === activeFileTabId;
          return (
            <div
              key={connection.id}
              className={clsx(
                'group flex items-center gap-2.5 border-l-2 px-3 py-2 transition-colors',
                highlighted
                  ? 'border-accent bg-surface-2'
                  : 'border-transparent hover:bg-surface-2/60',
              )}
            >
              <span
                className={clsx(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line',
                  highlighted ? 'text-accent' : 'text-fg-dim',
                )}
                aria-hidden="true"
              >
                {connection.kind === 'SSH' ? (
                  <TerminalIcon size={13} />
                ) : (
                  <FolderIcon size={13} />
                )}
              </span>

              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  if (!connection.tabId) return;
                  if (connection.kind === 'SSH') setActive(connection.tabId);
                  else setActiveFileTab(connection.tabId);
                }}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={clsx(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      STATE_COLOR[connection.state],
                    )}
                    aria-hidden="true"
                  />
                  <span
                    className={clsx(
                      'min-w-0 flex-1 truncate font-mono text-[12.5px]',
                      highlighted ? 'text-accent' : 'text-fg',
                    )}
                  >
                    {connection.title}
                  </span>
                  <span className="pill shrink-0">{connection.kind}</span>
                </span>
                <span className="mt-0.5 block truncate font-mono text-[10.5px] text-fg-dim">
                  {connection.kind === 'Dosyalar'
                    ? 'Bağlı'
                    : connection.state === 'ready'
                      ? formatDuration(connection.openedAt)
                      : STATE_LABEL[connection.state]}
                </span>
              </button>

              <button
                type="button"
                className="shrink-0 rounded p-1 text-fg-dim opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => {
                  if (!connection.tabId) return;
                  if (connection.kind === 'SSH') closeTab(connection.tabId);
                  else closeFileTab(connection.tabId);
                }}
                aria-label={`${connection.title} bağlantısını kapat`}
              >
                <XIcon size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
