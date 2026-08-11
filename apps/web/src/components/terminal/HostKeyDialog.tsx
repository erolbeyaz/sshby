import { ShieldAlertIcon, ShieldQuestionIcon } from 'lucide-react';
import type { ServerTerminalMessage } from '@sshby/shared';
import { useT } from '@/lib/i18n';

type Prompt = Extract<ServerTerminalMessage, { type: 'hostkey_prompt' }>;

/**
 * Host anahtarı onayı.
 *
 * İki farklı durumu bilerek çok farklı gösteriyoruz: ilk bağlantı sıradan bir
 * onaydır, anahtar değişimi ise olası bir saldırı işaretidir. Aynı görünümde
 * sunmak kullanıcıyı ikincisini de refleksle onaylamaya iter.
 */
export function HostKeyDialog({
  prompt,
  onAccept,
  onReject,
}: {
  prompt: Prompt;
  onAccept: () => void;
  onReject: () => void;
}) {
  const t = useT();
  const changed = prompt.knownFingerprint !== null;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 px-4 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={changed ? t('hostkey.changedAria') : t('hostkey.firstAria')}
        className={`w-full max-w-lg rounded-panel border bg-surface shadow-2xl shadow-black/50 ${
          changed ? 'border-danger/60' : 'border-line'
        }`}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          {changed ? (
            <ShieldAlertIcon size={20} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          ) : (
            <ShieldQuestionIcon size={20} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
          )}
          <div>
            <h2 className={`text-[15px] font-semibold ${changed ? 'text-danger' : ''}`}>
              {changed ? t('hostkey.changedTitle') : t('hostkey.firstTitle')}
            </h2>
            <p className="mt-0.5 font-mono text-[12.5px] text-fg-dim">{prompt.hostLabel}</p>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          {changed ? (
            <p className="text-[13px] leading-relaxed">{t('hostkey.changedBody')}</p>
          ) : (
            <p className="text-[13px] leading-relaxed">
              {t('hostkey.firstBody')}{' '}
              <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11.5px]">
                ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
              </code>
            </p>
          )}

          <dl className="space-y-2 rounded border border-line bg-bg px-4 py-3 font-mono text-[12px]">
            {changed && (
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-fg-dim">
                  {t('hostkey.previouslyAccepted')}
                </dt>
                <dd className="mt-0.5 break-all text-fg-dim line-through">
                  {prompt.knownFingerprint}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-fg-dim">
                {changed ? t('hostkey.nowOffered') : t('hostkey.fingerprint')} · {prompt.algorithm}
              </dt>
              <dd className={`mt-0.5 break-all ${changed ? 'text-danger' : 'text-fg'}`}>
                {prompt.fingerprint}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <button type="button" className="btn" onClick={onReject}>
            {t('hostkey.reject')}
          </button>
          <button
            type="button"
            className={changed ? 'btn border-danger/50 text-danger hover:bg-danger/10' : 'btn btn-primary'}
            onClick={onAccept}
          >
            {changed ? t('hostkey.acceptRisk') : t('hostkey.trust')}
          </button>
        </div>
      </div>
    </div>
  );
}
