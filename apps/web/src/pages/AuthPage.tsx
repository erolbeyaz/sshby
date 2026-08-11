import { useState, type FormEvent } from 'react';
import { AlertCircleIcon, LoaderIcon, ShieldCheckIcon } from 'lucide-react';
import { loginRequestSchema, registerRequestSchema } from '@sshby/shared';
import { Logo } from '@/components/brand/Logo';
import { Signature } from '@/components/layout/Signature';
import { useAuthStore } from '@/lib/auth-store';
import { useApiError, useT } from '@/lib/i18n';
import { useDocumentTitle } from '@/lib/use-document-title';

type Mode = 'login' | 'register';

export function AuthPage() {
  const t = useT();
  const apiError = useApiError();
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);

  const firstRun = bootstrap?.firstRun ?? false;
  const registrationOpen = bootstrap?.registrationOpen ?? false;

  const [mode, setMode] = useState<Mode>(firstRun ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useDocumentTitle(mode === 'register' ? 'Create account' : 'Sign in');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    // Sunucuyla aynı zod şemasını kullanıyoruz: kurallar tek yerde tanımlı,
    // istemci ile sunucu birbirinden ayrışamıyor.
    const schema = mode === 'register' ? registerRequestSchema : loginRequestSchema;
    const parsed = schema.safeParse(
      mode === 'register' ? { email, displayName, password } : { email, password },
    );
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setBusy(true);
    try {
      if (mode === 'register') {
        await register({ email, displayName, password });
      } else {
        await login({ email, password });
      }
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex justify-center">
          <Logo size={30} showCaret />
        </div>

        {firstRun && (
          <div className="mb-5 flex gap-2.5 rounded border border-accent/30 bg-accent-muted px-3.5 py-3 text-[13px] leading-snug">
            <ShieldCheckIcon size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <p>{t('auth.firstRunNotice')}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="panel p-6">
          <h1 className="mb-1 text-lg font-semibold">
            {mode === 'register' ? t('auth.createAccount') : t('auth.signIn')}
          </h1>
          <p className="mb-6 text-[13px] text-fg-dim">
            {mode === 'register' ? t('auth.createAccountHint') : t('auth.signInHint')}
          </p>

          <div className="space-y-4">
            <Field label={t('auth.email')} htmlFor="email" error={fieldErrors.email}>
              <input
                id="email"
                type="email"
                className="input"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name.surname@example.com"
              />
            </Field>

            {mode === 'register' && (
              <Field
                label={t('auth.displayName')}
                htmlFor="displayName"
                error={fieldErrors.displayName}
              >
                <input
                  id="displayName"
                  type="text"
                  className="input"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t('auth.displayNamePlaceholder')}
                />
              </Field>
            )}

            <Field
              label={t('common.password')}
              htmlFor="password"
              error={fieldErrors.password}
              hint={mode === 'register' ? t('auth.passwordHint') : undefined}
            >
              <input
                id="password"
                type="password"
                className="input"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger"
            >
              <AlertCircleIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary mt-6 w-full" disabled={busy}>
            {busy && <LoaderIcon size={14} className="animate-spin" aria-hidden="true" />}
            {mode === 'register' ? t('auth.createAccount') : t('auth.signIn')}
          </button>
        </form>

        {!firstRun && (
          <p className="mt-5 text-center text-[13px] text-fg-dim">
            {mode === 'login' ? (
              registrationOpen ? (
                <>
                  {t('auth.noAccount')}{' '}
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                      setFieldErrors({});
                    }}
                  >
                    {t('auth.signUpLink')}
                  </button>
                </>
              ) : (
                t('auth.registrationClosed')
              )
            ) : (
              <>
                {t('auth.haveAccount')}{' '}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                    setFieldErrors({});
                  }}
                >
                  {t('auth.signInLink')}
                </button>
              </>
            )}
          </p>
        )}
      </div>

      <div className="mt-10">
        <Signature />
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-[12px] text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[12px] text-fg-dim">{hint}</p>
      ) : null}
    </div>
  );
}
