import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderPlusIcon, SearchIcon, ServerIcon, XIcon } from 'lucide-react';
import type { Folder, Host } from '@sshby/shared';
import { FolderDialog } from '@/components/dialogs/FolderDialog';
import { HostDialog } from '@/components/dialogs/HostDialog';
import { InventoryTree } from '@/components/tree/InventoryTree';
import { Modal } from '@/components/ui/Modal';
import { useT } from '@/lib/i18n';
import {
  useCloneHost,
  useDeleteFolder,
  useDeleteHost,
  useInventory,
  useMoveNode,
  useUpdateHost,
} from '@/lib/queries';
import { useTerminalStore } from '@/lib/terminal-store';
import { useWorkspaceStore } from '@/lib/workspace-store';

type Dialog =
  | { kind: 'host'; host: Host | null }
  /** `parent` = yeni klasörün altına gireceği klasör; alt klasör oluşturma. */
  | { kind: 'folder'; folder: Folder | null; parent: Folder | null }
  | { kind: 'delete-host'; host: Host }
  | { kind: 'delete-folder'; folder: Folder }
  | null;

/**
 * Sunucu ağacı paneli. Dış kabuk (başlık, genişlik, kapatma) `SidePanel`
 * içinde; burada yalnızca içerik var.
 */
export function HostsPanel() {
  const t = useT();
  const inventory = useInventory();
  const moveNode = useMoveNode();
  const deleteHost = useDeleteHost();
  const deleteFolder = useDeleteFolder();
  const cloneHost = useCloneHost();
  const updateHost = useUpdateHost();

  const filter = useWorkspaceStore((s) => s.filter);
  const setFilter = useWorkspaceStore((s) => s.setFilter);
  const selectedHostId = useWorkspaceStore((s) => s.selectedHostId);
  const setSelectedHostId = useWorkspaceStore((s) => s.setSelectedHostId);
  const openTab = useTerminalStore((s) => s.openTab);
  const openFileTab = useTerminalStore((s) => s.openFileTab);
  const openMetricTab = useTerminalStore((s) => s.openMetricTab);
  const openHistoryTab = useTerminalStore((s) => s.openHistoryTab);
  const navigate = useNavigate();

  const [dialog, setDialog] = useState<Dialog>(null);

  const folders = inventory.data?.folders ?? [];
  const hosts = inventory.data?.hosts ?? [];

  return (
    <>
      <div className="flex items-center gap-1 px-2 pb-1 pt-2">
        <div className="relative flex-1">
          <SearchIcon
            size={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-dim"
            aria-hidden="true"
          />
          <input
            className="input py-1.5 pl-7 pr-7 font-mono text-[12px]"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('sidebar.filter')}
            aria-label={t('sidebar.filterAria')}
          />
          {filter && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-dim hover:text-fg"
              onClick={() => setFilter('')}
              aria-label={t('sidebar.clearFilter')}
            >
              <XIcon size={13} />
            </button>
          )}
        </div>
        <button
          type="button"
          className="btn-ghost shrink-0 rounded p-1.5"
          onClick={() => setDialog({ kind: 'folder', folder: null, parent: null })}
          aria-label={t('sidebar.addFolder')}
          title={t('sidebar.addFolder')}
        >
          <FolderPlusIcon size={14} />
        </button>
        <button
          type="button"
          className="btn-ghost shrink-0 rounded p-1.5"
          onClick={() => setDialog({ kind: 'host', host: null })}
          aria-label={t('sidebar.addHost')}
          title={t('sidebar.addHost')}
        >
          <ServerIcon size={14} />
        </button>
      </div>

      <InventoryTree
        folders={folders}
        hosts={hosts}
        filter={filter}
        selectedHostId={selectedHostId}
        onSelectHost={(host) => {
          setSelectedHostId(host.id);
          navigate(`/server/${host.id}`);
        }}
        onConnectHost={(host) => {
          setSelectedHostId(host.id);
          openTab(host.id, host.name);
          navigate('/');
        }}
        onCloneHost={(host) => cloneHost.mutate(host.id)}
        onTogglePin={(host) => updateHost.mutate({ id: host.id, pinned: !host.pinned })}
        onOpenHistory={(host) => {
          setSelectedHostId(host.id);
          openHistoryTab(host.id, host.name);
          navigate('/');
        }}
        onOpenMetrics={(host) => {
          setSelectedHostId(host.id);
          openMetricTab(host.id, host.name);
          navigate('/');
        }}
        onOpenFiles={(host) => {
          setSelectedHostId(host.id);
          openFileTab(host.id, host.name);
          navigate('/');
        }}
        onEditHost={(host) => setDialog({ kind: 'host', host })}
        onDeleteHost={(host) => setDialog({ kind: 'delete-host', host })}
        onEditFolder={(folder) => setDialog({ kind: 'folder', folder, parent: null })}
        onAddSubfolder={(folder) => setDialog({ kind: 'folder', folder: null, parent: folder })}
        onDeleteFolder={(folder) => setDialog({ kind: 'delete-folder', folder })}
        onMove={(input) => moveNode.mutate(input)}
      />

      <div className="border-t border-line px-3 py-2 font-mono text-[11.5px] text-fg-dim">
        {t('sidebar.summary', { hosts: hosts.length, folders: folders.length })}
      </div>

      {dialog?.kind === 'host' && (
        <HostDialog
          host={dialog.host}
          folders={folders}
          defaultFolderId={null}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'folder' && (
        <FolderDialog
          folder={dialog.folder}
          folders={folders}
          parentId={dialog.parent?.id ?? dialog.folder?.parentId ?? null}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'delete-host' && (
        <ConfirmDelete
          title={t('sidebar.deleteHostTitle')}
          body={
            <>
              <strong className="font-medium">{dialog.host.name}</strong>{' '}
              {t('sidebar.deleteHostBody')}
            </>
          }
          busy={deleteHost.isPending}
          onConfirm={async () => {
            await deleteHost.mutateAsync(dialog.host.id);
            if (selectedHostId === dialog.host.id) setSelectedHostId(null);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'delete-folder' && (
        <ConfirmDelete
          title={t('sidebar.deleteFolderTitle')}
          body={
            <>
              <strong className="font-medium">{dialog.folder.name}</strong>{' '}
              {t('sidebar.deleteFolderBody')}
            </>
          }
          busy={deleteFolder.isPending}
          onConfirm={async () => {
            await deleteFolder.mutateAsync(dialog.folder.id);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

function ConfirmDelete({
  title,
  body,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  body: React.ReactNode;
  busy: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn border-danger/50 text-danger hover:bg-danger/10"
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {t('common.delete')}
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed">{body}</p>
    </Modal>
  );
}
