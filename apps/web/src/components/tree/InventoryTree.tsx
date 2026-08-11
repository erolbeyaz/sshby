import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  GaugeIcon,
  HistoryIcon,
  CopyIcon,
  PencilIcon,
  ServerIcon,
  TerminalIcon,
  Trash2Icon,
} from 'lucide-react';
import clsx from 'clsx';
import type { Folder, Host } from '@sshby/shared';
import { hostConnectionState, useTerminalStore } from '@/lib/terminal-store';

/**
 * Klasör/sunucu ağacı.
 *
 * Sürükle-bırak kuralı bilinçli olarak basit ve tahmin edilebilir:
 *   - Bir klasörün üzerine bırak  → o klasörün içine, sona ekle
 *   - Bir sunucunun üzerine bırak → o sunucunun bulunduğu klasöre, onun sırasına
 *   - "Kök seviye" şeridine bırak → klasörsüz hâle getir
 * Kenar bantlarına göre "araya" mı "içine" mi karar veren yaklaşım daha esnek
 * ama isabet alanları küçüldüğü için elle kullanımda sinir bozucu oluyor.
 */

export interface TreeCallbacks {
  /** Tek tıklama: sunucuyu seçer ve ayrıntılarını gösterir. */
  onSelectHost: (host: Host) => void;
  /** Çift tıklama (ya da satırdaki terminal düğmesi): oturum açar. */
  onConnectHost: (host: Host) => void;
  onOpenFiles: (host: Host) => void;
  onCloneHost: (host: Host) => void;
  onOpenMetrics: (host: Host) => void;
  onOpenHistory: (host: Host) => void;
  onEditHost: (host: Host) => void;
  onDeleteHost: (host: Host) => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onMove: (input: {
    kind: 'folder' | 'host';
    id: string;
    targetFolderId: string | null;
    position: number;
  }) => void;
}

interface TreeProps extends TreeCallbacks {
  folders: Folder[];
  hosts: Host[];
  selectedHostId: string | null;
  filter: string;
}

