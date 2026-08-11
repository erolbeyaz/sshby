import { useState, type FormEvent } from 'react';
import { AlertCircleIcon, EyeIcon, EyeOffIcon, ShieldIcon, XIcon } from 'lucide-react';
import { useT } from '@/lib/i18n';

/**
 * Yönetici parolası istemi.
 *
 * Arka planı bulanıklaştırıyor: kullanıcı bir yetki sınırına çarptığında
 * dikkatin tamamen buraya gelmesi gerekiyor, arkadaki dosya listesi o an
 * eyleme dönüştürülebilir bilgi taşımıyor.
 */
export function SudoPrompt({
  hostName,
  error,
  busy,
  onSubmit,
  onCancel,
}: {
  hostName: string;
  error: string | null;
  busy: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password) onSubmit(password);
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/70 px-6 backdrop-blur-md">
      <div className="w-full max-w-md rounded-panel border border-line bg-surface shadow-2xl shadow-black/60">
        <div className="flex items-start gap-2.5 px-5 pb-1 pt-4">
          <ShieldIcon size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <h2 className="flex-1 font-mono text-[12px] font-semibold uppercase tracking-[0.14em]">
            {t('sudo.title')}
          </h2>
          <button
            type="button"
            className="btn-ghost -mt-1 rounded p-1"
            onClick={onCancel}
            aria-label={t('common.close')}
          >
            <XIcon size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 pb-5">
          <p className="mb-4 text-[12.5px] leading-relaxed text-fg-dim">
            {t('sudo.body', { host: hostName })}
          </p>

          <div className="relative">
            <input
              autoFocus
              type={visible ? 'text' : 'password'}
              autoComplete="off"
              className="input pr-10 font-mono"
              placeholder={t('sudo.placeholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label={t('sudo.placeholder')}
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-dim hover:text-fg"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? t('quick.hideSecret') : t('quick.showSecret')}
            >
              {visible ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
            </button>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-3 flex items-start gap-2 text-[12.5px] text-danger"
            >
              <AlertCircleIcon size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              className="btn-ghost rounded px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-[0.12em]"
              onClick={onCancel}
              disabled={busy}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-primary font-mono text-[11.5px] uppercase tracking-[0.12em]"
              disabled={busy || password.length === 0}
            >
              {busy ? t('sudo.verifying') : t('sudo.confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
