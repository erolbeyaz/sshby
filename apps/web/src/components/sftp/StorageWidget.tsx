import { useEffect, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, HardDriveIcon } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import type { StorageMount } from '@sshby/shared';
import { apiFetch } from '@/lib/api';
import { useT } from '@/lib/i18n';

function compact(bytes: number): string {
  const units = ['B', 'K', 'M', 'G', 'T'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)}${units[unit]}`;
}

/** Doluluk arttıkça renk sertleşir — %90 üstü göz ucuyla fark edilmeli. */
function usageColor(percent: number): string {
  if (percent >= 90) return 'bg-danger';
  if (percent >= 75) return 'bg-warn';
  return 'bg-accent';
}

/**
 * Bağlama noktalarının doluluk göstergesi.
 *
 * Bulunulan dizini içeren en uzun eşleşen bağlama noktası seçili gösterilir:
 * `/data/minio1` içindeyken `/` değil, gerçekten üzerinde bulunduğunuz disk
 * anlamlı olan.
 */
export function StorageWidget({
  hostId,
  currentPath,
  onSelect,
}: {
  hostId: string;
  currentPath: string | null;
  onSelect: (mount: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const storage = useQuery({
    queryKey: ['sftp-storage', hostId],
    queryFn: () => apiFetch<StorageMount[]>(`/sftp/${hostId}/storage`),
    // Disk doluluğu hızlı değişmez; sık sormak sunucuyu boşuna meşgul eder.
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const mounts = storage.data ?? [];
  if (mounts.length === 0) return null;

  const active =
    mounts
      .filter((m) => currentPath?.startsWith(m.mount))
      .sort((a, b) => b.mount.length - a.mount.length)[0] ?? mounts[0]!;

  return (
    <div ref={ref} className="relative shrink-0 border-t border-line px-3 py-2">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <HardDriveIcon size={11} className="shrink-0 text-fg-dim" aria-hidden="true" />
        <span className="font-mono text-[11px] text-fg-dim">{active.mount}</span>
        <ChevronDownIcon
          size={11}
          className={clsx('shrink-0 text-fg-dim transition-transform', open && 'rotate-180')}
        />
        <span className="flex-1" />
        <span
          className={clsx(
            'font-mono text-[11px] font-medium',
            active.percent >= 90
              ? 'text-danger'
              : active.percent >= 75
                ? 'text-warn'
                : 'text-accent',
          )}
        >
          {t('storage.usedPercent', { n: active.percent })}
        </span>
      </button>

      <div className="mt-1.5 h-1 overflow-hidden rounded bg-surface-2">
        <div
          className={clsx('h-full transition-all', usageColor(active.percent))}
          style={{ width: `${active.percent}%` }}
        />
      </div>
      <p className="mt-1 font-mono text-[10.5px] text-fg-dim">
        {t('storage.usedOf', {
          used: compact(active.usedBytes),
          total: compact(active.totalBytes),
        })}
      </p>

      {open && (
        <div className="absolute bottom-full left-2 right-2 z-20 mb-1 overflow-hidden rounded border border-line bg-surface py-1 shadow-xl shadow-black/50">
          {mounts.map((mount) => (
            <button
              key={mount.mount}
              type="button"
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-2"
              onClick={() => {
                onSelect(mount.mount);
                setOpen(false);
              }}
            >
              <span className="w-3 shrink-0">
                {mount.mount === active.mount && (
                  <CheckIcon size={11} className="text-accent" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{mount.mount}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-fg-dim">
                {compact(mount.usedBytes)}/{compact(mount.totalBytes)}
              </span>
              <span
                className={clsx(
                  'w-9 shrink-0 text-right font-mono text-[10.5px]',
                  mount.percent >= 90
                    ? 'text-danger'
                    : mount.percent >= 75
                      ? 'text-warn'
                      : 'text-fg-dim',
                )}
              >
                %{mount.percent}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
