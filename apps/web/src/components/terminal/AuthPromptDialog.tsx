import { useState, type FormEvent } from 'react';
import { AlertCircleIcon, LockIcon } from 'lucide-react';
import type { ServerTerminalMessage } from '@sshby/shared';

type Prompt = Extract<ServerTerminalMessage, { type: 'auth_prompt' }>;

/**
 * Kasada kaydı olmayan sunucular için tek seferlik parola istemi.
 *
 * Parola hiçbir yere yazılmaz: ne kasaya, ne denetime, ne tarayıcı deposuna.
 * Yalnızca bu bağlantı için sunucuya iletilir. Tek seferlik erişimlerde
 * kullanıcıyı kasaya kayıt eklemeye zorlamak, gereğinden fazla gizli veri
 * biriktirmek anlamına gelirdi.
 */
export function AuthPromptDialog({
  prompt,
  onSubmit,
  onCancel,
}: {
  prompt: Prompt;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(password);
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 px-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Parola gerekli"
        className="w-full max-w-md rounded-panel border border-line bg-surface shadow-2xl shadow-black/50"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <LockIcon size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">Parola gerekli</h2>
            <p className="mt-0.5 truncate font-mono text-[12.5px] text-fg-dim">
              {prompt.hostLabel}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {prompt.retry && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger"
            >
              <AlertCircleIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              Sunucu parolayı kabul etmedi. Tekrar deneyin.
            </p>
          )}

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">
              <span className="font-mono">{prompt.username}</span> kullanıcısının parolası
            </span>
            <input
              type="password"
              autoFocus
              autoComplete="off"
              className="input font-mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <p className="text-[12px] leading-relaxed text-fg-dim">
            Bu parola kaydedilmez; yalnızca bu bağlantı için kullanılır. Her seferinde
            sormasını istemiyorsanız kasaya bir kayıt ekleyip sunucuya atayabilirsiniz.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn" onClick={onCancel}>
              Vazgeç
            </button>
            <button type="submit" className="btn btn-primary">
              Bağlan
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
