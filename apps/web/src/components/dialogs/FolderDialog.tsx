import { useState, type FormEvent } from 'react';
import type { Folder } from '@sshby/shared';
import { Modal } from '@/components/ui/Modal';
import { ApiRequestError } from '@/lib/api';
import { useCreateFolder, useUpdateFolder } from '@/lib/queries';

/** Klasör renkleri paletle sınırlı: serbest renk seçici koyu temayı bozuyor. */
const COLORS = ['#10B981', '#6E5AE6', '#D8A657', '#E06C6C', '#7DAEA3', '#8A8A8A'];

export function FolderDialog({
  folder,
  parentId,
  onClose,
}: {
  /** null = yeni klasör */
  folder: Folder | null;
  parentId: string | null;
  onClose: () => void;
}) {
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();

  const [name, setName] = useState(folder?.name ?? '');
  const [color, setColor] = useState<string | null>(folder?.color ?? null);
  const [error, setError] = useState<string | null>(null);

  const busy = createFolder.isPending || updateFolder.isPending;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (name.trim().length === 0) {
      setError('Klasör adı boş olamaz.');
      return;
    }

    try {
      if (folder) await updateFolder.mutateAsync({ id: folder.id, name: name.trim(), color });
      else await createFolder.mutateAsync({ name: name.trim(), parentId, color });
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Beklenmeyen bir hata oluştu.');
    }
  }

  return (
    <Modal
      title={folder ? 'Klasörü düzenle' : 'Klasör ekle'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Vazgeç
          </button>
          <button type="submit" form="folder-form" className="btn btn-primary" disabled={busy}>
            {folder ? 'Kaydet' : 'Ekle'}
          </button>
        </>
      }
    >
      <form id="folder-form" onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">Ad</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Üretim"
          />
        </label>

        <div>
          <span className="mb-2 block text-[13px] font-medium">Renk</span>
          <div className="flex gap-2">
            <button
              type="button"
              className={`h-7 w-7 rounded border ${color === null ? 'border-fg' : 'border-line'}`}
              onClick={() => setColor(null)}
              aria-label="Renksiz"
              title="Renksiz"
            />
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`h-7 w-7 rounded border-2 ${color === c ? 'border-fg' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
                aria-label={`Renk ${c}`}
              />
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
