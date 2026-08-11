import { useState } from 'react';
import { AlertCircleIcon, KeyRoundIcon, LoaderIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type { CredentialSummary } from '@sshby/shared';
import { CredentialDialog } from '@/components/dialogs/CredentialDialog';
import { Modal } from '@/components/ui/Modal';
import { useApiError, useT } from '@/lib/i18n';
import { useCredentials, useDeleteCredential } from '@/lib/queries';
import { useDocumentTitle } from '@/lib/use-document-title';

export function CredentialsPage() {
  const t = useT();
  const apiError = useApiError();
  const credentials = useCredentials();
  const deleteCredential = useDeleteCredential();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CredentialSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle('Vault');

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
    <div className="mx-auto max-w-3xl px-8 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('vault.eyebrow')}</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight">{t('vault.title')}</h1>
          <p className="mt-2 max-w-[56ch] text-fg-dim">{t('vault.intro')}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary shrink-0"
          onClick={() => setDialogOpen(true)}
        >
          <PlusIcon size={14} />
          {t('common.add')}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-5 flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger"
        >
          <AlertCircleIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <section className="mt-8">
        {credentials.isPending && (
          <p className="flex items-center gap-2 font-mono text-[13px] text-fg-dim">
            <LoaderIcon size={14} className="animate-spin" aria-hidden="true" />
            {t('common.loading')}
          </p>
        )}

        {credentials.data?.length === 0 && (
          <div className="panel flex flex-col items-center gap-3 px-6 py-12 text-center">
            <KeyRoundIcon size={22} className="text-fg-dim/50" aria-hidden="true" />
            <p className="text-[13px] text-fg-dim">{t('vault.empty')}</p>
          </div>
        )}

        <ul className="space-y-2">
          {credentials.data?.map((cred) => (
            <li
              key={cred.id}
              className="flex items-center gap-4 rounded-panel border border-line bg-surface px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium">{cred.name}</span>
                  <span className="pill">
                    {cred.type === 'password' ? t('vault.typePassword') : t('vault.typeKey')}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11.5px] text-fg-dim">
                  {cred.publicFingerprint ??
                    (cred.username ? t('vault.userPrefix', { name: cred.username }) : '—')}
                </div>
              </div>

              <span className="shrink-0 font-mono text-[11.5px] text-fg-dim">
                {t('vault.usedBy', { n: cred.usedByHostCount })}
              </span>

              <button
                type="button"
                className="btn-ghost shrink-0 rounded p-1.5 hover:text-danger"
                onClick={() => setPendingDelete(cred)}
                aria-label={t('vault.deleteAria', { name: cred.name })}
              >
                <Trash2Icon size={14} />
              </button>
            </li>
          ))}
        </ul>
      </section>

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
    </div>
  );
}
