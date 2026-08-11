import { useRef, useState } from 'react';
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FileJsonIcon,
  LockIcon,
  UploadIcon,
} from 'lucide-react';
import {
  configPackageSchema,
  type ConfigImportResult,
  type ConfigPackage,
  type ConfigSecretMode,
  type ImportConflictStrategy,
  type ImportCounts,
} from '@sshby/shared';
import { Modal } from '@/components/ui/Modal';
import { useApiError, useI18n, useT, localeTag, type TranslationKey } from '@/lib/i18n';
import { useExportConfig, useImportConfig } from '@/lib/queries';

/**
 * Yapılandırma taşıma.
 *
 * Ayrı bir sayfa değil, hesap menüsünden açılan bir diyalog: taşınan şey
 * kullanıcının **kendi** envanteri ve kasası, yani bir uygulama bölümü değil
 * hesap işlemi. Her kullanıcı yalnızca kendi verisini dışa aktarır; sunucu
 * tarafındaki sorgular zaten sahiplik filtresiyle çalışıyor.
 *
 * Dışa aktarımda gizli verinin pakete girip girmeyeceği kullanıcının bilinçli
 * seçimi: paket bir dosya olarak dışarı çıkıyor ve o andan sonra erişimini
 * denetleyemiyoruz.
 */
export function ConfigTransferDialog({ onClose }: { onClose: () => void }) {
  const t = useT();

  return (
    <Modal title={t('config.title')} description={t('config.description')} onClose={onClose} wide>
      <ExportSection />
      <div className="my-6 border-t border-line" />
      <ImportSection />
    </Modal>
  );
}

// ----------------------------------------------------------------- dışa aktarma