const EXPANDED_STORAGE_KEY = 'sshby.tree.expanded';

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function InventoryTree(props: TreeProps) {
  const { folders, hosts, filter } = props;
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [dragging, setDragging] = useState<{ kind: 'folder' | 'host'; label: string } | null>(null);

  const sensors = useSensors(
    // Küçük hareketlerde tıklama ile sürüklemeyi karıştırmamak için eşik.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function toggle(folderId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  const normalizedFilter = filter.trim().toLocaleLowerCase('tr');

  /**
   * Filtre etkinken eşleşen sunucuların üst klasörleri zorla açılır; aksi hâlde
   * arama sonucu kapalı bir klasörün içinde kalıyor ve "bulunamadı" izlenimi
   * veriyor.
   */
  const { childFolders, folderHosts, matchedFolderIds, visibleHostIds } = useMemo(() => {
    const childFolders = new Map<string | null, Folder[]>();
    const folderHosts = new Map<string | null, Host[]>();

    for (const folder of folders) {
      const list = childFolders.get(folder.parentId) ?? [];
      list.push(folder);
      childFolders.set(folder.parentId, list);
    }
    for (const host of hosts) {
      const list = folderHosts.get(host.folderId) ?? [];
      list.push(host);
      folderHosts.set(host.folderId, list);
    }

    if (!normalizedFilter) {
      return {
        childFolders,
        folderHosts,
        matchedFolderIds: null as Set<string> | null,
        visibleHostIds: null as Set<string> | null,
      };
    }

    const parentOf = new Map(folders.map((f) => [f.id, f.parentId]));
    const visibleHostIds = new Set<string>();
    const matchedFolderIds = new Set<string>();

    for (const host of hosts) {
      const haystack = `${host.name} ${host.hostname} ${host.effectiveUsername ?? ''} ${host.tags.join(' ')}`;
      if (!haystack.toLocaleLowerCase('tr').includes(normalizedFilter)) continue;
      visibleHostIds.add(host.id);
      let cursor = host.folderId;
      while (cursor) {
        matchedFolderIds.add(cursor);
        cursor = parentOf.get(cursor) ?? null;
      }
    }

    return { childFolders, folderHosts, matchedFolderIds, visibleHostIds };
  }, [folders, hosts, normalizedFilter]);

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { kind: 'folder' | 'host'; label: string } | undefined;
    if (data) setDragging(data);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as { kind: 'folder' | 'host' } | undefined;
    const overData = over.data.current as
      | { dropKind: 'folder' | 'host' | 'root'; folderId: string | null; index: number }
      | undefined;
    if (!activeData || !overData) return;
    if (active.id === over.id) return;

    if (overData.dropKind === 'folder') {
      props.onMove({
        kind: activeData.kind,
        id: String(active.id),
        targetFolderId: overData.folderId,
        // Klasörün üzerine bırakma "içine at" demek; sıra sona eklenir.
        position: Number.MAX_SAFE_INTEGER,
      });
      if (overData.folderId && !expanded.has(overData.folderId)) toggle(overData.folderId);
      return;
    }

    props.onMove({
      kind: activeData.kind,
      id: String(active.id),
      targetFolderId: overData.folderId,
      position: overData.index,
    });
  }

  const rootFolders = childFolders.get(null) ?? [];
  const rootHosts = folderHosts.get(null) ?? [];
  const isEmpty = folders.length === 0 && hosts.length === 0;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {isEmpty ? (
          <p className="px-3 py-8 text-center text-[13px] leading-snug text-fg-dim">
            Henüz sunucu yok.
            <br />
            Sağ üstteki <span className="text-fg">+</span> ile başlayın.
          </p>
        ) : (
          <>
            {/* Kök şeridi yalnızca sürükleme sırasında görünür: sürekli durduğunda
                hiçbir işe yaramayan bir başlık gibi duruyordu. */}
            {dragging && <RootDropZone />}
            {rootFolders.map((folder, index) => (
              <FolderNode
                key={folder.id}
                folder={folder}
                index={index}
                depth={0}
                expanded={expanded}
                toggle={toggle}
                childFolders={childFolders}
                folderHosts={folderHosts}
                matchedFolderIds={matchedFolderIds}
                visibleHostIds={visibleHostIds}
                {...props}
              />
            ))}
            {rootHosts.map((host, index) => {
              if (visibleHostIds && !visibleHostIds.has(host.id)) return null;
              return (
                <HostNode key={host.id} host={host} index={index} depth={0} {...props} />
              );
            })}
          </>
        )}
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="flex items-center gap-2 rounded border border-accent/50 bg-surface-2 px-2.5 py-1.5 font-mono text-[12.5px] text-fg shadow-lg">
            {dragging.kind === 'folder' ? <FolderIcon size={13} /> : <ServerIcon size={13} />}
            {dragging.label}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** Öğeyi klasörden çıkarıp köke almak için üstteki ince şerit. */
function RootDropZone() {
  const { setNodeRef, isOver } = useDroppable({
    id: '__root__',
    data: { dropKind: 'root', folderId: null, index: Number.MAX_SAFE_INTEGER },
  });

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        'mb-1 rounded border border-dashed px-2.5 py-1 text-center font-mono text-[10.5px] uppercase tracking-[0.14em] transition-colors',
        isOver ? 'border-accent/60 text-accent' : 'border-line text-fg-dim/60',
      )}
    >
      kök seviyeye taşı
    </div>
  );
}

interface FolderNodeProps extends TreeCallbacks {
  folder: Folder;
  index: number;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  childFolders: Map<string | null, Folder[]>;
  folderHosts: Map<string | null, Host[]>;
  matchedFolderIds: Set<string> | null;
  visibleHostIds: Set<string> | null;
  selectedHostId: string | null;
}

