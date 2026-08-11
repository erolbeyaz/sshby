import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CopyIcon,
  HistoryIcon,
  LoaderIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { apiFetch } from '@/lib/api';
import { localeTag, useApiError, useI18n } from '@/lib/i18n';

interface HistoryEntry {
  sequence: number;
  command: string;
  at: string;
  sessionId: string | null;
}

interface HistoryResponse {
  hostId: string;
  hostName: string;
  entries: HistoryEntry[];
}

/**
 * Komut geçmişi.
 *
 * Kaynak sunucudaki `~/.bash_history` değil, sshby'nin kendi denetim kaydı —
 * kimin çalıştırdığı bilgisi orada var, yapıştırılan komutlar da dahil ve
 * kabuk kapanmadan görünür.
 */
export function HistoryPanel({
  hostId,
  hostName,
  onClose,
}: {
  hostId: string;
  hostName: string;
  onClose: () => void;
}) {
  const { lang, t } = useI18n();
  const apiError = useApiError();
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<number | null>(null);

  const history = useQuery({
    queryKey: ['history', hostId],
    queryFn: () => apiFetch<HistoryResponse>(`/history/${hostId}`),
    // Terminalde komut çalıştıkça geçmiş büyür; makul sıklıkta tazele.
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const entries = history.data?.entries ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(lang);
    return needle
      ? entries.filter((entry) => entry.command.toLocaleLowerCase(lang).includes(needle))
      : entries;
  }, [entries, lang, query]);

  async function copy(entry: HistoryEntry) {
    try {
      await navigator.clipboard.writeText(entry.command);
      setCopied(entry.sequence);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      // Pano erişimi yoksa sessizce geç; kullanıcı metni elle seçebilir.
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <HistoryIcon size={14} className="shrink-0 text-accent" aria-hidden="true" />
        <h2 className="flex-1 truncate font-mono text-[13px] font-semibold">{hostName}</h2>
        <button
          type="button"
          className="btn-ghost rounded p-1.5"
          onClick={() => void history.refetch()}
          aria-label={t('history.refresh')}
          title={t('history.refresh')}
        >
          <RefreshCwIcon size={13} className={clsx(history.isFetching && 'animate-spin')} />
        </button>
        <button
          type="button"
          className="btn-ghost rounded p-1.5"
          onClick={onClose}
          aria-label={t('history.closePanel')}
        >
          <XIcon size={14} />
        </button>
      </div>

      <div className="relative shrink-0 px-3 py-2">
        <SearchIcon
          size={13}
          className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-fg-dim"
          aria-hidden="true"
        />
        <input
          className="input py-1.5 pl-7 pr-2 font-mono text-[12px]"
          placeholder={t('history.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('history.searchAria')}
        />
      </div>

      <div className="flex shrink-0 items-center justify-between px-3 pb-1.5">
        <span className="font-mono text-[11px] text-fg-dim">
          {query && entries.length !== filtered.length
            ? t('history.countFiltered', { n: filtered.length, total: entries.length })
            : t('history.count', { n: filtered.length })}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {history.isPending && (
          <p className="flex items-center gap-2 px-1 py-4 font-mono text-[12px] text-fg-dim">
            <LoaderIcon size={13} className="animate-spin" aria-hidden="true" />
            {t('common.loading')}
          </p>
        )}

        {history.isError && (
          <p className="px-1 py-4 text-[12.5px] text-danger">
            {apiError(history.error, 'history.loadFailed')}
          </p>
        )}

        {history.data && filtered.length === 0 && (
          <p className="px-1 py-6 text-center text-[12.5px] leading-relaxed text-fg-dim">
            {query ? (
              t('history.noMatch')
            ) : (
              <>
                {t('history.empty')}
                <br />
                {t('history.emptyHint')}
              </>
            )}
          </p>
        )}

        {filtered.map((entry) => (
          <div
            key={`${entry.sequence}-${entry.at}`}
            className="group flex items-baseline gap-2.5 rounded px-1.5 py-1 hover:bg-surface-2"
          >
            <span className="w-8 shrink-0 text-right font-mono text-[11px] text-fg-dim/60">
              {entry.sequence}
            </span>
            <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-fg">
              {entry.command}
            </code>
            <span
              className="shrink-0 font-mono text-[10px] text-fg-dim/70"
              title={new Date(entry.at).toLocaleString(localeTag(lang))}
            >
              {new Date(entry.at).toLocaleTimeString(localeTag(lang), {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-fg-dim opacity-0 transition-opacity hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
              onClick={() => void copy(entry)}
              aria-label={t('history.copyAria', { n: entry.sequence })}
              title={copied === entry.sequence ? t('history.copied') : t('history.copy')}
            >
              <CopyIcon size={11} className={clsx(copied === entry.sequence && 'text-accent')} />
            </button>
          </div>
        ))}
      </div>

      {/*
        "Tümünü Temizle" düğmesi bilinçli olarak YOK.
        Geçmiş, denetim kaydından türüyor. Kullanıcının kendi denetim izini
        silebilmesi denetimi anlamsız kılardı; görünümü temizleyen sahte bir
        düğme koymak ise kullanıcıyı sildiğine inandırırdı.
      */}
      <p className="shrink-0 border-t border-line px-3 py-1.5 font-mono text-[10px] text-fg-dim">
        {t('history.footer')}
      </p>
    </div>
  );
}
