import { ChevronRightIcon, FolderIcon, FolderOpenIcon, LoaderIcon } from 'lucide-react';
import clsx from 'clsx';
import { useSftpList } from '@/lib/sftp-queries';

/**
 * Soldaki dizin ağacı.
 *
 * Her düğüm kendi içeriğini yalnızca AÇILDIĞINDA istiyor. Ağacın tamamını
 * önden yüklemek uzak bir dosya sisteminde saatler sürebilir; tembel yükleme
 * burada tercih değil, zorunluluk.
 */
export function DirectoryTree({
  hostId,
  sudo,
  currentPath,
  expanded,
  onToggle,
  onSelect,
}: {
  hostId: string;
  sudo: boolean;
  currentPath: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto py-1">
      <TreeNode
        hostId={hostId}
        sudo={sudo}
        path="/"
        label="/"
        depth={0}
        currentPath={currentPath}
        expanded={expanded}
        onToggle={onToggle}
        onSelect={onSelect}
      />
    </div>
  );
}

function TreeNode({
  hostId,
  sudo,
  path,
  label,
  depth,
  currentPath,
  expanded,
  onToggle,
  onSelect,
}: {
  hostId: string;
  sudo: boolean;
  path: string;
  label: string;
  depth: number;
  currentPath: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isOpen = expanded.has(path);
  // `enabled` kapalıyken sorgu hiç çalışmaz — kapalı dalları getirmiyoruz.
  const listing = useSftpList(isOpen ? hostId : null, path, sudo);

  const directories = (listing.data?.entries ?? []).filter(
    (entry) => entry.type === 'directory' || entry.linkTargetType === 'directory',
  );
  const selected = currentPath === path;

  return (
    <div>
      <div
        className={clsx(
          'flex items-center gap-1 rounded-sm py-[3px] pr-2 transition-colors',
          selected ? 'bg-surface-2 text-fg' : 'text-fg-dim hover:bg-surface-2/60',
        )}
        style={{ paddingLeft: depth * 12 + 6 }}
      >
        <button
          type="button"
          className="shrink-0 rounded p-0.5 hover:text-fg"
          onClick={() => onToggle(path)}
          aria-label={isOpen ? 'Kapat' : 'Aç'}
          aria-expanded={isOpen}
        >
          <ChevronRightIcon
            size={12}
            className={clsx('transition-transform duration-150', isOpen && 'rotate-90')}
          />
        </button>

        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => {
            onSelect(path);
            if (!isOpen) onToggle(path);
          }}
        >
          {isOpen ? (
            <FolderOpenIcon size={12} className="shrink-0 text-accent" aria-hidden="true" />
          ) : (
            <FolderIcon size={12} className="shrink-0 text-accent/70" aria-hidden="true" />
          )}
          <span className="truncate font-mono text-[11.5px]">{label}</span>
        </button>

        {isOpen && listing.isFetching && (
          <LoaderIcon size={10} className="shrink-0 animate-spin text-fg-dim" aria-hidden="true" />
        )}
      </div>

      {isOpen && (
        <div>
          {listing.isError && (
            <p
              className="py-0.5 font-mono text-[10.5px] text-danger/80"
              style={{ paddingLeft: (depth + 1) * 12 + 20 }}
            >
              erişilemedi
            </p>
          )}
          {listing.data && directories.length === 0 && !listing.isFetching && (
            <p
              className="py-0.5 font-mono text-[10.5px] text-fg-dim/50"
              style={{ paddingLeft: (depth + 1) * 12 + 20 }}
            >
              alt dizin yok
            </p>
          )}
          {directories.map((entry) => (
            <TreeNode
              key={entry.path}
              hostId={hostId}
              sudo={sudo}
              path={entry.path}
              label={entry.name}
              depth={depth + 1}
              currentPath={currentPath}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