function FolderNode(props: FolderNodeProps) {
  const { folder, index, depth, expanded, toggle, childFolders, folderHosts } = props;
  const { matchedFolderIds, visibleHostIds } = props;

  // Kancalar koşulsuz çağrılmalı; gizleme kararı aşağıda, render sırasında veriliyor.
  const draggable = useDraggable({
    id: folder.id,
    data: { kind: 'folder', label: folder.name },
  });
  const droppable = useDroppable({
    id: `folder-${folder.id}`,
    data: { dropKind: 'folder', folderId: folder.id, index },
  });

  // Filtre varken eşleşmeyen dalları hiç çizme.
  if (matchedFolderIds && !matchedFolderIds.has(folder.id)) return null;

  const isOpen = matchedFolderIds ? true : expanded.has(folder.id);
  const subFolders = childFolders.get(folder.id) ?? [];
  const subHosts = folderHosts.get(folder.id) ?? [];

  return (
    <div>
      <div
        ref={droppable.setNodeRef}
        className={clsx(
          'group flex items-center gap-1.5 rounded px-1.5 py-1 transition-colors',
          droppable.isOver ? 'bg-accent-muted ring-1 ring-accent/50' : 'hover:bg-surface-2',
          draggable.isDragging && 'opacity-40',
        )}
        style={{ paddingLeft: depth * 12 + 6 }}
      >
        <button
          type="button"
          className="shrink-0 text-fg-dim transition-transform hover:text-fg"
          onClick={() => toggle(folder.id)}
          aria-label={isOpen ? 'Klasörü kapat' : 'Klasörü aç'}
          aria-expanded={isOpen}
        >
          <ChevronRightIcon
            size={13}
            className={clsx('transition-transform', isOpen && 'rotate-90')}
          />
        </button>

        <button
          type="button"
          ref={draggable.setNodeRef}
          {...draggable.listeners}
          {...draggable.attributes}
          className="flex min-w-0 flex-1 cursor-grab items-center gap-2 text-left active:cursor-grabbing"
          onClick={() => toggle(folder.id)}
        >
          {isOpen ? (
            <FolderOpenIcon size={13} style={{ color: folder.color ?? undefined }} />
          ) : (
            <FolderIcon size={13} style={{ color: folder.color ?? undefined }} />
          )}
          <span className="truncate text-[13px]">{folder.name}</span>
        </button>

        <RowActions
          onEdit={() => props.onEditFolder(folder)}
          onDelete={() => props.onDeleteFolder(folder)}
        />
      </div>

      {isOpen && (
        <div>
          {subFolders.map((child, childIndex) => (
            <FolderNode key={child.id} {...props} folder={child} index={childIndex} depth={depth + 1} />
          ))}
          {subHosts.map((host, hostIndex) => {
            if (visibleHostIds && !visibleHostIds.has(host.id)) return null;
            return (
              <HostNode
                key={host.id}
                host={host}
                index={hostIndex}
                depth={depth + 1}
                selectedHostId={props.selectedHostId}
                onSelectHost={props.onSelectHost}
                onConnectHost={props.onConnectHost}
                onOpenFiles={props.onOpenFiles}
                onCloneHost={props.onCloneHost}
                onOpenMetrics={props.onOpenMetrics}
                onOpenHistory={props.onOpenHistory}
                onEditHost={props.onEditHost}
                onDeleteHost={props.onDeleteHost}
                onEditFolder={props.onEditFolder}
                onDeleteFolder={props.onDeleteFolder}
                onMove={props.onMove}
              />
            );
          })}
          {subFolders.length === 0 && subHosts.length === 0 && (
            <p
              className="py-1 text-[11.5px] text-fg-dim/60"
              style={{ paddingLeft: (depth + 1) * 12 + 26 }}
            >
              boş
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface HostNodeProps extends TreeCallbacks {
  host: Host;
  index: number;
  depth: number;
  selectedHostId: string | null;
}

/** Bağlantı durumu → nokta rengi ve okunabilir etiket. */
const CONNECTION_DOT = {
  connected: { className: 'bg-accent', label: 'bağlı' },
  connecting: { className: 'bg-warn animate-pulse', label: 'bağlanıyor' },
  disconnected: { className: 'bg-danger', label: 'bağlı değil' },
} as const;

function HostNode({ host, index, depth, selectedHostId, ...callbacks }: HostNodeProps) {
  const draggable = useDraggable({ id: host.id, data: { kind: 'host', label: host.name } });
  const droppable = useDroppable({
    id: `host-${host.id}`,
    data: { dropKind: 'host', folderId: host.folderId, index },
  });

  // Sekmelerin tamamına abone oluyoruz; envanter küçük olduğu için bu maliyet
  // önemsiz ve durum değiştiğinde ağaç kendiliğinden güncelleniyor.
  const connection = useTerminalStore((s) => hostConnectionState(s.tabs, host.id));
  const dot = CONNECTION_DOT[connection];

  const selected = selectedHostId === host.id;

  return (
    <div
      ref={droppable.setNodeRef}
      className={clsx(
        'group rounded py-1 pr-1.5 transition-colors',
        selected ? 'bg-surface-2' : 'hover:bg-surface-2',
        droppable.isOver && 'ring-1 ring-accent/50',
        draggable.isDragging && 'opacity-40',
      )}
      style={{ paddingLeft: depth * 12 + 26 }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          ref={draggable.setNodeRef}
          {...draggable.listeners}
          {...draggable.attributes}
          className="flex min-w-0 flex-1 cursor-grab items-center gap-2 text-left active:cursor-grabbing"
          onClick={() => callbacks.onSelectHost(host)}
          // Dosya yöneticilerindeki alışkanlık: tek tık seçer, çift tık açar.
          onDoubleClick={() => callbacks.onConnectHost(host)}
          title={`${host.effectiveUsername ?? '?'}@${host.hostname}:${host.port} — ${dot.label}`}
        >
          <span
            className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', dot.className)}
            // Renk tek başına bilgi taşımamalı; ekran okuyucu da durumu duysun.
            role="img"
            aria-label={dot.label}
          />
          <span
            className={clsx(
              'truncate font-mono text-[12.5px]',
              selected ? 'text-fg' : 'text-fg-dim group-hover:text-fg',
            )}
          >
            {host.name}
          </span>
        </button>
      </div>

      {/*
        Eylem simgeleri adın ALTINDA, yanında değil.
        Yanındayken uzun sunucu adlarını kısaltıyorlardı; alta alınca ad tüm
        genişliği kullanabiliyor. Her zaman görünürler — gizleyip hover'da
        açmak satır yüksekliğini oynatıyor ve tıklamayı zorlaştırıyordu.
      */}
      <div className="mt-0.5 flex items-center gap-0.5 pl-3.5">
        <HostAction
          icon={<TerminalIcon size={11} />}
          label={`${host.name} için terminal aç`}
          hint="Terminal"
          onClick={() => callbacks.onConnectHost(host)}
        />
        {/* Dosyalar terminalden bağımsız açılabilir: SFTP kendi bağlantısını
            kurabiliyor, terminal şartı yok. */}
        <HostAction
          icon={<FolderOpenIcon size={11} />}
          label={`${host.name} dosyalarını aç`}
          hint="Dosyalar"
          onClick={() => callbacks.onOpenFiles(host)}
        />
        <HostAction
          icon={<GaugeIcon size={11} />}
          label={`${host.name} metriklerini aç`}
          hint="Metrikler"
          onClick={() => callbacks.onOpenMetrics(host)}
        />
        <HostAction
          icon={<HistoryIcon size={11} />}
          label={`${host.name} komut geçmişini aç`}
          hint="Geçmiş"
          onClick={() => callbacks.onOpenHistory(host)}
        />
        <span className="mx-0.5 h-3 w-px bg-line" aria-hidden="true" />
        <HostAction
          icon={<PencilIcon size={11} />}
          label={`${host.name} düzenle`}
          hint="Düzenle"
          onClick={() => callbacks.onEditHost(host)}
        />
        <HostAction
          icon={<CopyIcon size={11} />}
          label={`${host.name} kopyala`}
          hint="Kopyala"
          onClick={() => callbacks.onCloneHost(host)}
        />
        <HostAction
          icon={<Trash2Icon size={11} />}
          label={`${host.name} sil`}
          hint="Sil"
          danger
          onClick={() => callbacks.onDeleteHost(host)}
        />
      </div>
    </div>
  );
}

function HostAction({
  icon,
  label,
  hint,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx(
        'rounded p-1 text-fg-dim/70 transition-colors hover:bg-line',
        danger ? 'hover:text-danger' : 'hover:text-accent',
      )}
      onClick={onClick}
      aria-label={label}
      title={hint}
    >
      {icon}
    </button>
  );
}
function RowActions({
  onEdit,
  onDelete,
  extra,
}: {
  onEdit: () => void;
  onDelete: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      {extra}
      <button
        type="button"
        className="rounded p-1 text-fg-dim hover:bg-line hover:text-fg"
        onClick={onEdit}
        aria-label="Düzenle"
      >
        <PencilIcon size={12} />
      </button>
      <button
        type="button"
        className="rounded p-1 text-fg-dim hover:bg-line hover:text-danger"
        onClick={onDelete}
        aria-label="Sil"
      >
        <Trash2Icon size={12} />
      </button>
    </span>
  );
}
