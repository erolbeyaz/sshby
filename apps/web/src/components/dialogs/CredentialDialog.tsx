import { useState, type FormEvent } from 'react';
import { AlertCircleIcon } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useApiError, useT } from '@/lib/i18n';
import { useCreateCredential } from '@/lib/queries';

/**
 * Kasa kaydı ekleme.
 *
 * Hem kasa sayfası hem sol paneldeki kısa liste aynı formu açıyor; iki ayrı
 * kopya tutmak, birinde düzeltilen bir doğrulamanın diğerinde eksik kalması
 * demekti.
 */
export function CredentialDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const apiError = useApiError();
  const createCredential = useCreateCredential();
  const [type, setType] = useState<'password' | 'key'>('password');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await createCredential.mutateAsync(
        type === 'password'
          ? { name, username: username || undefined, type: 'password', password }
          : {
              name,
              username: username || undefined,
              type: 'key',
              privateKey,
              passphrase: passphrase || undefined,
            },
      );
      onClose();
    } catch (err) {
      setError(apiError(err, 'common.saveFailed'));
    }
  }

  return (
    <Modal
      title={t('vault.addTitle')}
      description={t('vault.addDescription')}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="credential-form"
            className="btn btn-primary"
            disabled={createCredential.isPending}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <form id="credential-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-2">
          {(['password', 'key'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`btn flex-1 ${type === option ? 'border-accent text-accent' : ''}`}
              onClick={() => setType(option)}
            >
              {option === 'password' ? t('vault.password') : t('vault.sshKey')}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">{t('common.name')}</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('vault.namePlaceholder')}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">{t('vault.defaultUser')}</span>
            <input
              className="input font-mono"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="root"
            />
            <span className="mt-1 block text-[12px] text-fg-dim">{t('vault.defaultUserHint')}</span>
          </label>
        </div>

        {type === 'password' ? (
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">{t('vault.password')}</span>
            <input
              type="password"
              className="input font-mono"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        ) : (
          <>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">{t('vault.privateKey')}</span>
              <textarea
                className="input h-40 resize-y font-mono text-[12px]"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                spellCheck={false}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">{t('vault.passphrase')}</span>
              <input
                type="password"
                className="input font-mono"
                autoComplete="new-password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder={t('vault.passphrasePlaceholder')}
              />
            </label>
          </>
        )}

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