function ExportSection() {
  const t = useT();
  const apiError = useApiError();
  const exportConfig = useExportConfig();
  const [mode, setMode] = useState<ConfigSecretMode>('excluded');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function handleExport() {
    setError(null);
    setDone(null);

    if (mode === 'encrypted') {
      if (password.length < 12) {
        setError(t('config.passwordTooShort'));
        return;
      }
      if (password !== repeat) {
        setError(t('config.passwordMismatch'));
        return;
      }
    }

    try {
      const pkg = await exportConfig.mutateAsync(
        mode === 'encrypted' ? { secrets: 'encrypted', password } : { secrets: 'excluded' },
      );

      /**
       * Dosya tarayıcıda oluşturuluyor: sunucudan `Content-Disposition` ile
       * indirtmek, parolayı taşıyan isteği bir gezinme hâline getirir ve hata
       * durumunda kullanıcı JSON hata gövdesini indirmiş olurdu.
       */
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sshby-config-${stamp}.json`;
      link.click();
      URL.revokeObjectURL(url);

      setPassword('');
      setRepeat('');
      setDone(
        t('config.exportDone', {
          folders: pkg.folders.length,
          hosts: pkg.hosts.length,
          credentials: pkg.credentials.length,
        }),
      );
    } catch (err) {
      setError(apiError(err, 'config.exportFailed'));
    }
  }

  return (
    <section>
      <h3 className="flex items-center gap-2 text-[14px] font-semibold">
        <DownloadIcon size={14} className="text-fg-dim" aria-hidden="true" />
        {t('config.export')}
      </h3>

      <div className="mt-3 space-y-2">
        <ModeOption
          selected={mode === 'excluded'}
          onSelect={() => setMode('excluded')}
          titleKey="config.modeExcluded"
          descriptionKey="config.modeExcludedDesc"
        />
        <ModeOption
          selected={mode === 'encrypted'}
          onSelect={() => setMode('encrypted')}
          titleKey="config.modeEncrypted"
          descriptionKey="config.modeEncryptedDesc"
        />
      </div>

      {mode === 'encrypted' && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">
                {t('config.packagePassword')}
              </span>
              <input
                type="password"
                className="input font-mono"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <span className="mt-1 block text-[12px] text-fg-dim">
                {t('config.packagePasswordHint')}
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">
                {t('config.passwordRepeat')}
              </span>
              <input
                type="password"
                className="input font-mono"
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </label>
          </div>

          <p className="mt-4 flex items-start gap-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
            <LockIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t('config.encryptedWarning')}
          </p>
        </>
      )}

      {error && <ErrorLine message={error} />}
      {done && (
        <p className="mt-4 flex items-start gap-2 rounded border border-accent/40 bg-accent-muted px-3 py-2 text-[13px] text-accent">
          <CheckCircle2Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {done}
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary mt-4"
        onClick={() => void handleExport()}
        disabled={exportConfig.isPending}
      >
        <DownloadIcon size={14} />
        {exportConfig.isPending ? t('config.preparing') : t('config.download')}
      </button>
    </section>
  );
}

// ------------------------------------------------------------------ içe aktarma

const STRATEGIES: {
  value: ImportConflictStrategy;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
}[] = [
  {
    value: 'rename',
    titleKey: 'config.strategyRename',
    descriptionKey: 'config.strategyRenameDesc',
  },
  { value: 'skip', titleKey: 'config.strategySkip', descriptionKey: 'config.strategySkipDesc' },
  {
    value: 'overwrite',
    titleKey: 'config.strategyOverwrite',
    descriptionKey: 'config.strategyOverwriteDesc',
  },
];

function ImportSection() {
  const t = useT();
  const { lang } = useI18n();
  const apiError = useApiError();
  const importConfig = useImportConfig();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pkg, setPkg] = useState<ConfigPackage | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [strategy, setStrategy] = useState<ImportConflictStrategy>('rename');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConfigImportResult | null>(null);

  async function handleFile(file: File): Promise<void> {
    setError(null);
    setResult(null);
    setPkg(null);
    setFileName(file.name);

    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setError(t('config.invalidJson'));
      return;
    }

    /**
     * Paket sunucuya gönderilmeden önce burada da doğrulanıyor. Aynı zod
     * şeması iki tarafta da çalıştığı için kullanıcı, yanlış dosyayı seçtiğini
     * ağ turu beklemeden öğreniyor.
     */
    const parsed = configPackageSchema.safeParse(raw);
    if (!parsed.success) {
      setError(t('config.invalidPackage'));
      return;
    }
    setPkg(parsed.data);
  }

  async function handleImport() {
    if (!pkg) return;
    setError(null);
    setResult(null);

    if (pkg.secrets === 'encrypted' && !password) {
      setError(t('config.needPassword'));
      return;
    }

    try {
      setResult(
        await importConfig.mutateAsync({
          package: pkg,
          password: pkg.secrets === 'encrypted' ? password : undefined,
          conflictStrategy: strategy,
        }),
      );
      setPassword('');
    } catch (err) {
      setError(apiError(err, 'config.importFailed'));
    }
  }

  return (
    <section>
      <h3 className="flex items-center gap-2 text-[14px] font-semibold">
        <UploadIcon size={14} className="text-fg-dim" aria-hidden="true" />
        {t('config.import')}
      </h3>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          // Aynı dosyayı ikinci kez seçmek de olay üretsin.
          e.target.value = '';
        }}
      />

      <button type="button" className="btn mt-3" onClick={() => fileInput.current?.click()}>
        <FileJsonIcon size={14} />
        {fileName ? t('config.pickAnotherFile') : t('config.pickFile')}
      </button>
      {fileName && <span className="ml-3 font-mono text-[12px] text-fg-dim">{fileName}</span>}

      {pkg && (
        <>
          <dl className="mt-4 grid grid-cols-4 gap-3">
            <Stat labelKey="config.statFolders" value={pkg.folders.length} />
            <Stat labelKey="config.statHosts" value={pkg.hosts.length} />
            <Stat labelKey="config.statCredentials" value={pkg.credentials.length} />
            <Stat
              labelKey="config.statSecrets"
              value={t(pkg.secrets === 'encrypted' ? 'config.secretsEncrypted' : 'config.secretsNone')}
            />
          </dl>

          <p className="mt-3 font-mono text-[11.5px] text-fg-dim">
            {new Date(pkg.exportedAt).toLocaleString(localeTag(lang))}
            {pkg.exportedBy ? ` · ${pkg.exportedBy}` : ''}
          </p>

          {pkg.secrets === 'excluded' && (
            <p className="mt-4 flex items-start gap-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
              <AlertTriangleIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t('config.excludedNotice')}
            </p>
          )}

          {pkg.secrets === 'encrypted' && (
            <label className="mt-4 block max-w-sm">
              <span className="mb-1.5 block text-[13px] font-medium">
                {t('config.packagePassword')}
              </span>
              <input
                type="password"
                className="input font-mono"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}

          <p className="mb-2 mt-5 text-[13px] font-medium">{t('config.conflictTitle')}</p>
          <div className="space-y-2">
            {STRATEGIES.map((option) => (
              <ModeOption
                key={option.value}
                selected={strategy === option.value}
                onSelect={() => setStrategy(option.value)}
                titleKey={option.titleKey}
                descriptionKey={option.descriptionKey}
              />
            ))}
          </div>

          <button
            type="button"
            className="btn btn-primary mt-4"
            onClick={() => void handleImport()}
            disabled={importConfig.isPending}
          >
            <UploadIcon size={14} />
            {importConfig.isPending ? t('config.importing') : t('config.import')}
          </button>
        </>
      )}

      {error && <ErrorLine message={error} />}
      {result && <ImportReport result={result} />}
    </section>
  );
}

function ImportReport({ result }: { result: ConfigImportResult }) {
  const t = useT();
  const rows: [TranslationKey, ImportCounts][] = [
    ['config.rowFolders', result.folders],
    ['config.rowCredentials', result.credentials],
    ['config.rowHosts', result.hosts],
  ];

  return (
    <div className="mt-5 rounded border border-line bg-surface-2 p-4">
      <p className="flex items-center gap-2 text-[13px] font-medium text-accent">
        <CheckCircle2Icon size={14} aria-hidden="true" />
        {t('config.importDone')}
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="text-fg-dim">
            <tr>
              <th className="pb-1 text-left font-normal" />
              <th className="pb-1 text-right font-normal">{t('config.colCreated')}</th>
              <th className="pb-1 text-right font-normal">{t('config.colRenamed')}</th>
              <th className="pb-1 text-right font-normal">{t('config.colSkipped')}</th>
              <th className="pb-1 text-right font-normal">{t('config.colOverwritten')}</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map(([labelKey, counts]) => (
              <tr key={labelKey} className="border-t border-line">
                <td className="py-1 font-sans">{t(labelKey)}</td>
                <td className="py-1 text-right">{counts.created}</td>
                <td className="py-1 text-right">{counts.renamed}</td>
                <td className="py-1 text-right">{counts.skipped}</td>
                <td className="py-1 text-right">{counts.overwritten}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        Uyarılar sessizce yutulmamalı: kullanıcı neyin eksik geldiğini görmeden
        "tamamlandı" yazısına güvenirse, bağlanamayan bir sunucuyla karşılaşana
        kadar sorunu fark etmez. Metinleri sunucu üretiyor (kayıt adlarını
        içeriyorlar), bu yüzden sunucunun dilinde gösteriliyorlar.
      */}
      {result.warnings.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {result.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 text-[12.5px] text-warn">
              <AlertTriangleIcon size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- küçük parçalar

function ModeOption({
  selected,
  onSelect,
  titleKey,
  descriptionKey,
}: {
  selected: boolean;
  onSelect: () => void;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`block w-full rounded border px-4 py-3 text-left transition-colors ${
        selected ? 'border-accent bg-accent-muted' : 'border-line hover:border-fg-dim/40'
      }`}
    >
      <span className={`text-[13px] font-medium ${selected ? 'text-accent' : ''}`}>
        {t(titleKey)}
      </span>
      <span className="mt-1 block text-[12.5px] leading-relaxed text-fg-dim">
        {t(descriptionKey)}
      </span>
    </button>
  );
}

function Stat({ labelKey, value }: { labelKey: TranslationKey; value: number | string }) {
  const t = useT();
  return (
    <div className="rounded border border-line bg-surface-2 px-3 py-2">
      <dt className="text-[11.5px] uppercase tracking-wide text-fg-dim">{t(labelKey)}</dt>
      <dd className="mt-0.5 font-mono text-[15px]">{value}</dd>
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mt-4 flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger"
    >
      <AlertCircleIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}
