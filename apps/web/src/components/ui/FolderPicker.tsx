import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsUpDownIcon, FolderIcon, FolderPlusIcon, SearchIcon } from 'lucide-react';
import clsx from 'clsx';
import type { Folder } from '@sshby/shared';
import { useI18n, useT } from '@/lib/i18n';

/**
 * Klasör seçici: arar, yoksa oluşturur.
 *
 * Düz bir `<select>` iç içe klasörlerde çalışmıyordu — iki farklı dalda aynı
 * adlı klasör olabildiği için seçenekler ayırt edilemiyordu. Burada her klasör
 * tam yoluyla ("Üretim › Veritabanı") listeleniyor ve arama bu yol üzerinde
 * yapılıyor.
 *
 * **Yeni klasör hemen oluşturulmaz.** Seçici yalnızca niyeti taşır
 * (`{ kind: 'new', name }`); klasör, formu kaydeden bileşen tarafından kayıt
 * anında açılır. Önce anında POST atılıyordu ve kullanıcı "Vazgeç" dese bile
 * klasör envanterde kalıyordu — formu iptal etmek hiçbir yan etki
 * bırakmamalı.
 */

export type FolderSelection =
  | { kind: 'existing'; id: string | null }
  /** Kayıt anında açılacak klasör; `parentId` seçiliyken altına açılır. */
  | { kind: 'new'; name: string; parentId: string | null };

export interface FolderOption {
  id: string;
  /** "Üretim › Veritabanı" — kök seviyeden itibaren tam yol. */
  path: string;
}

/** Klasörleri tam yollarıyla, ağaç sırasında düzleştirir. */
export function flattenFolders(folders: Folder[]): FolderOption[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const list = byParent.get(folder.parentId) ?? [];
    list.push(folder);
    byParent.set(folder.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortIndex - b.sortIndex || a.name.localeCompare(b.name));
  }

  const out: FolderOption[] = [];
  const walk = (parentId: string | null, prefix: string): void => {
    for (const folder of byParent.get(parentId) ?? []) {
      const path = prefix ? `${prefix} › ${folder.name}` : folder.name;
      out.push({ id: folder.id, path });
      walk(folder.id, path);
    }
  };
  walk(null, '');
  return out;
}

export function FolderPicker({
  folders,
  value,
  onChange,
  /** Bu klasör ve alt ağacı seçeneklerden çıkarılır (klasörü kendi içine taşıma). */
  excludeSubtreeOf,
}: {
  folders: Folder[];
  value: FolderSelection;
  onChange: (selection: FolderSelection) => void;
  excludeSubtreeOf?: string | null;
}) {
  const t = useT();
  const { lang } = useI18n();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const options = useMemo(() => {
    const all = flattenFolders(folders);
    if (!excludeSubtreeOf) return all;

    // Bir klasör kendi alt ağacına taşınamaz; o dalın tamamı listeden düşer.
    const banned = new Set<string>([excludeSubtreeOf]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of folders) {
        if (folder.parentId && banned.has(folder.parentId) && !banned.has(folder.id)) {
          banned.add(folder.id);
          grew = true;
        }
      }
    }
    return all.filter((o) => !banned.has(o.id));
  }, [folders, excludeSubtreeOf]);

  const needle = query.trim().toLocaleLowerCase(lang);
  const filtered = needle
    ? options.filter((o) => o.path.toLocaleLowerCase(lang).includes(needle))
    : options;

  const exactExists = options.some(
    (o) =>
      o.path.toLocaleLowerCase(lang) === needle ||
      o.path.split(' › ').pop()?.toLocaleLowerCase(lang) === needle,
  );
  const canCreate = needle.length > 0 && !exactExists;

  const selectedId = value.kind === 'existing' ? value.id : null;
  const selectedOption = options.find((o) => o.id === selectedId) ?? null;

  const label =
    value.kind === 'new'
      ? t('folderPicker.pendingNew', { name: value.name })
      : (selectedOption?.path ?? t('folderPicker.none'));

  function stageNew() {
    /**
     * Yeni klasör, o an seçili olan klasörün altına açılacak: kullanıcı bir
     * dalı seçtikten sonra "yeni" derse kastettiği o dalın altıdır.
     */
    onChange({ kind: 'new', name: query.trim(), parentId: selectedId });
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="input flex items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className={clsx(
            'truncate',
            value.kind === 'new' ? 'text-accent' : !selectedOption && 'text-fg-dim',
          )}
        >
          {label}
        </span>
        <ChevronsUpDownIcon size={13} className="shrink-0 text-fg-dim" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded border border-line bg-surface shadow-xl shadow-black/50">
          <div className="relative border-b border-line">
            <SearchIcon
              size={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-dim"
              aria-hidden="true"
            />
            <input
              autoFocus
              className="w-full bg-transparent py-2 pl-7 pr-2.5 text-[12.5px] outline-none placeholder:text-fg-dim"
              placeholder={t('folderPicker.searchOrCreate')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCreate) {
                  e.preventDefault();
                  stageNew();
                }
              }}
            />
          </div>

          <ul className="max-h-56 overflow-y-auto py-1" role="listbox">
            <li>
              <Option
                label={t('folderPicker.none')}
                selected={value.kind === 'existing' && value.id === null}
                onClick={() => {
                  onChange({ kind: 'existing', id: null });
                  setOpen(false);
                }}
              />
            </li>
            {filtered.map((option) => (
              <li key={option.id}>
                <Option
                  label={option.path}
                  selected={selectedId === option.id}
                  onClick={() => {
                    onChange({ kind: 'existing', id: option.id });
                    setOpen(false);
                  }}
                />
              </li>
            ))}

            {canCreate && (
              <li className="mt-1 border-t border-line pt-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] text-accent transition-colors hover:bg-surface-2"
                  onClick={stageNew}
                >
                  <FolderPlusIcon size={12} className="shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {t('folderPicker.create', { name: query.trim() })}
                  </span>
                </button>
              </li>
            )}

            {filtered.length === 0 && !canCreate && (
              <li className="px-2.5 py-3 text-center text-[12px] text-fg-dim">
                {t('folderPicker.noMatch')}
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Kullanıcı klasörün henüz açılmadığını bilmeli: "Vazgeç" hiçbir iz bırakmaz. */}
      {value.kind === 'new' && (
        <span className="mt-1 block text-[12px] text-accent">
          {t('folderPicker.pendingHint')}
        </span>
      )}
    </div>
  );
}

function Option({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={clsx(
        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
        selected ? 'bg-accent-muted text-accent' : 'text-fg-dim hover:bg-surface-2 hover:text-fg',
      )}
      onClick={onClick}
    >
      <FolderIcon size={12} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
}
