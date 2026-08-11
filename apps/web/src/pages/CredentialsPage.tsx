import { useState, type FormEvent } from 'react';
import { AlertCircleIcon, KeyRoundIcon, LoaderIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type { CredentialSummary } from '@sshby/shared';
import { Modal } from '@/components/ui/Modal';
import { ApiRequestError } from '@/lib/api';
import { useCreateCredential, useCredentials, useDeleteCredential } from '@/lib/queries';

export function CredentialsPage() {
  const credentials = useCredentials();
  const deleteCredential = useDeleteCredential();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CredentialSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteCredential.mutateAsync(pendingDelete.id);
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Silinemedi.');
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Kasa</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight">Kimlik bilgileri</h1>
          <p className="mt-2 max-w-[56ch] text-fg-dim">
            Parolalar ve SSH anahtarları AES-256-GCM ile şifrelenerek saklanır. Kaydedildikten
            sonra hiçbir ekrandan geri okunamaz — yalnızca üzerine yazılabilir.
          </p>
        </div>
        <button type="button" className="btn btn-primary shrink-0" onClick={() => setDialogOpen(true)}>
          <PlusIcon size={14} />
          Ekle
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-5 flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger"
        >
          <AlertCircleIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <section className="mt-8">
        {credentials.isPending && (
          <p className="flex items-center gap-2 font-mono text-[13px] text-fg-dim">
            <LoaderIcon size={14} className="animate-spin" aria-hidden="true" />
            yükleniyor…
          </p>
        )}

        {credentials.data?.length === 0 && (
          <div className="panel flex flex-col items-center gap-3 px-6 py-12 text-center">
            <KeyRoundIcon size={22} className="text-fg-dim/50" aria-hidden="true" />
            <p className="text-[13px] text-fg-dim">
              Kasa boş. Sunuculara bağlanabilmek için önce bir kimlik bilgisi ekleyin.
            </p>
          </div>
        )}

        <ul className="space-y-2">
          {credentials.data?.map((cred) => (
            <li
              key={cred.id}
              className="flex items-center gap-4 rounded-panel border border-line bg-surface px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium">{cred.name}</span>
                  <span className="pill">{cred.type === 'password' ? 'parola' : 'anahtar'}</span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11.5px] text-fg-dim">
                  {cred.publicFingerprint ?? (cred.username ? `kullanıcı: ${cred.username}` : '—')}
                </div>
              </div>

              <span className="shrink-0 font-mono text-[11.5px] text-fg-dim">
                {cred.usedByHostCount} sunucu
              </span>

              <button
                type="button"
                className="btn-ghost shrink-0 rounded p-1.5 hover:text-danger"
                onClick={() => setPendingDelete(cred)}
                aria-label={`${cred.name} sil`}
              >
                <Trash2Icon size={14} />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {dialogOpen && <CredentialDialog onClose={() => setDialogOpen(false)} />}

      {pendingDelete && (
        <Modal
          title="Kimlik bilgisini sil"
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPendingDelete(null)}>
                Vazgeç
              </button>
              <button
                type="button"
                className="btn border-danger/50 text-danger hover:bg-danger/10"
                onClick={() => void confirmDelete()}
                disabled={deleteCredential.isPending}
              >
                Sil
              </button>
            </>
          }
        >
          <p className="text-[13px] leading-relaxed">
            <strong className="font-medium">{pendingDelete.name}</strong> silinecek. Bu işlem geri
            alınamaz.
            {pendingDelete.usedByHostCount > 0 && (
              <span className="mt-3 block rounded border border-warn/40 bg-warn/10 px-3 py-2 text-warn">
                Bu kimlik bilgisini {pendingDelete.usedByHostCount} sunucu kullanıyor. Silindiğinde
                o sunucular bağlanamaz hâle gelir.
              </span>
            )}
          </p>
        </Modal>
      )}
    </div>
  );
}

function CredentialDialog({ onClose }: { onClose: () => void }) {
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
      setError(err instanceof ApiRequestError ? err.message : 'Kaydedilemedi.');
    }
  }

  return (
    <Modal
      title="Kimlik bilgisi ekle"
      description="Girdiğiniz gizli veri şifrelenerek saklanır ve bir daha gösterilmez."
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button
            type="submit"
            form="credential-form"
            className="btn btn-primary"
            disabled={createCredential.isPending}
          >
            Kaydet
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
              {option === 'password' ? 'Parola' : 'SSH anahtarı'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">Ad</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="üretim-root"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">Varsayılan SSH kullanıcısı</span>
            <input
              className="input font-mono"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="root"
            />
            <span className="mt-1 block text-[12px] text-fg-dim">
              Sunucularda kullanıcı adı boş bırakılırsa bu kullanılır.
            </span>
          </label>
        </div>

        {type === 'password' ? (
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">Parola</span>
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
              <span className="mb-1.5 block text-[13px] font-medium">Özel anahtar</span>
              <textarea
                className="input h-40 resize-y font-mono text-[12px]"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                spellCheck={false}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">Anahtar parolası</span>
              <input
                type="password"
                className="input font-mono"
                autoComplete="new-password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="anahtar korumalıysa"
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
