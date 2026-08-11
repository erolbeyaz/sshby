import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangleIcon, KeyRoundIcon, PencilIcon, TerminalIcon } from 'lucide-react';
import { HostDialog } from '@/components/dialogs/HostDialog';
import { useT } from '@/lib/i18n';
import { useCredentials, useInventory } from '@/lib/queries';
import { useTerminalStore } from '@/lib/terminal-store';
import { useDocumentTitle } from '@/lib/use-document-title';

/**
 * Sunucu ayrıntısı. Ağaçta tek tıklama buraya getirir; bağlanma bilinçli bir
 * eylem olarak burada ya da çift tıklamayla yapılır.
 */
export function HostDetailPage() {
  const t = useT();
  const { hostId } = useParams<{ hostId: string }>();
  const navigate = useNavigate();
  const inventory = useInventory();
  const credentials = useCredentials();
  const openTab = useTerminalStore((s) => s.openTab);
  const [editing, setEditing] = useState(false);

  const host = inventory.data?.hosts.find((h) => h.id === hostId);
  const folders = inventory.data?.folders ?? [];

  useDocumentTitle(host ? `Server · ${host.name}` : 'Server');

  if (inventory.isPending) {
    return <p className="px-8 py-12 font-mono text-[13px] text-fg-dim">{t('common.loading')}</p>;
  }

  if (!host) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-12">
        <h1 className="text-[22px] font-semibold">{t('host.notFound')}</h1>
        <p className="mt-2 text-fg-dim">{t('host.notFoundHint')}</p>
      </div>
    );
  }

  const credential = host.credentialId
    ? credentials.data?.find((c) => c.id === host.credentialId)
    : null;
  /**
   * Kimlik bilgisi artık zorunlu değil: atanmamışsa parola bağlantı anında
   * sorulur. Bağlanmak için tek gereken, bir SSH kullanıcı adının çözülebilmesi.
   */
  const canConnect = Boolean(host.effectiveUsername);

  function connect() {
    if (!host) return;
    openTab(host.id, host.name);
    navigate('/');
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-12">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">{t('host.eyebrow')}</p>
          <h1 className="mt-2 truncate font-mono text-[26px] font-extrabold tracking-tight">
            {host.name}
          </h1>
          <p className="mt-1 font-mono text-[13px] text-fg-dim">
            {host.effectiveUsername ?? '?'}@{host.hostname}:{host.port}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            <PencilIcon size={13} />
            {t('common.edit')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={connect}
            disabled={!canConnect}
            title={
              canConnect
                ? credential
                  ? t('host.openTerminalTitle')
                  : t('host.openTerminalAskPassword')
                : t('host.needUsername')
            }
          >
            <TerminalIcon size={13} />
            {t('host.connect')}
          </button>
        </div>
      </div>

      {host.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {host.tags.map((tag) => (
            <span key={tag} className="pill">
              {tag}
            </span>
          ))}
        </div>
      )}

      {!canConnect && (
        <div className="mt-6 flex items-start gap-3 rounded-panel border border-warn/40 bg-warn/10 px-4 py-3.5">
          <AlertTriangleIcon size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
          <div className="text-[13px] leading-relaxed">
            <p className="font-medium text-warn">{t('host.noUsernameTitle')}</p>
            <p className="mt-1 text-fg-dim">{t('host.noUsernameBody')}</p>
            <button type="button" className="btn mt-3" onClick={() => setEditing(true)}>
              <PencilIcon size={13} />
              {t('host.editHost')}
            </button>
          </div>
        </div>
      )}

      {canConnect && !credential && (
        <div className="mt-6 flex items-start gap-3 rounded-panel border border-line bg-surface px-4 py-3.5">
          <KeyRoundIcon size={16} className="mt-0.5 shrink-0 text-fg-dim" aria-hidden="true" />
          <div className="text-[13px] leading-relaxed">
            <p className="font-medium">{t('host.noCredentialTitle')}</p>
            <p className="mt-1 text-fg-dim">{t('host.noCredentialBody')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {credentials.data && credentials.data.length > 0 ? (
                <button type="button" className="btn" onClick={() => setEditing(true)}>
                  <PencilIcon size={13} />
                  {t('host.pickCredential')}
                </button>
              ) : (
                <Link to="/vault" className="btn">
                  <KeyRoundIcon size={13} />
                  {t('host.addToVault')}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      <section className="panel mt-6 p-5">
        <h2 className="eyebrow mb-4">{t('host.connectionSection')}</h2>
        <dl className="grid grid-cols-[140px_1fr] gap-x-6 gap-y-2.5 font-mono text-[13px]">
          <dt className="text-fg-dim">{t('host.credential')}</dt>
          <dd>
            {credential ? (
              <>
                {credential.name}{' '}
                <span className="text-fg-dim">
                  ({credential.type === 'password' ? t('vault.typePassword') : t('vault.typeKey')})
                </span>
              </>
            ) : (
              <span className="text-warn">{t('host.noneSelected')}</span>
            )}
          </dd>

          <dt className="text-fg-dim">{t('host.folder')}</dt>
          <dd>{folders.find((f) => f.id === host.folderId)?.name ?? t('host.rootLevel')}</dd>

          <dt className="text-fg-dim">{t('host.defaultPath')}</dt>
          <dd>{host.defaultPath ?? '~'}</dd>
        </dl>
      </section>

      {editing && (
        <HostDialog
          host={host}
          folders={folders}
          defaultFolderId={host.folderId}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
