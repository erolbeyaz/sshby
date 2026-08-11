import { useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertCircleIcon,
  GlobeIcon,
  MonitorIcon,
  PinIcon,
  TagIcon,
  TerminalIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { hostInputSchema, type Folder, type Host, type HostInput } from '@sshby/shared';
import { FolderPicker, type FolderSelection } from '@/components/ui/FolderPicker';
import { Modal } from '@/components/ui/Modal';
import { useApiError, useT } from '@/lib/i18n';
import { useCreateFolder, useCreateHost, useCredentials, useUpdateHost } from '@/lib/queries';

/**
 * Sunucu formu — bölümlere ayrılmış düzen.
 *
 * Alanlar üç başlık altında toplanıyor (bağlantı türü / bağlantı ayrıntıları /
 * klasör ve gelişmiş). Tek bir uzun liste hâlindeyken kullanıcı hangi alanın
 * zorunlu, hangisinin isteğe bağlı olduğunu ayırt edemiyordu; başlıklar bu
 * ayrımı görsel olarak yapıyor.
 */
export function HostDialog({
  host,
  folders,
  defaultFolderId,
  onClose,
}: {
  /** null = yeni sunucu */
  host: Host | null;
  folders: Folder[];
  defaultFolderId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const apiError = useApiError();
  const credentials = useCredentials();
  const createHost = useCreateHost();
  const updateHost = useUpdateHost();
  const createFolder = useCreateFolder();

  const [form, setForm] = useState({
    name: host?.name ?? '',
    hostname: host?.hostname ?? '',
    port: String(host?.port ?? 22),
    // Devralınan değer forma yazılmaz; boş alan "devral" demek.
    username: host?.username ?? '',
    credentialId: host?.credentialId ?? '',
    defaultPath: host?.defaultPath ?? '',
    notes: host?.notes ?? '',
    tags: host?.tags.join(', ') ?? '',
  });
  const [folder, setFolder] = useState<FolderSelection>({
    kind: 'existing',
    id: host?.folderId ?? defaultFolderId,
  });
  const [pinned, setPinned] = useState(host?.pinned ?? false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const busy = createHost.isPending || updateHost.isPending || createFolder.isPending;

  /** Seçili kimlik bilgisi bir kullanıcı adı taşıyorsa alan boş bırakılabilir. */
  const inheritedUsername =
    credentials.data?.find((c) => c.id === form.credentialId)?.username ?? null;

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    /**
     * Bekleyen klasör burada açılır — seçicide değil. Böylece "Vazgeç" hiçbir
     * yan etki bırakmıyor; klasör yalnızca sunucu gerçekten kaydedilirken
     * oluşuyor.
     */
    let folderId: string | null = null;
    if (folder.kind === 'existing') {
      folderId = folder.id;
    } else {
      try {
        const created = await createFolder.mutateAsync({
          name: folder.name,
          parentId: folder.parentId,
          color: null,
        });
        folderId = created.id;
        // Klasör açıldı: form yeniden gönderilirse ikinci kez oluşturulmasın.
        setFolder({ kind: 'existing', id: created.id });
      } catch (err) {
        setError(apiError(err, 'common.saveFailed'));
        return;
      }
    }

    const candidate = {
      name: form.name,
      hostname: form.hostname,
      port: Number(form.port),
      // Boş = "kimlik bilgisinden devral"; tek gösterim olsun diye null'a çeviriyoruz.
      username: form.username.trim() || null,
      credentialId: form.credentialId || null,
      folderId,
      defaultPath: form.defaultPath.trim() || null,
      notes: form.notes.trim() || null,
      pinned,
      tags: form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    };

    const parsed = hostInputSchema.safeParse(candidate);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    try {
      if (host) await updateHost.mutateAsync({ id: host.id, ...(parsed.data as HostInput) });
      else await createHost.mutateAsync(parsed.data);
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <Modal
      title={host ? t('hostDialog.editTitle') : t('hostDialog.addTitle')}
      description={host ? host.name : t('hostDialog.description')}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="host-form" className="btn btn-primary" disabled={busy}>
            {host ? t('common.save') : t('common.add')}
          </button>
        </>
      }
    >
      <form id="host-form" onSubmit={handleSubmit} className="space-y-5">
        {/* ------------------------------------------------- bağlantı türü */}
        <Section icon={<GlobeIcon size={12} />} title={t('hostDialog.protocols')}>
          <div className="grid grid-cols-2 gap-2">
            <ProtocolCard
              icon={<TerminalIcon size={14} />}
              name="SSH"
              description={t('hostDialog.protocolSsh')}
              enabled
            />
            {/*
              Diğer protokoller (RDP/VNC/Telnet) kasıtlı olarak yok: sshby yalnızca
              SSH konuşuyor ve devre dışı bir kart koymak, var olmayan bir özelliği
              "yakında" gibi göstermek olurdu.
            */}
            <div className="flex items-center rounded border border-dashed border-line px-3 py-2.5 text-[12px] leading-snug text-fg-dim">
              <MonitorIcon size={13} className="mr-2 shrink-0" aria-hidden="true" />
              {t('hostDialog.sshOnly')}
            </div>
          </div>
        </Section>

        {/* --------------------------------------------- bağlantı ayrıntıları */}
        <Section icon={<GlobeIcon size={12} />} title={t('hostDialog.connectionDetails')}>
          <div className="grid grid-cols-[1fr_120px] gap-4">
            <Field label={t('hostDialog.address')} error={fieldErrors.hostname}>
              <input
                className="input font-mono"
                value={form.hostname}
                onChange={(e) => set('hostname', e.target.value)}
                placeholder="10.0.0.11"
              />
            </Field>
            <Field label={t('hostDialog.port')} error={fieldErrors.port}>
              <input
                className="input font-mono"
                inputMode="numeric"
                value={form.port}
                onChange={(e) => set('port', e.target.value)}
              />
            </Field>
          </div>

          <Field label={t('hostDialog.friendlyName')} error={fieldErrors.name}>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder={t('hostDialog.friendlyNamePlaceholder')}
            />
          </Field>

          {/* Kimlik bilgisi önce geliyor: kullanıcı adı ondan devralınabildiği
              için sıralama bu bağımlılığı görünür kılıyor. */}
          <div className="grid grid-cols-2 gap-4">
            <Field
              label={t('hostDialog.credential')}
              hint={
                credentials.data && credentials.data.length === 0
                  ? t('hostDialog.credentialEmpty')
                  : undefined
              }
            >
              <select
                className="input"
                value={form.credentialId}
                onChange={(e) => set('credentialId', e.target.value)}
              >
                <option value="">{t('hostDialog.credentialNone')}</option>
                {credentials.data?.map((cred) => (
                  <option key={cred.id} value={cred.id}>
                    {cred.name} (
                    {cred.type === 'password' ? t('vault.typePassword') : t('vault.typeKey')})
                    {cred.username ? ` · ${cred.username}` : ''}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label={t('hostDialog.sshUser')}
              error={fieldErrors.username}
              hint={
                inheritedUsername
                  ? t('hostDialog.inheritHint', { name: inheritedUsername })
                  : t('hostDialog.noInheritHint')
              }
            >
              <input
                className="input font-mono"
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
                placeholder={inheritedUsername ?? 'root'}
              />
            </Field>
          </div>
        </Section>

        {/* ------------------------------------------------ klasör ve gelişmiş */}
        <Section icon={<TagIcon size={12} />} title={t('hostDialog.folderAndAdvanced')}>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('hostDialog.folder')}>
              <FolderPicker folders={folders} value={folder} onChange={setFolder} />
            </Field>
            <Field label={t('hostDialog.tags')} hint={t('hostDialog.tagsHint')}>
              <input
                className="input"
                value={form.tags}
                onChange={(e) => set('tags', e.target.value)}
                placeholder={t('hostDialog.tagsPlaceholder')}
              />
            </Field>
          </div>

          <Field label={t('hostDialog.defaultPath')} hint={t('hostDialog.defaultPathHint')}>
            <input
              className="input font-mono"
              value={form.defaultPath}
              onChange={(e) => set('defaultPath', e.target.value)}
              placeholder="/var/log"
            />
          </Field>

          <Field label={t('hostDialog.notes')}>
            <textarea
              className="input h-20 resize-y text-[12.5px]"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder={t('hostDialog.notesPlaceholder')}
            />
          </Field>

          <button
            type="button"
            onClick={() => setPinned((v) => !v)}
            aria-pressed={pinned}
            className={clsx(
              'flex w-full items-start gap-3 rounded border px-3.5 py-3 text-left transition-colors',
              pinned ? 'border-accent bg-accent-muted' : 'border-line hover:border-fg-dim/40',
            )}
          >
            <PinIcon
              size={14}
              className={clsx('mt-0.5 shrink-0', pinned ? 'text-accent' : 'text-fg-dim')}
              aria-hidden="true"
            />
            <span className="text-[13px]">
              <span className={clsx('font-medium', pinned && 'text-accent')}>
                {t('hostDialog.pin')}
              </span>
              <span className="mt-0.5 block text-[12px] text-fg-dim">
                {t('hostDialog.pinHint')}
              </span>
            </span>
          </button>
        </Section>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger"
          >
            <AlertCircleIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded border border-line">
      <h3 className="flex items-center gap-2 border-b border-line bg-surface-2 px-3.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-dim">
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
        {title}
      </h3>
      <div className="space-y-4 px-3.5 py-3.5">{children}</div>
    </section>
  );
}

function ProtocolCard({
  icon,
  name,
  description,
  enabled,
}: {
  icon: ReactNode;
  name: string;
  description: string;
  enabled: boolean;
}) {
  return (
    <div
      className={clsx(
        'flex items-center gap-3 rounded border px-3 py-2.5',
        enabled ? 'border-accent bg-accent-muted' : 'border-line',
      )}
    >
      <span className={clsx('shrink-0', enabled ? 'text-accent' : 'text-fg-dim')} aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={clsx('block text-[13px] font-medium', enabled && 'text-accent')}>
          {name}
        </span>
        <span className="block truncate text-[11.5px] text-fg-dim">{description}</span>
      </span>
    </div>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[12px] text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[12px] text-fg-dim">{hint}</span>
      ) : null}
    </label>
  );
}
