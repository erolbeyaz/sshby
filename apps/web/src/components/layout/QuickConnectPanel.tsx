import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  EyeIcon,
  EyeOffIcon,
  FolderOpenIcon,
  TerminalIcon,
  ZapIcon,
} from 'lucide-react';
import clsx from 'clsx';
import type { Host, QuickConnectRequest } from '@sshby/shared';
import { apiFetch } from '@/lib/api';
import { useApiError, useT, type TranslationKey } from '@/lib/i18n';
import { useCredentials } from '@/lib/queries';
import { useTerminalStore } from '@/lib/terminal-store';

type AuthMode = 'password' | 'key' | 'credential';

const AUTH_MODES: { value: AuthMode; labelKey: TranslationKey }[] = [
  { value: 'password', labelKey: 'quick.authPassword' },
  { value: 'key', labelKey: 'quick.authKey' },
  { value: 'credential', labelKey: 'quick.authVault' },
];

/**
 * Hızlı bağlantı — envantere kaydetmeden tek seferlik erişim.
 *
 * Sunucu tarafında `ephemeral` işaretli geçici bir kayıt oluşuyor; böylece
 * terminal, dosya gezgini, metrikler ve denetim hiçbir değişiklik olmadan
 * çalışıyor. Kayıt 24 saat kullanılmazsa siliniyor.
 */
export function QuickConnectPanel() {
  const t = useT();
  const apiError = useApiError();
  const credentials = useCredentials();
  const openTab = useTerminalStore((s) => s.openTab);
  const openFileTab = useTerminalStore((s) => s.openFileTab);
  const navigate = useNavigate();

  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('root');
  const [auth, setAuth] = useState<AuthMode>('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function buildRequest(): QuickConnectRequest | null {
    const base = { hostname: hostname.trim(), port: Number(port) || 22, username: username.trim() };
    if (!base.hostname) {
      setError(t('quick.hostRequired'));
      return null;
    }
    if (!base.username) {
      setError(t('quick.usernameRequired'));
      return null;
    }

    if (auth === 'password') {
      if (!password) {
        setError(t('quick.passwordRequired'));
        return null;
      }
      return { ...base, auth: 'password', password };
    }
    if (auth === 'key') {
      if (!privateKey.trim()) {
        setError(t('quick.keyRequired'));
        return null;
      }
      return { ...base, auth: 'key', privateKey, passphrase: passphrase || undefined };
    }
    if (!credentialId) {
      setError(t('quick.credentialRequired'));
      return null;
    }
    return { ...base, auth: 'credential', credentialId };
  }

  async function connect(target: 'terminal' | 'files') {
    setError(null);
    const body = buildRequest();
    if (!body) return;

    setBusy(true);
    try {
      const host = await apiFetch<Host>('/hosts/quick', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (target === 'terminal') openTab(host.id, host.name);
      else openFileTab(host.id, host.name);

      navigate('/');
      // Gizli veri formda kalmasın; bağlantı kurulduktan sonra işi bitti.
      setPassword('');
      setPrivateKey('');
      setPassphrase('');
    } catch (err) {
      setError(apiError(err, 'quick.failed'));
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void connect('terminal');
  }

  return (
    <form onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        <Field label={t('quick.host')}>
          <input
            className="input font-mono text-[12.5px]"
            placeholder={t('quick.hostPlaceholder')}
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            autoFocus
          />
        </Field>

        <Field label={t('quick.port')}>
          <input
            className="input font-mono text-[12.5px]"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </Field>

        <Field label={t('quick.username')}>
          <input
            className="input font-mono text-[12.5px]"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>

        <div>
          <span className="eyebrow mb-1.5 block">{t('quick.auth')}</span>
          <div className="flex gap-1">
            {AUTH_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                className={clsx(
                  'flex-1 rounded border px-2 py-1.5 font-mono text-[11px] transition-colors',
                  auth === mode.value
                    ? 'border-accent text-accent'
                    : 'border-line text-fg-dim hover:border-fg-dim hover:text-fg',
                )}
                onClick={() => setAuth(mode.value)}
                aria-pressed={auth === mode.value}
              >
                {t(mode.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {auth === 'password' && (
          <Field label={t('quick.authPassword')}>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                className="input pr-9 font-mono text-[12.5px]"
                autoComplete="off"
                placeholder={t('quick.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-dim hover:text-fg"
                onClick={() => setShowSecret((v) => !v)}
                aria-label={showSecret ? t('quick.hideSecret') : t('quick.showSecret')}
              >
                {showSecret ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
              </button>
            </div>
          </Field>
        )}

        {auth === 'key' && (
          <>
            <Field label={t('vault.privateKey')}>
              <textarea
                className="input h-28 resize-y font-mono text-[11px]"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <Field label={t('vault.passphrase')}>
              <input
                type="password"
                className="input font-mono text-[12.5px]"
                autoComplete="off"
                placeholder={t('vault.passphrasePlaceholder')}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </Field>
          </>
        )}

        {auth === 'credential' && (
          <Field label={t('quick.vaultEntry')}>
            <select
              className="input text-[12.5px]"
              value={credentialId}
              onChange={(e) => setCredentialId(e.target.value)}
            >
              <option value="">{t('quick.selectPlaceholder')}</option>
              {credentials.data?.map((cred) => (
                <option key={cred.id} value={cred.id}>
                  {cred.name} (
                  {cred.type === 'password' ? t('vault.typePassword') : t('vault.typeKey')})
                </option>
              ))}
            </select>
          </Field>
        )}

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-2.5 py-2 text-[12px] text-danger"
          >
            <AlertCircleIcon size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="space-y-1.5 pt-1">
          <button
            type="submit"
            className="btn btn-primary w-full justify-center font-mono text-[11.5px] uppercase tracking-[0.1em]"
            disabled={busy}
          >
            <TerminalIcon size={13} />
            {t('quick.connectTerminal')}
          </button>
          <button
            type="button"
            className="btn w-full justify-center border-accent/40 font-mono text-[11.5px] uppercase tracking-[0.1em] text-accent"
            onClick={() => void connect('files')}
            disabled={busy}
          >
            <FolderOpenIcon size={13} />
            {t('quick.connectFiles')}
          </button>
        </div>

      <p className="pt-1 text-[11px] leading-relaxed text-fg-dim">{t('quick.notice')}</p>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow mb-1 block">{label}</span>
      {children}
    </label>
  );
}
