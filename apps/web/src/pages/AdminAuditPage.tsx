import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  LoaderIcon,
  PlugZapIcon,
  ShieldAlertIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { ApiRequestError, apiFetch } from '@/lib/api';

/**
 * Elasticsearch denetim ayarları (yalnızca admin).
 *
 * Parola ve API anahtarı sunucudan boş dönüyor; boş bırakılan alan "değiştirme"
 * anlamına geliyor. `hasSecret` alanı, kayıtlı bir gizli veri olup olmadığını
 * kullanıcıya gösterebilmek için var.
 */

type AuthType = 'none' | 'basic' | 'apiKey';

interface EsSettings {
  enabled: boolean;
  nodes: string[];
  auth:
    | { type: 'none' }
    | { type: 'basic'; username: string; password: string }
    | { type: 'apiKey'; apiKey: string };
  caCert: string | null;
  insecureSkipTlsVerify: boolean;
  indexPrefix: string;
  retentionDays: number;
  hasSecret: boolean;
}

interface ShipperStatus {
  at: number;
  ok: boolean;
  message: string;
  pendingUnknown: boolean;
  pendingCount: number;
}

export function AdminAuditPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings', 'elasticsearch'],
    queryFn: () => apiFetch<EsSettings>('/settings/elasticsearch'),
  });

  const status = useQuery({
    queryKey: ['settings', 'elasticsearch', 'status'],
    queryFn: () => apiFetch<ShipperStatus>('/settings/elasticsearch/status'),
    refetchInterval: 5_000,
  });

  const [form, setForm] = useState<EsSettings | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Sunucudan gelen ayarı forma bir kez aktar; sonrası kullanıcının.
  useEffect(() => {
    if (settings.data && !form) setForm(settings.data);
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: (body: EsSettings) =>
      apiFetch<EsSettings>('/settings/elasticsearch', {
        method: 'PUT',
        body: JSON.stringify(toPayload(body)),
      }),
    onSuccess: (result) => {
      setForm(result);
      setSaved(true);
      setSaveError(null);
      setTimeout(() => setSaved(false), 2500);
      void queryClient.invalidateQueries({ queryKey: ['settings', 'elasticsearch'] });
    },
    onError: (err) => {
      setSaveError(err instanceof ApiRequestError ? err.message : 'Kaydedilemedi.');
    },
  });

  const test = useMutation({
    mutationFn: (body: EsSettings) =>
      apiFetch<{ ok: boolean; message: string }>('/settings/elasticsearch/test', {
        method: 'POST',
        body: JSON.stringify(toPayload(body)),
      }),
    onSuccess: setTestResult,
    onError: (err) =>
      setTestResult({
        ok: false,
        message: err instanceof ApiRequestError ? err.message : 'Test başarısız.',
      }),
  });

  const retention = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; message: string }>('/settings/elasticsearch/retention', {
        method: 'POST',
      }),
    onSuccess: setTestResult,
  });

  if (settings.isPending || !form) {
    return (
      <p className="flex items-center gap-2 px-8 py-12 font-mono text-[13px] text-fg-dim">
        <LoaderIcon size={14} className="animate-spin" aria-hidden="true" />
        yükleniyor…
      </p>
    );
  }

  function update(patch: Partial<EsSettings>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function setAuthType(type: AuthType) {
    if (type === 'none') update({ auth: { type: 'none' } });
    else if (type === 'basic') update({ auth: { type: 'basic', username: '', password: '' } });
    else update({ auth: { type: 'apiKey', apiKey: '' } });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (form) save.mutate(form);
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-12">
      <p className="eyebrow">Yönetim</p>
      <h1 className="mt-2 text-[28px] font-semibold tracking-tight">Denetim akışı</h1>
      <p className="mt-2 max-w-[60ch] text-fg-dim">
        Denetim olayları her zaman veritabanındaki kuyruğa yazılır. Burada açtığınızda
        arka plandaki gönderici bunları Elasticsearch'e taşır — kapalıyken de hiçbir
        olay kaybolmaz, kuyrukta bekler.
      </p>

      {/* ------------------------------------------------------------ durum */}
      <section className="panel mt-6 flex items-center gap-4 p-4">
        <span
          className={clsx(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            !form.enabled
              ? 'bg-surface-2 text-fg-dim'
              : status.data?.ok
                ? 'bg-accent-muted text-accent'
                : 'bg-danger/15 text-danger',
          )}
          aria-hidden="true"
        >
          <DatabaseIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">
            {!form.enabled
              ? 'Elasticsearch kapalı'
              : status.data?.ok
                ? 'Gönderici çalışıyor'
                : 'Gönderim başarısız'}
          </p>
          <p className="truncate font-mono text-[11.5px] text-fg-dim">
            {status.data?.message ?? '—'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-[18px] font-bold">{status.data?.pendingCount ?? '—'}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
            kuyrukta
          </p>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <label className="flex items-start gap-3 rounded-panel border border-line bg-surface px-4 py-3">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <span className="text-[13px]">
            <span className="font-medium">Elasticsearch'e gönderimi etkinleştir</span>
            <span className="mt-0.5 block text-fg-dim">
              Kapalıyken olaylar kuyrukta birikir; açtığınızda geçmiş kayıtlar da akar.
            </span>
          </span>
        </label>

        <Field label="Düğüm adresleri" hint="Her satıra bir adres">
          <textarea
            className="input h-20 resize-y font-mono text-[12.5px]"
            placeholder="http://elasticsearch:9200"
            value={form.nodes.join('\n')}
            onChange={(e) =>
              update({ nodes: e.target.value.split('\n').map((n) => n.trim()).filter(Boolean) })
            }
            spellCheck={false}
          />
        </Field>

        <div>
          <span className="eyebrow mb-1.5 block">Kimlik doğrulama</span>
          <div className="flex gap-1">
            {(
              [
                ['none', 'Yok'],
                ['basic', 'Kullanıcı/parola'],
                ['apiKey', 'API anahtarı'],
              ] as const
            ).map(([type, label]) => (
              <button
                key={type}
                type="button"
                className={clsx(
                  'flex-1 rounded border px-2 py-1.5 text-[12px] transition-colors',
                  form.auth.type === type
                    ? 'border-accent text-accent'
                    : 'border-line text-fg-dim hover:border-fg-dim hover:text-fg',
                )}
                onClick={() => setAuthType(type)}
                aria-pressed={form.auth.type === type}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {form.auth.type === 'basic' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Kullanıcı adı">
              <input
                className="input font-mono text-[12.5px]"
                value={form.auth.username}
                onChange={(e) =>
                  update({ auth: { type: 'basic', username: e.target.value, password: form.auth.type === 'basic' ? form.auth.password : '' } })
                }
              />
            </Field>
            <Field
              label="Parola"
              hint={form.hasSecret ? 'kayıtlı — değiştirmek için yazın' : undefined}
            >
              <input
                type="password"
                autoComplete="off"
                className="input font-mono text-[12.5px]"
                placeholder={form.hasSecret ? '••••••••' : ''}
                value={form.auth.type === 'basic' ? form.auth.password : ''}
                onChange={(e) =>
                  update({ auth: { type: 'basic', username: form.auth.type === 'basic' ? form.auth.username : '', password: e.target.value } })
                }
              />
            </Field>
          </div>
        )}

        {form.auth.type === 'apiKey' && (
          <Field
            label="API anahtarı"
            hint={form.hasSecret ? 'kayıtlı — değiştirmek için yazın' : undefined}
          >
            <input
              type="password"
              autoComplete="off"
              className="input font-mono text-[12.5px]"
              placeholder={form.hasSecret ? '••••••••' : ''}
              value={form.auth.type === 'apiKey' ? form.auth.apiKey : ''}
              onChange={(e) => update({ auth: { type: 'apiKey', apiKey: e.target.value } })}
            />
          </Field>
        )}

        <Field label="CA sertifikası" hint="Kurum içi CA ile imzalı ES için PEM içeriği">
          <textarea
            className="input h-20 resize-y font-mono text-[11px]"
            placeholder="-----BEGIN CERTIFICATE-----"
            value={form.caCert ?? ''}
            onChange={(e) => update({ caCert: e.target.value.trim() || null })}
            spellCheck={false}
          />
        </Field>

        <label className="flex items-start gap-3 rounded-panel border border-warn/40 bg-warn/10 px-4 py-3">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.insecureSkipTlsVerify}
            onChange={(e) => update({ insecureSkipTlsVerify: e.target.checked })}
          />
          <span className="text-[13px]">
            <span className="flex items-center gap-1.5 font-medium text-warn">
              <ShieldAlertIcon size={13} aria-hidden="true" />
              TLS doğrulamasını atla
            </span>
            <span className="mt-0.5 block text-fg-dim">
              Yalnızca kurulum aşamasında açın. Açıkken denetim trafiği ortadaki adam
              saldırısına karşı korumasız kalır.
            </span>
          </span>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <Field label="İndeks öneki" hint="Günlük indeks: önek-YYYY.AA.GG">
            <input
              className="input font-mono text-[12.5px]"
              value={form.indexPrefix}
              onChange={(e) => update({ indexPrefix: e.target.value })}
            />
          </Field>
          <Field label="Saklama süresi (gün)" hint="0 = otomatik silme yok">
            <input
              className="input font-mono text-[12.5px]"
              inputMode="numeric"
              value={String(form.retentionDays)}
              onChange={(e) => update({ retentionDays: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>

        {testResult && (
          <p
            role="status"
            className={clsx(
              'flex items-start gap-2 rounded border px-3 py-2 text-[12.5px]',
              testResult.ok
                ? 'border-accent/40 bg-accent-muted text-accent'
                : 'border-danger/40 bg-danger/10 text-danger',
            )}
          >
            {testResult.ok ? (
              <CheckCircle2Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircleIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            )}
            {testResult.message}
          </p>
        )}

        {saveError && (
          <p role="alert" className="text-[12.5px] text-danger">
            {saveError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {saved ? 'Kaydedildi' : 'Kaydet'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => form && test.mutate(form)}
            disabled={test.isPending}
          >
            <PlugZapIcon size={13} />
            {test.isPending ? 'Deneniyor…' : 'Bağlantıyı test et'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => retention.mutate()}
            disabled={retention.isPending || !form.enabled}
            title="ILM politikasını ve indeks şablonunu kurar"
          >
            Saklama politikasını uygula
          </button>
        </div>
      </form>
    </div>
  );
}

/** Sunucuya gönderilirken UI'a özel alanlar çıkarılır. */
function toPayload(settings: EsSettings) {
  const { hasSecret: _hasSecret, ...rest } = settings;
  return rest;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-fg-dim">{hint}</span>}
    </label>
  );
}
