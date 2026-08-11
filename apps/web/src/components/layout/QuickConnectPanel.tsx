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
import { ApiRequestError, apiFetch } from '@/lib/api';
import { useCredentials } from '@/lib/queries';
import { useTerminalStore } from '@/lib/terminal-store';

type AuthMode = 'password' | 'key' | 'credential';

/**
 * Hızlı bağlantı — envantere kaydetmeden tek seferlik erişim.
 *
 * Sunucu tarafında `ephemeral` işaretli geçici bir kayıt oluşuyor; böylece
 * terminal, dosya gezgini, metrikler ve denetim hiçbir değişiklik olmadan
 * çalışıyor. Kayıt 24 saat kullanılmazsa siliniyor.
 */
export function QuickConnectPanel({ onClose }: { onClose: () => void }) {
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
      setError('Ana bilgisayar adresi gerekli.');
      return null;
    }
    if (!base.username) {
      setError('Kullanıcı adı gerekli.');
      return null;
    }

    if (auth === 'password') {
      if (!password) {
        setError('Parola gerekli.');
        return null;
      }
      return { ...base, auth: 'password', password };
    }
    if (auth === 'key') {
      if (!privateKey.trim()) {
        setError('Özel anahtar gerekli.');
        return null;
      }
      return { ...base, auth: 'key', privateKey, passphrase: passphrase || undefined };
    }
    if (!credentialId) {
      setError('Kasadan bir kayıt seçin.');
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
      setError(err instanceof ApiRequestError ? err.message : 'Bağlantı oluşturulamadı.');
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void connect('terminal');
  }

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3.5">
        <ZapIcon size={15} className="shrink-0 text-accent" aria-hidden="true" />
        <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Hızlı bağlantı</h2>
        <button
          type="button"
          className="btn-ghost rounded p-1.5"
          onClick={onClose}
          aria-label="Hızlı bağlantı panelini kapat"
        >
          <ChevronLeftIcon size={15} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        <Field label="Ana bilgisayar">
          <input
            className="input font-mono text-[12.5px]"
            placeholder="192.168.1.1 veya example.com"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            autoFocus
          />
        </Field>

        <Field label="Bağlantı noktası">
          <input
            className="input font-mono text-[12.5px]"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </Field>

        <Field label="Kullanıcı adı">
          <input
            className="input font-mono text-[12.5px]"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>

        <div>
          <span className="eyebrow mb-1.5 block">Kimlik doğrulama</span>
          <div className="flex gap-1">
            {(
              [
                ['password', 'Parola'],
                ['key', 'Anahtar'],
                ['credential', 'Kasa'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={clsx(
                  'flex-1 rounded border px-2 py-1.5 font-mono text-[11px] transition-colors',
                  auth === mode
                    ? 'border-accent text-accent'
                    : 'border-line text-fg-dim hover:border-fg-dim hover:text-fg',
                )}
                onClick={() => setAuth(mode)}
                aria-pressed={auth === mode}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {auth === 'password' && (
          <Field label="Parola">
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                className="input pr-9 font-mono text-[12.5px]"
                autoComplete="off"
                placeholder="parola"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-dim hover:text-fg"
                onClick={() => setShowSecret((v) => !v)}
                aria-label={showSecret ? 'Parolayı gizle' : 'Parolayı göster'}
              >
                {showSecret ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
              </button>
            </div>
          </Field>
        )}

        {auth === 'key' && (
          <>
            <Field label="Özel anahtar">
              <textarea
                className="input h-28 resize-y font-mono text-[11px]"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <Field label="Anahtar parolası">
              <input
                type="password"
                className="input font-mono text-[12.5px]"
                autoComplete="off"
                placeholder="anahtar korumalıysa"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </Field>
          </>
        )}

        {auth === 'credential' && (
          <Field label="Kasadaki kayıt">
            <select
              className="input text-[12.5px]"
              value={credentialId}
              onChange={(e) => setCredentialId(e.target.value)}
            >
              <option value="">— seçin —</option>
              {credentials.data?.map((cred) => (
                <option key={cred.id} value={cred.id}>
                  {cred.name} ({cred.type === 'password' ? 'parola' : 'anahtar'})
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
            Terminale bağlan
          </button>
          <button
            type="button"
            className="btn w-full justify-center border-accent/40 font-mono text-[11.5px] uppercase tracking-[0.1em] text-accent"
            onClick={() => void connect('files')}
            disabled={busy}
          >
            <FolderOpenIcon size={13} />
            Dosyalara bağlan
          </button>
        </div>

        <p className="pt-1 text-[11px] leading-relaxed text-fg-dim">
          Bu bağlantı envantere eklenmez. Girdiğiniz gizli veri kasadakiyle aynı şifrelemeyle
          geçici olarak saklanır ve 24 saat kullanılmazsa silinir.
        </p>
      </form>
    </aside>
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
