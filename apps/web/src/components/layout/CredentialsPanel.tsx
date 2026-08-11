import { useMemo, useState } from 'react';
import { KeyRoundIcon, LoaderIcon, PlusIcon, SearchIcon, Trash2Icon, XIcon } from 'lucide-react';
import type { CredentialSummary } from '@sshby/shared';
import { CredentialDialog } from '@/components/dialogs/CredentialDialog';
import { Modal } from '@/components/ui/Modal';
import { useApiError, useI18n, useT } from '@/lib/i18n';
import { useCredentials, useDeleteCredential } from '@/lib/queries';

/**
 * Kasa paneli — kimlik bilgilerinin kompakt listesi.
 *
 * Tam sayfa (`/vault`) hâlâ duruyor ve aynı verinin geniş görünümünü sunuyor;
 * bu panel sunucu eklerken kasaya bakmayı gerektiren akış için var: kullanıcı
 * hangi kimliğin kayıtlı olduğunu görmek için sayfa değiştirmek zorunda
 * kalmasın, terminali arkada bırakmasın.
 */
export function CredentialsPanel() {
  const t = useT();
  const { lang } = useI18n();
  const apiError = useApiError();
  const credentials = useCredentials();
  const deleteCredential = useDeleteCredential();

  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CredentialSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(lang);
    const list = credentials.data ?? [];
    if (!needle) return list;
    return list.filter((cred) =>
      `${cred.name} ${cred.username ?? ''}`.toLocaleLowerCase(lang).includes(needle),
    );
  }, [credentials.data, lang, query]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteCredential.mutateAsync(pendingDelete.id);
      setPendingDelete(null);
    } catch (err) {
      setError(apiError(err, 'common.deleteFailed'));
    }
  }

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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('vaultPanel.search')}
            aria-label={t('vaultPanel.search')}
          />
          {query && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-dim hover:text-fg"
              onClick={() => setQuery('')}
              aria-label={t('sidebar.clearFilter')}
            >
              <XIcon size={13} />
            </button>
          )}
        </div>
        <button
          type="button"
          className="btn-ghost shrink-0 rounded p-1.5"
          onClick={() => setDialogOpen(true)}
          aria-label={t('vault.addTitle')}
          title={t('vault.addTitle')}
        >
          <PlusIcon size={14} />
        </button>
      </div>

      {error && (
        <p role="alert" className="mx-2 mb-1 rounded bg-danger/10 px-2 py-1.5 text-[12px] text-danger">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {credentials.isPending && (
          <p className="flex items-center gap-2 px-2 py-4 font-mono text-[12px] text-fg-dim">
            <LoaderIcon size={13} className="animate-spin" aria-hidden="true" />
            {t('common.loading')}
          </p>
        )}

        {credentials.data && filtered.length === 0 && (
          <p className="px-3 py-8 text-center text-[12.5px] leading-relaxed text-fg-dim">
            {query ? t('vaultPanel.noMatch') : t('vault.empty')}
          </p>
        )}

        {filtered.map((cred) => (
          <div
            key={cred.id}
            className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-2"
          >
            <KeyRoundIcon size={12} className="shrink-0 text-fg-dim" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[12.5px]">{cred.name}</span>
                <span className="pill shrink-0">
                  {cred.type === 'password' ? t('vault.typePassword') : t('vault.typeKey')}
                </span>
              </div>
              <div className="truncate font-mono text-[10.5px] text-fg-dim">
                {cred.username ? `${cred.username} · ` : ''}
                {t('vault.usedBy', { n: cred.usedByHostCount })}
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-fg-dim opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              onClick={() => setPendingDelete(cred)}
              aria-label={t('vault.deleteAria', { name: cred.name })}
            >
              <Trash2Icon size={12} />
            </button>
          </div>
        ))}
      </div>

      {dialogOpen && <CredentialDialog onClose={() => setDialogOpen(false)} />}

      {pendingDelete && (
        <Modal
          title={t('vault.deleteTitle')}
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPendingDelete(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn border-danger/50 text-danger hover:bg-danger/10"
                onClick={() => void confirmDelete()}
                disabled={deleteCredential.isPending}
              >
                {t('common.delete')}
              </button>
            </>
          }
        >
          <p className="text-[13px] leading-relaxed">
            <strong className="font-medium">{pendingDelete.name}</strong> {t('vault.deleteBody')}
            {pendingDelete.usedByHostCount > 0 && (
              <span className="mt-3 block rounded border border-warn/40 bg-warn/10 px-3 py-2 text-warn">
                {t('vault.deleteWarning', { n: pendingDelete.usedByHostCount })}
              </span>
            )}
          </p>
        </Modal>
      )}
    </>
  );
}
