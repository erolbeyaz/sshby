import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  Link2Icon,
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import clsx from 'clsx';
import type { SftpEntry } from '@sshby/shared';
import { Modal } from '@/components/ui/Modal';
import { ApiRequestError } from '@/lib/api';
import { localeTag, useApiError, useI18n, useT, type TranslationKey } from '@/lib/i18n';
import {
  disableSudo,
  downloadFile,
  enableSudo,
  uploadFile,
  useChmod,
  useDeleteEntry,
  useMkdir,
  useRename,
  useSftpList,
} from '@/lib/sftp-queries';
import { useQueryClient } from '@tanstack/react-query';
import { DirectoryTree } from './DirectoryTree';
import { StorageWidget } from './StorageWidget';
import { SudoPrompt } from './SudoPrompt';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(seconds: number, locale: string): string {
  if (!seconds) return '—';
  return new Date(seconds * 1000).toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "0755" → "drwxr-xr-x" — izinleri alışılmış biçimde göstermek için. */
function formatMode(mode: string, isDir: boolean): string {
  const digits = mode.replace(/^0/, '').padStart(3, '0');
  const map = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  return (
    (isDir ? 'd' : '-') +
    digits
      .split('')
      .map((d) => map[Number(d)] ?? '---')
      .join('')
  );
}

const isDirectory = (entry: SftpEntry) =>
  entry.type === 'directory' || entry.linkTargetType === 'directory';

type Dialog =
  | { kind: 'mkdir' }
  | { kind: 'rename'; entry: SftpEntry }
  | { kind: 'chmod'; entry: SftpEntry }
  | { kind: 'delete'; entry: SftpEntry }
  | null;

export function FileManager({
  hostId,
  hostName,
  onClose,
}: {
  hostId: string;
  hostName: string;
  onClose: () => void;
}) {
  const { lang, t } = useI18n();
  const apiError = useApiError();
  const [path, setPath] = useState<string | null>(null);
  const [sudo, setSudo] = useState(false);
  const [sudoPrompt, setSudoPrompt] = useState<{ error: string | null; busy: boolean } | null>(
    null,
  );
  /**
   * Kullanıcının sudo istemini reddettiği dizin.
   *
   * Bu olmadan "Vazgeç" işe yaramıyordu: istem kapanınca listeleme hatası
   * hâlâ duruyor, kendiliğinden açma efekti yeniden çalışıp istemi hemen geri
   * getiriyordu. Kullanıcı paneli kapatıp açmadan kurtulamıyordu. Reddedilen
   * dizini hatırlayınca aynı yolda bir daha sorulmuyor; başka bir dizine
   * geçildiğinde yeniden sorulabilir, çünkü orada yetki durumu farklı olabilir.
   */
  const [sudoDeclinedFor, setSudoDeclinedFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['/']));
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [upload, setUpload] = useState<{ name: string; percent: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  /** Geri/ileri geçmişi — tarayıcı gezinmesinden bağımsız, panel içi. */
  const [history, setHistory] = useState<(string | null)[]>([null]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const listing = useSftpList(hostId, path, sudo);

  useEffect(() => {
    setPath(null);
    setSudo(false);
    setSudoDeclinedFor(null);
    setHistory([null]);
    setHistoryIndex(0);
    setExpanded(new Set(['/']));
  }, [hostId]);

  const navigate = useCallback(
    (target: string | null) => {
      setPath(target);
      setFilter('');
      setHistory((prev) => {
        const next = prev.slice(0, historyIndex + 1);
        next.push(target);
        return next;
      });
      setHistoryIndex((i) => i + 1);
    },
    [historyIndex],
  );

  /**
   * Yetki hatasında sudo istemi kendiliğinden açılır.
   *
   * Kullanıcıyı "erişemedin" deyip bırakmak, sonra da bir yerde sudo düğmesi
   * aratmak gereksiz bir adım. Duvara çarptığı anda çözümü önüne koyuyoruz.
   */
  useEffect(() => {
    if (!listing.isError || sudo || sudoPrompt) return;
    // Bu dizin için zaten "Vazgeç" denmişse ısrar etme.
    if (sudoDeclinedFor === String(path)) return;
    const err = listing.error;
    const code = err instanceof ApiRequestError ? err.code : null;
    if (code === 'permission_denied' || code === 'not_found') {
      setSudoPrompt({ error: null, busy: false });
    }
  }, [listing.isError, listing.error, sudo, sudoPrompt, sudoDeclinedFor, path]);

  async function confirmSudo(password: string) {
    setSudoPrompt({ error: null, busy: true });
    try {
      await enableSudo(hostId, password);
      setSudo(true);
      setSudoPrompt(null);
      void queryClient.invalidateQueries({ queryKey: ['sftp', hostId] });
    } catch (err) {
      setSudoPrompt({
        error: apiError(err, 'files.passwordFailed'),
        busy: false,
      });
    }
  }

  async function handleUpload(files: FileList | File[]) {
    setError(null);
    const target = listing.data?.path;
    if (!target) return;

    for (const file of Array.from(files)) {
      setUpload({ name: file.name, percent: 0 });
      try {
        await uploadFile(
          hostId,
          `${target}/${file.name}`,
          file,
          (percent) => setUpload({ name: file.name, percent }),
          sudo,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : t('files.uploadFailed'));
        break;
      }
    }
    setUpload(null);
    void queryClient.invalidateQueries({ queryKey: ['sftp', hostId] });
  }

  async function handleDownload(entry: SftpEntry) {
    setError(null);
    try {
      await downloadFile(hostId, entry.path, entry.name, sudo);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('files.downloadFailed'));
    }
  }

  const entries = useMemo(() => {
    const all = listing.data?.entries ?? [];
    const needle = filter.trim().toLocaleLowerCase('tr');
    return needle ? all.filter((e) => e.name.toLocaleLowerCase('tr').includes(needle)) : all;
  }, [listing.data, filter]);

  const segments = (listing.data?.path ?? '/').split('/').filter(Boolean);

  function toggleExpanded(target: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
  }

  return (
    <div
      className={clsx(
        'relative flex h-full min-h-0 w-full flex-col border-l border-line bg-bg',
        dragOver && 'ring-2 ring-inset ring-accent',
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) void handleUpload(e.dataTransfer.files);
      }}
    >
      {/* ------------------------------------------------------ araç çubuğu */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-2 py-1.5">
        <ToolButton
          icon={<ArrowLeftIcon size={13} />}
          label={t('files.back')}
          disabled={historyIndex === 0}
          onClick={() => {
            const i = historyIndex - 1;
            setHistoryIndex(i);
            setPath(history[i] ?? null);
          }}
        />
        <ToolButton
          icon={<ArrowRightIcon size={13} />}
          label={t('files.forward')}
          disabled={historyIndex >= history.length - 1}
          onClick={() => {
            const i = historyIndex + 1;
            setHistoryIndex(i);
            setPath(history[i] ?? null);
          }}
        />
        <ToolButton
          icon={<ArrowUpIcon size={13} />}
          label={t('files.up')}
          disabled={!listing.data?.parent}
          onClick={() => navigate(listing.data?.parent ?? null)}
        />
        <ToolButton
          icon={<RefreshCwIcon size={13} className={clsx(listing.isFetching && 'animate-spin')} />}
          label={t('history.refresh')}
          onClick={() => void listing.refetch()}
        />

        {/* Kırıntı yolu: her parça tıklanabilir. */}
        <div className="mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded border border-line bg-bg px-2 py-1">
          <button
            type="button"
            className="flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] text-fg-dim hover:text-fg"
            onClick={() => navigate('/')}
          >
            <FolderIcon size={11} aria-hidden="true" />
            Kök
          </button>
          {segments.map((segment, index) => (
            <span key={index} className="flex shrink-0 items-center">
              <ChevronRightIcon size={11} className="mx-0.5 text-fg-dim/50" aria-hidden="true" />
              <button
                type="button"
                className="font-mono text-[11.5px] text-fg-dim hover:text-fg"
                onClick={() => navigate(`/${segments.slice(0, index + 1).join('/')}`)}
              >
                {segment}
              </button>
            </span>
          ))}
        </div>

        <div className="relative shrink-0">
          <SearchIcon
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-dim"
            aria-hidden="true"
          />
          <input
            className="input w-[150px] py-1 pl-6.5 pr-2 font-mono text-[11.5px]"
            style={{ paddingLeft: 24 }}
            placeholder="Dosya ara…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Dosya ara"
          />
        </div>

        <button
          type="button"
          className={clsx(
            'btn-ghost ml-1 flex shrink-0 items-center gap-1.5 rounded px-2 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em]',
            sudo && 'text-accent',
          )}
          onClick={() => {
            if (sudo) {
              void disableSudo(hostId).finally(() => {
                setSudo(false);
                void queryClient.invalidateQueries({ queryKey: ['sftp', hostId] });
              });
            } else {
              setSudoPrompt({ error: null, busy: false });
            }
          }}
          title={sudo ? t('files.sudoOn') : t('files.sudoOff')}
        >
          <ShieldIcon size={12} />
          sudo
        </button>

        <button
          type="button"
          className="btn shrink-0 font-mono text-[11px] uppercase tracking-[0.1em]"
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon size={12} />
          Yükle
        </button>
        <button
          type="button"
          className="btn btn-primary shrink-0 font-mono text-[11px] uppercase tracking-[0.1em]"
          onClick={() => setDialog({ kind: 'mkdir' })}
        >
          <PlusIcon size={12} />
          Yeni
        </button>
        <ToolButton icon={<XIcon size={14} />} label={t('files.closePanel')} onClick={onClose} />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void handleUpload(e.target.files);
          e.target.value = '';
        }}
      />

      {error && (
        <p
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger"
        >
          <AlertCircleIcon size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Kapat">
            <XIcon size={12} />
          </button>
        </p>
      )}

      {upload && (
        <div className="shrink-0 border-b border-line px-3 py-2">
          <p className="truncate font-mono text-[11.5px] text-fg-dim">
            {upload.name} · %{upload.percent}
          </p>
          <div className="mt-1 h-1 overflow-hidden rounded bg-surface-2">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${upload.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* ---------------------------------------------- ağaç + dosya tablosu */}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[210px] shrink-0 flex-col border-r border-line bg-surface">
          <p className="eyebrow px-3 py-2">{t('files.directories')}</p>
          <DirectoryTree
            hostId={hostId}
            sudo={sudo}
            currentPath={listing.data?.path ?? null}
            expanded={expanded}
            onToggle={toggleExpanded}
            onSelect={navigate}
          />

          <StorageWidget
            hostId={hostId}
            currentPath={listing.data?.path ?? null}
            onSelect={navigate}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-dim">
            <span className="min-w-0 flex-1">Ad</span>
            <span className="w-[150px] shrink-0">{t('files.colModified')}</span>
            <span className="w-[70px] shrink-0 text-right">Boyut</span>
            <span className="w-[95px] shrink-0">{t('files.colPermissions')}</span>
            <span className="w-[76px] shrink-0" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {listing.isPending && (
              <p className="flex items-center gap-2 px-3 py-4 font-mono text-[12px] text-fg-dim">
                <LoaderIcon size={13} className="animate-spin" aria-hidden="true" />
                yükleniyor…
              </p>
            )}

            {listing.isError && !sudoPrompt && (
              <div className="px-3 py-6 text-center">
                <p className="text-[12.5px] text-danger">
                  {apiError(listing.error, 'files.readFailed')}
                </p>
                {!sudo && (
                  <button
                    type="button"
                    className="btn mt-3"
                    onClick={() => {
                      // Elle istendiğinde reddedilmişlik kaydı temizlenir.
                      setSudoDeclinedFor(null);
                      setSudoPrompt({ error: null, busy: false });
                    }}
                  >
                    <ShieldIcon size={13} />
                    {t('files.trySudo')}
                  </button>
                )}
              </div>
            )}

            {listing.data && entries.length === 0 && (
              <p className="px-3 py-6 text-center text-[12.5px] text-fg-dim">
                {filter ? t('files.noMatch') : t('files.empty')}
              </p>
            )}

            {entries.map((entry) => {
              const dir = isDirectory(entry);
              return (
                <div
                  key={entry.path}
                  className="group flex items-center gap-3 border-b border-line/40 px-3 py-[5px] transition-colors hover:bg-surface-2"
                >
                  {/*
                    Tek tıkla giriş: uzak dosya sisteminde gezinme birincil
                    eylem. Çift tıklama beklemek her adıma gecikme ekliyordu.
                  */}
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => (dir ? navigate(entry.path) : void handleDownload(entry))}
                    title={dir ? `${entry.name} — açmak için tıklayın` : entry.name}
                  >
                    {entry.type === 'symlink' ? (
                      <Link2Icon size={13} className="shrink-0 text-warn" aria-hidden="true" />
                    ) : dir ? (
                      <FolderIcon size={13} className="shrink-0 text-accent" aria-hidden="true" />
                    ) : (
                      <FileIcon size={13} className="shrink-0 text-fg-dim" aria-hidden="true" />
                    )}
                    <span className="truncate font-mono text-[12px]">{entry.name}</span>
                  </button>

                  <span className="w-[150px] shrink-0 font-mono text-[11px] text-fg-dim">
                    {formatDate(entry.modifiedAt, localeTag(lang))}
                  </span>
                  <span className="w-[70px] shrink-0 text-right font-mono text-[11px] text-fg-dim">
                    {dir ? '—' : formatSize(entry.size)}
                  </span>
                  <span
                    className="w-[95px] shrink-0 font-mono text-[11px] text-fg-dim"
                    title={entry.mode}
                  >
                    {formatMode(entry.mode, dir)}
                  </span>

                  <span className="flex w-[76px] shrink-0 items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    {!dir && (
                      <button
                        type="button"
                        className="rounded p-1 text-fg-dim hover:bg-line hover:text-fg"
                        onClick={() => void handleDownload(entry)}
                        aria-label={`${entry.name} indir`}
                      >
                        <DownloadIcon size={12} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded p-1 text-fg-dim hover:bg-line hover:text-fg"
                      onClick={() => setDialog({ kind: 'rename', entry })}
                      aria-label={`${entry.name} yeniden adlandır`}
                    >
                      <PencilIcon size={12} />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-fg-dim hover:bg-line hover:text-danger"
                      onClick={() => setDialog({ kind: 'delete', entry })}
                      aria-label={`${entry.name} sil`}
                    >
                      <Trash2Icon size={12} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-line px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg-dim">
            <span>{entries.length} öğe</span>
            {sudo && (
              <span className="flex items-center gap-1.5 text-accent">
                <ShieldIcon size={11} aria-hidden="true" />
                {t('files.sudoActive')}
              </span>
            )}
          </div>
        </div>
      </div>

      {sudoPrompt && (
        <SudoPrompt
          hostName={hostName}
          error={sudoPrompt.error}
          busy={sudoPrompt.busy}
          onSubmit={(password) => void confirmSudo(password)}
          onCancel={() => {
            setSudoPrompt(null);
            // Aynı dizinde istemin hemen geri gelmemesi için reddi kaydet.
            setSudoDeclinedFor(String(path));
          }}
        />
      )}

      {dialog && (
        <EntryDialog
          dialog={dialog}
          hostId={hostId}
          sudo={sudo}
          currentPath={listing.data?.path ?? '/'}
          onClose={() => setDialog(null)}
          onError={setError}
        />
      )}
    </div>
  );
}

function ToolButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="btn-ghost shrink-0 rounded p-1.5 disabled:opacity-30"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}

function EntryDialog({
  dialog,
  hostId,
  sudo,
  currentPath,
  onClose,
  onError,
}: {
  dialog: NonNullable<Dialog>;
  hostId: string;
  sudo: boolean;
  currentPath: string;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const apiError = useApiError();
  const mkdir = useMkdir(hostId, sudo);
  const rename = useRename(hostId, sudo);
  const chmod = useChmod(hostId, sudo);
  const remove = useDeleteEntry(hostId, sudo);

  const [value, setValue] = useState(
    dialog.kind === 'rename'
      ? dialog.entry.name
      : dialog.kind === 'chmod'
        ? dialog.entry.mode.replace(/^0/, '')
        : '',
  );

  const busy = mkdir.isPending || rename.isPending || chmod.isPending || remove.isPending;

  async function run() {
    try {
      if (dialog.kind === 'mkdir') {
        await mkdir.mutateAsync(`${currentPath}/${value.trim()}`);
      } else if (dialog.kind === 'rename') {
        const parent = dialog.entry.path.slice(0, dialog.entry.path.lastIndexOf('/')) || '';
        await rename.mutateAsync({ from: dialog.entry.path, to: `${parent}/${value.trim()}` });
      } else if (dialog.kind === 'chmod') {
        await chmod.mutateAsync({ path: dialog.entry.path, mode: value.trim() });
      } else {
        await remove.mutateAsync({
          path: dialog.entry.path,
          directory: isDirectory(dialog.entry),
        });
      }
      onClose();
    } catch (err) {
      onError(apiError(err, 'files.actionFailed'));
      onClose();
    }
  }

  const titleKeys = {
    mkdir: 'files.mkdir',
    rename: 'files.rename',
    chmod: 'files.chmod',
    delete: 'files.delete',
  } as const satisfies Record<string, TranslationKey>;

  return (
    <Modal
      title={t(titleKeys[dialog.kind])}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={clsx(
              'btn',
              dialog.kind === 'delete'
                ? 'border-danger/50 text-danger hover:bg-danger/10'
                : 'btn-primary',
            )}
            onClick={() => void run()}
            disabled={busy}
          >
            {dialog.kind === 'delete' ? t('files.delete') : t('files.ok')}
          </button>
        </>
      }
    >
      {dialog.kind === 'delete' ? (
        <p className="text-[13px] leading-relaxed">
          <strong className="font-mono font-medium">{dialog.entry.name}</strong> sunucudan
          silinecek. Bu işlem geri alınamaz.
        </p>
      ) : (
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">
            {dialog.kind === 'chmod' ? t('files.octalLabel') : t('common.name')}
          </span>
          <input
            autoFocus
            className="input font-mono"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run();
            }}
          />
        </label>
      )}
    </Modal>
  );
}
