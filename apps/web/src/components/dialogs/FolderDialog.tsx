import { useState, type FormEvent } from 'react';
import type { Folder } from '@sshby/shared';
import { FolderPicker } from '@/components/ui/FolderPicker';
import { Modal } from '@/components/ui/Modal';
import { useApiError, useT } from '@/lib/i18n';
import { useCreateFolder, useUpdateFolder } from '@/lib/queries';

/** Klasör renkleri paletle sınırlı: serbest renk seçici koyu temayı bozuyor. */
const COLORS = ['#10B981', '#6E5AE6', '#D8A657', '#E06C6C', '#7DAEA3', '#8A8A8A'];

export function FolderDialog({
  folder,
  folders,
  parentId,
  onClose,
}: {
  /** null = yeni klasör */
  folder: Folder | null;
  /** Üst klasör seçicisini doldurmak için tüm ağaç. */
  folders: Folder[];
  /** Yeni klasörün açılacağı üst klasör; düzenlemede mevcut üst klasör. */
  parentId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const apiError = useApiError();
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();

  const [name, setName] = useState(folder?.name ?? '');
  const [color, setColor] = useState<string | null>(folder?.color ?? null);
  const [parent, setParent] = useState<string | null>(parentId);
  const [error, setError] = useState<string | null>(null);

  const busy = createFolder.isPending || updateFolder.isPending;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (name.trim().length === 0) {
      setError(t('folder.nameRequired'));
      return;
    }

    try {
      if (folder) {
        await updateFolder.mutateAsync({
          id: folder.id,
          name: name.trim(),
          color,
          parentId: parent,
        });
      } else {
        await createFolder.mutateAsync({ name: name.trim(), parentId: parent, color });
      }
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <Modal
      title={folder ? t('folder.editTitle') : t('folder.addTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="folder-form" className="btn btn-primary" disabled={busy}>
            {folder ? t('common.save') : t('common.add')}
          </button>
        </>
      }
    >
      <form id="folder-form" onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">{t('common.name')}</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('folder.namePlaceholder')}
          />
        </label>

        {/*
          Üst klasör seçilebilir olduğu için klasör içinde klasör açmak forma
          girmeden de mümkün: ağaçtaki bir klasörün "alt klasör ekle" eylemi
          burayı önceden doldurur. Düzenlemede aynı alan klasörü başka bir dala
          taşımaya yarar; kendi alt ağacı seçeneklerden çıkarılır.
        */}
        <div>
          <span className="mb-1.5 block text-[13px] font-medium">{t('folder.parent')}</span>
          <FolderPicker
            folders={folders}
            value={parent}
            onChange={setParent}
            excludeSubtreeOf={folder?.id ?? null}
          />
          <span className="mt-1 block text-[12px] text-fg-dim">{t('folder.parentHint')}</span>
        </div>

        <div>
          <span className="mb-2 block text-[13px] font-medium">{t('folder.color')}</span>
          <div className="flex gap-2">
            <button
              type="button"
              className={`h-7 w-7 rounded border ${color === null ? 'border-fg' : 'border-line'}`}
              onClick={() => setColor(null)}
              aria-label={t('folder.noColor')}
              title={t('folder.noColor')}
            />
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`h-7 w-7 rounded border-2 ${color === c ? 'border-fg' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
                aria-label={t('folder.colorAria', { color: c })}
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
