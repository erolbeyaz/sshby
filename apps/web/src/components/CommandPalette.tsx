import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownUpIcon, KeyRoundIcon, ServerIcon, ShieldIcon } from 'lucide-react';
import clsx from 'clsx';
import { useInventory } from '@/lib/queries';
import { useAuthStore } from '@/lib/auth-store';
import { useTerminalStore } from '@/lib/terminal-store';
import { useWorkspaceStore } from '@/lib/workspace-store';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

/**
 * Ctrl/Cmd+K komut paleti. Sunucu sayısı arttıkça ağaçta gezinmek yavaşlıyor;
 * klavyeden doğrudan sunucuya atlamak birincil gezinme yolu olacak.
 */
export function CommandPalette() {
  const open = useWorkspaceStore((s) => s.paletteOpen);
  const setOpen = useWorkspaceStore((s) => s.setPaletteOpen);
  const setSelectedHostId = useWorkspaceStore((s) => s.setSelectedHostId);
  const openTab = useTerminalStore((s) => s.openTab);
  const inventory = useInventory();
  const role = useAuthStore((s) => s.user?.role);
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const items: Command[] = [];

    for (const host of inventory.data?.hosts ?? []) {
      items.push({
        id: `host-${host.id}`,
        label: host.name,
        hint: `${host.effectiveUsername ?? '?'}@${host.hostname}:${host.port}`,
        icon: <ServerIcon size={14} />,
        run: () => {
          setSelectedHostId(host.id);
          openTab(host.id, host.name);
          navigate('/');
        },
      });
    }

    items.push({
      id: 'nav-credentials',
      label: 'Kimlik bilgileri',
      hint: 'kasa',
      icon: <KeyRoundIcon size={14} />,
      run: () => navigate('/kasa'),
    });

    items.push({
      id: 'nav-config',
      label: 'Yapılandırma dışa / içe aktarma',
      hint: 'yedek',
      icon: <ArrowDownUpIcon size={14} />,
      run: () => navigate('/yapilandirma'),
    });

    if (role === 'admin') {
      items.push({
        id: 'nav-users',
        label: 'Kullanıcı yönetimi',
        hint: 'yönetim',
        icon: <ShieldIcon size={14} />,
        run: () => navigate('/yonetim/kullanicilar'),
      });
    }

    return items;
  }, [inventory.data, navigate, openTab, role, setSelectedHostId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr');
    if (!needle) return commands.slice(0, 20);
    return commands
      .filter((c) => `${c.label} ${c.hint ?? ''}`.toLocaleLowerCase('tr').includes(needle))
      .slice(0, 20);
  }, [commands, query]);

  if (!open) return null;

  function runAt(index: number) {
    const command = filtered[index];
    if (!command) return;
    command.run();
    setOpen(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="panel w-full max-w-lg overflow-hidden shadow-2xl shadow-black/50">
        <input
          autoFocus
          className="w-full border-b border-line bg-transparent px-4 py-3.5 font-mono text-[13px] text-fg outline-none placeholder:text-fg-dim"
          placeholder="sunucu ara veya bir sayfaya git…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              runAt(activeIndex);
            }
          }}
        />

        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-[13px] text-fg-dim">Sonuç yok.</li>
          )}
          {filtered.map((command, index) => (
            <li key={command.id}>
              <button
                type="button"
                className={clsx(
                  'flex w-full items-center gap-3 rounded px-2.5 py-2 text-left',
                  index === activeIndex ? 'bg-surface-2 text-fg' : 'text-fg-dim hover:bg-surface-2',
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runAt(index)}
              >
                <span className="shrink-0">{command.icon}</span>
                <span className="flex-1 truncate text-[13px]">{command.label}</span>
                {command.hint && (
                  <span className="shrink-0 font-mono text-[11.5px] text-fg-dim">
                    {command.hint}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
