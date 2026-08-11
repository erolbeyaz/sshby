import { useState, type FormEvent } from 'react';
import { AlertCircleIcon, LoaderIcon, ShieldCheckIcon } from 'lucide-react';
import { loginRequestSchema, registerRequestSchema } from '@sshby/shared';
import { Logo } from '@/components/brand/Logo';
import { ApiRequestError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

type Mode = 'login' | 'register';

export function AuthPage() {
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
      setError(
        err instanceof ApiRequestError ? err.message : 'Beklenmeyen bir hata oluştu.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex justify-center">
          <Logo size={30} showCaret />
        </div>

        {firstRun && (
          <div className="mb-5 flex gap-2.5 rounded border border-accent/30 bg-accent-muted px-3.5 py-3 text-[13px] leading-snug">
            <ShieldCheckIcon size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <p>
              İlk kurulum. Oluşturacağınız hesap <strong className="font-medium">yönetici</strong>{' '}
              olacak ve Elasticsearch denetim ayarlarını yapılandırabilecek.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="panel p-6">
          <h1 className="mb-1 text-lg font-semibold">
            {mode === 'register' ? 'Hesap oluştur' : 'Giriş yap'}
          </h1>
          <p className="mb-6 text-[13px] text-fg-dim">
            {mode === 'register'
              ? 'Bu hesapla her yerden oturum açabilirsiniz.'
              : 'Kayıtlı e-posta adresinizle devam edin.'}
          </p>

          <div className="space-y-4">
            <Field label="E-posta" htmlFor="email" error={fieldErrors.email}>
              <input
                id="email"
                type="email"
                className="input"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ad.soyad@sirket.com.tr"
              />
            </Field>

            {mode === 'register' && (
              <Field label="Görünen ad" htmlFor="displayName" error={fieldErrors.displayName}>
                <input
                  id="displayName"
                  type="text"
                  className="input"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ad Soyad"
                />
              </Field>
            )}

            <Field
              label="Parola"
              htmlFor="password"
              error={fieldErrors.password}
              hint={mode === 'register' ? 'En az 12 karakter' : undefined}
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
            {mode === 'register' ? 'Hesap oluştur' : 'Giriş yap'}
          </button>
        </form>

        {!firstRun && (
          <p className="mt-5 text-center text-[13px] text-fg-dim">
            {mode === 'login' ? (
              registrationOpen ? (
                <>
                  Hesabınız yok mu?{' '}
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                      setFieldErrors({});
                    }}
                  >
                    Kayıt olun
                  </button>
                </>
              ) : (
                'Yeni kayıt alımı kapalı. Hesap için yöneticinizle görüşün.'
              )
            ) : (
              <>
                Hesabınız var mı?{' '}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                    setFieldErrors({});
                  }}
                >
                  Giriş yapın
                </button>
              </>
            )}
          </p>
        )}
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
