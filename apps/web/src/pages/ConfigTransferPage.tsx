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
import { ApiRequestError } from '@/lib/api';
import { useExportConfig, useImportConfig } from '@/lib/queries';

/**
 * Yapılandırma taşıma ekranı.
 *
 * Dışa aktarımda gizli verinin pakete girip girmeyeceği kullanıcının bilinçli
 * seçimi: paket bir dosya olarak dışarı çıkıyor ve o andan sonra erişimi
 * denetleyemiyoruz. Bu yüzden iki kip de aynı görünürlükte sunuluyor, biri
 * varsayılan seçili değil.
 */
export function ConfigTransferPage() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-12">
      <p className="eyebrow">Yapılandırma</p>
      <h1 className="mt-2 text-[28px] font-semibold tracking-tight">Dışa / içe aktarma</h1>
      <p className="mt-2 max-w-[62ch] text-fg-dim">
        Klasörlerinizi, sunucularınızı ve kasa kayıtlarınızı tek bir JSON dosyasına alır, başka bir
        kuruluma taşır. Hızlı bağlantıyla oluşan geçici kayıtlar pakete girmez.
      </p>

      <ExportPanel />
      <ImportPanel />
    </div>
  );
}

// ----------------------------------------------------------------- dışa aktarma

function ExportPanel() {
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
        setError('Paket parolası en az 12 karakter olmalı.');
        return;
      }
      if (password !== repeat) {
        setError('Parolalar birbirini tutmuyor.');
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
      link.download = `sshby-yapilandirma-${stamp}.json`;
      link.click();
      URL.revokeObjectURL(url);

      setPassword('');
      setRepeat('');
      setDone(
        `${pkg.folders.length} klasör, ${pkg.hosts.length} sunucu ve ${pkg.credentials.length} kimlik bilgisi dosyaya yazıldı.`,
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Dışa aktarılamadı.');
    }
  }

  return (
    <section className="panel mt-8 p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <DownloadIcon size={15} className="text-fg-dim" aria-hidden="true" />
        Dışa aktar
      </h2>

      <div className="mt-4 space-y-2">
        <ModeOption
          selected={mode === 'excluded'}
          onSelect={() => setMode('excluded')}
          title="Gizli veri hariç"
          description="Parolalar ve özel anahtarlar pakete girmez. Dosya paylaşılabilir; karşı tarafta kimlik bilgilerinin yeniden girilmesi gerekir."
        />
        <ModeOption
          selected={mode === 'encrypted'}
          onSelect={() => setMode('encrypted')}
          title="Parola korumalı şifreli paket"
          description="Kasadaki gizli veriler de pakete girer, verdiğiniz paroladan türetilen anahtarla şifrelenir. Parolayı kaybederseniz paket açılamaz."
        />
      </div>

      {mode === 'encrypted' && (
        <div className="mt-4 grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">Paket parolası</span>
            <input
              type="password"
              className="input font-mono"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="mt-1 block text-[12px] text-fg-dim">En az 12 karakter.</span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">Parola tekrar</span>
            <input
              type="password"
              className="input font-mono"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </label>
        </div>
      )}

      {mode === 'encrypted' && (
        <p className="mt-4 flex items-start gap-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
          <LockIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          Bu dosya kasanızın tamamını taşır. Parolası kadar güvenlidir — dosya bir kez elden
          çıktığında deneme sayısını sınırlayacak bir sunucu yoktur.
        </p>
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
        className="btn btn-primary mt-5"
        onClick={() => void handleExport()}
        disabled={exportConfig.isPending}
      >
        <DownloadIcon size={14} />
        {exportConfig.isPending ? 'Hazırlanıyor…' : 'Dosyayı indir'}
      </button>
    </section>
  );
}

// ------------------------------------------------------------------ içe aktarma

const STRATEGY_LABELS: Record<ImportConflictStrategy, { title: string; description: string }> = {
  rename: {
    title: 'Yeniden adlandır',
    description: 'Aynı adlı kayıt varsa "(2)" ekiyle yenisi oluşur; mevcut hiçbir kayıt değişmez.',
  },
  skip: {
    title: 'Atla',
    description: 'Aynı adlı kayıt varsa paketteki atlanır, mevcut kayıt korunur.',
  },
  overwrite: {
    title: 'Üzerine yaz',
    description: 'Aynı adlı kayıt paketteki değerlerle güncellenir. Mevcut gizli veri değişir.',
  },
};

function ImportPanel() {
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
      setError('Dosya okunamadı; geçerli bir JSON değil.');
      return;
    }

    /**
     * Paket sunucuya gönderilmeden önce burada da doğrulanıyor. Aynı zod
     * şeması iki tarafta da çalıştığı için kullanıcı, yanlış dosyayı seçtiğini
     * ağ turu beklemeden öğreniyor.
     */
    const parsed = configPackageSchema.safeParse(raw);
    if (!parsed.success) {
      setError('Bu dosya bir sshby yapılandırma paketi değil ya da bozulmuş.');
      return;
    }
    setPkg(parsed.data);
  }

  async function handleImport() {
    if (!pkg) return;
    setError(null);
    setResult(null);

    if (pkg.secrets === 'encrypted' && !password) {
      setError('Bu paket şifreli; açmak için paket parolasını girin.');
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
      setError(err instanceof ApiRequestError ? err.message : 'İçe aktarılamadı.');
    }
  }

  return (
    <section className="panel mt-6 p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <UploadIcon size={15} className="text-fg-dim" aria-hidden="true" />
        İçe aktar
      </h2>

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

      <button type="button" className="btn mt-4" onClick={() => fileInput.current?.click()}>
        <FileJsonIcon size={14} />
        {fileName ? 'Başka dosya seç' : 'Paket dosyası seç'}
      </button>
      {fileName && <span className="ml-3 font-mono text-[12px] text-fg-dim">{fileName}</span>}

      {pkg && (
        <>
          <dl className="mt-5 grid grid-cols-4 gap-3">
            <Stat label="Klasör" value={pkg.folders.length} />
            <Stat label="Sunucu" value={pkg.hosts.length} />
            <Stat label="Kimlik" value={pkg.credentials.length} />
            <Stat label="Gizli veri" value={pkg.secrets === 'encrypted' ? 'şifreli' : 'yok'} />
          </dl>

          <p className="mt-3 font-mono text-[11.5px] text-fg-dim">
            {new Date(pkg.exportedAt).toLocaleString('tr-TR')}
            {pkg.exportedBy ? ` · ${pkg.exportedBy}` : ''}
          </p>

          {pkg.secrets === 'excluded' && (
            <p className="mt-4 flex items-start gap-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
              <AlertTriangleIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              Bu paket gizli veri içermiyor. Kimlik bilgileri oluşturulamaz; kasanızda aynı adlı bir
              kayıt varsa sunucular ona bağlanır, yoksa kimlik bilgisiz gelirler.
            </p>
          )}

          {pkg.secrets === 'encrypted' && (
            <label className="mt-4 block max-w-sm">
              <span className="mb-1.5 block text-[13px] font-medium">Paket parolası</span>
              <input
                type="password"
                className="input font-mono"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}

          <p className="mt-5 mb-2 text-[13px] font-medium">Aynı adlı kayıtla karşılaşılırsa</p>
          <div className="space-y-2">
            {(Object.keys(STRATEGY_LABELS) as ImportConflictStrategy[]).map((option) => (
              <ModeOption
                key={option}
                selected={strategy === option}
                onSelect={() => setStrategy(option)}
                title={STRATEGY_LABELS[option].title}
                description={STRATEGY_LABELS[option].description}
              />
            ))}
          </div>

          <button
            type="button"
            className="btn btn-primary mt-5"
            onClick={() => void handleImport()}
            disabled={importConfig.isPending}
          >
            <UploadIcon size={14} />
            {importConfig.isPending ? 'Aktarılıyor…' : 'İçe aktar'}
          </button>
        </>
      )}

      {error && <ErrorLine message={error} />}
      {result && <ImportReport result={result} />}
    </section>
  );
}

