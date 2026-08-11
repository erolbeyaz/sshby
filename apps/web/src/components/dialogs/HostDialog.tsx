import { useState, type FormEvent } from 'react';
import { AlertCircleIcon } from 'lucide-react';
import { hostInputSchema, type Folder, type Host, type HostInput } from '@sshby/shared';
import { Modal } from '@/components/ui/Modal';
import { useApiError, useT } from '@/lib/i18n';
import { useCreateHost, useCredentials, useUpdateHost } from '@/lib/queries';

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

  const [form, setForm] = useState({
    name: host?.name ?? '',
    hostname: host?.hostname ?? '',
    port: String(host?.port ?? 22),
    // Devralınan değer forma yazılmaz; boş alan "devral" demek.
    username: host?.username ?? '',
    credentialId: host?.credentialId ?? '',
    folderId: host?.folderId ?? defaultFolderId ?? '',
    defaultPath: host?.defaultPath ?? '',
    tags: host?.tags.join(', ') ?? '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const busy = createHost.isPending || updateHost.isPending;

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

    const candidate = {
      name: form.name,
      hostname: form.hostname,
      port: Number(form.port),
      // Boş = "kimlik bilgisinden devral"; tek gösterim olsun diye null'a çeviriyoruz.
      username: form.username.trim() || null,
      credentialId: form.credentialId || null,
      folderId: form.folderId || null,
      defaultPath: form.defaultPath.trim() || null,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
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
      <form id="host-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('common.name')} error={fieldErrors.name}>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="prod-master-01"
            />
          </Field>
          <Field label={t('hostDialog.folder')}>
            <select
              className="input"
              value={form.folderId}
              onChange={(e) => set('folderId', e.target.value)}
            >
              <option value="">{t('host.rootLevel')}</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

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

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('hostDialog.defaultPath')} hint={t('hostDialog.defaultPathHint')}>
            <input
              className="input font-mono"
              value={form.defaultPath}
              onChange={(e) => set('defaultPath', e.target.value)}
              placeholder="/var/log"
            />
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

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
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