function ImportReport({ result }: { result: ConfigImportResult }) {
  const rows: [string, ImportCounts][] = [
    ['Klasör', result.folders],
    ['Kimlik bilgisi', result.credentials],
    ['Sunucu', result.hosts],
  ];

  return (
    <div className="mt-5 rounded border border-line bg-surface-2 p-4">
      <p className="flex items-center gap-2 text-[13px] font-medium text-accent">
        <CheckCircle2Icon size={14} aria-hidden="true" />
        İçe aktarma tamamlandı
      </p>

      <table className="mt-3 w-full text-[12.5px]">
        <thead className="text-fg-dim">
          <tr>
            <th className="pb-1 text-left font-normal" />
            <th className="pb-1 text-right font-normal">eklendi</th>
            <th className="pb-1 text-right font-normal">yeniden adlandırıldı</th>
            <th className="pb-1 text-right font-normal">atlandı</th>
            <th className="pb-1 text-right font-normal">üzerine yazıldı</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map(([label, counts]) => (
            <tr key={label} className="border-t border-line">
              <td className="py-1 font-sans">{label}</td>
              <td className="py-1 text-right">{counts.created}</td>
              <td className="py-1 text-right">{counts.renamed}</td>
              <td className="py-1 text-right">{counts.skipped}</td>
              <td className="py-1 text-right">{counts.overwritten}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/*
        Uyarılar sessizce yutulmamalı: kullanıcı neyin eksik geldiğini görmeden
        "tamamlandı" yazısına güvenirse, bağlanamayan bir sunucuyla karşılaşana
        kadar sorunu fark etmez.
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
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`block w-full rounded border px-4 py-3 text-left transition-colors ${
        selected ? 'border-accent bg-accent-muted' : 'border-line hover:border-fg-dim/40'
      }`}
    >
      <span className={`text-[13px] font-medium ${selected ? 'text-accent' : ''}`}>{title}</span>
      <span className="mt-1 block text-[12.5px] leading-relaxed text-fg-dim">{description}</span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-line bg-surface-2 px-3 py-2">
      <dt className="text-[11.5px] uppercase tracking-wide text-fg-dim">{label}</dt>
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
