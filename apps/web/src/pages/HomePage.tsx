import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIcon,
  ArrowDownUpIcon,
  DatabaseIcon,
  FolderIcon,
  KeyRoundIcon,
  PinIcon,
  PlugZapIcon,
  ServerIcon,
  TerminalIcon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import type { Host } from '@sshby/shared';
import { ConfigTransferDialog } from '@/components/dialogs/ConfigTransferDialog';
import { apiFetch } from '@/lib/api';
import { localeTag, useI18n, useT, type TranslateFn, type TranslationKey } from '@/lib/i18n';
import { useInventory } from '@/lib/queries';
import { hostConnectionState, useTerminalStore } from '@/lib/terminal-store';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useWorkspaceStore } from '@/lib/workspace-store';

interface Dashboard {
  version: string;
  uptimeSeconds: number;
  totals: { hosts: number; credentials: number; folders: number };
  sessions: { active: number; hosts: number };
  audit: { enabled: boolean; ok: boolean; message: string };
  activity: { action: string; outcome: string; serverName: string | null; at: string }[];
}

/**
 * Denetim aksiyonunun insan okunur karşılığı. Sözlükte karşılığı olmayan bir
 * aksiyon ham hâliyle gösterilir — sunucu yeni bir olay tipi eklediğinde ekran
 * boş kalmasın diye.
 */
function actionLabel(t: TranslateFn, action: string): string {
  const key = `action.${action}` as TranslationKey;
  const label = t(key);
  return label === key ? action : label;
}

function formatUptime(t: TranslateFn, seconds: number): string {
  return t('time.uptime', {
    d: Math.floor(seconds / 86400),
    h: Math.floor((seconds % 86400) / 3600),
    m: Math.floor((seconds % 3600) / 60),
  });
}

/** Etkinlik listesindeki göreli zaman. */
function relativeTime(t: TranslateFn, iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return t('time.seconds', { n: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('time.minutes', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hours', { n: hours });
  return t('time.days', { n: Math.floor(hours / 24) });
}

export function HomePage() {
  const t = useT();
  const { lang } = useI18n();
  const inventory = useInventory();
  const navigate = useNavigate();
  const openTab = useTerminalStore((s) => s.openTab);
  const openNav = useWorkspaceStore((s) => s.openNav);
  const tabs = useTerminalStore((s) => s.tabs);
  const [configOpen, setConfigOpen] = useState(false);

  useDocumentTitle('Dashboard');

  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiFetch<Dashboard>('/dashboard'),
    refetchInterval: 15_000,
  });

  const health = useQuery({
    queryKey: ['dashboard', 'health'],
    queryFn: () => apiFetch<{ database: 'ok' | 'error' }>('/dashboard/health'),
    refetchInterval: 30_000,
  });

  // Saatin ilerlemesi için; çalışma süresi kartı canlı kalsın.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const hosts = inventory.data?.hosts ?? [];
  const data = dashboard.data;

  const online = hosts.filter((host) => hostConnectionState(tabs, host.id) === 'connected').length;

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[20px] font-semibold tracking-tight">{t('home.title')}</h1>
        <span className="font-mono text-[12px] text-fg-dim">
          {new Date().toLocaleDateString(localeTag(lang), {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            weekday: 'long',
          })}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          {/* ------------------------------------------------ üst göstergeler */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line lg:grid-cols-4">
            <Stat label={t('home.version')} value={data?.version ?? '—'} accent />
            <Stat
              label={t('home.uptime')}
              value={data ? formatUptime(t, data.uptimeSeconds) : '—'}
            />
            <Stat
              label={t('home.database')}
              value={
                health.data?.database === 'ok'
                  ? t('home.databaseOk')
                  : health.isPending
                    ? '…'
                    : t('home.databaseError')
              }
              tone={health.data?.database === 'ok' ? 'ok' : 'danger'}
            />
            <Stat label={t('home.connectedHosts')} value={`${online} / ${hosts.length}`} />
          </div>

          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-3">
            <Count icon={ServerIcon} label={t('home.totalHosts')} value={data?.totals.hosts ?? 0} />
            <Count
              icon={KeyRoundIcon}
              label={t('home.credentials')}
              value={data?.totals.credentials ?? 0}
            />
            <Count icon={FolderIcon} label={t('home.folders')} value={data?.totals.folders ?? 0} />
          </div>

          {/*
            Sunucu kartları en üstte: terminal açık değilken bu ekranın işi
            "hangi sunucuya bağlanacağım" sorusunu cevaplamak. Sayaçlar ve
            etkinlik akışı altta kalıyor — onlara bakmak ikincil bir ihtiyaç.
          */}
          <section className="panel">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="eyebrow">{t('home.myServers')}</h2>
              <span className="font-mono text-[11px] text-fg-dim">
                {t('home.connectedRatio', { online, total: hosts.length })}
              </span>
            </div>

            {hosts.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] text-fg-dim">{t('home.noHosts')}</p>
            ) : (
              <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
                {hosts.map((host) => (
                  <HostCard
                    key={host.id}
                    host={host}
                    onConnect={() => openTab(host.id, host.name)}
                    onOpen={() => navigate(`/server/${host.id}`)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ---------------------------------------------------- hızlı eylem */}
          <section className="panel">
            <h2 className="eyebrow border-b border-line px-4 py-2.5">{t('home.quickActions')}</h2>
            <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2">
              <Action
                icon={ZapIcon}
                title={t('home.actionQuickConnect')}
                description={t('home.actionQuickConnectDesc')}
                onClick={() => openNav('quick')}
              />
              <Action
                icon={KeyRoundIcon}
                title={t('home.actionAddCredential')}
                description={t('home.actionAddCredentialDesc')}
                onClick={() => openNav('credentials')}
              />
              <Action
                icon={ServerIcon}
                title={t('home.actionInventory')}
                description={t('home.actionInventoryDesc')}
                onClick={() => openNav('hosts')}
              />
              <Action
                icon={ArrowDownUpIcon}
                title={t('home.actionConfig')}
                description={t('home.actionConfigDesc')}
                onClick={() => setConfigOpen(true)}
              />
            </div>
          </section>

          {/* ------------------------------------------- ayrıntılı sunucu durumu */}
          <section className="panel">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="eyebrow">{t('home.hostStatus')}</h2>
              <span className="font-mono text-[11px] text-fg-dim">
                {t('home.connectedRatio', { online, total: hosts.length })}
              </span>
            </div>

            {hosts.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-fg-dim">{t('home.noHosts')}</p>
            ) : (
              <div className="max-h-[280px] overflow-y-auto">
                {hosts.map((host) => (
                  <HostRow
                    key={host.id}
                    host={host}
                    onOpen={() => navigate(`/server/${host.id}`)}
                    onConnect={() => openTab(host.id, host.name)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ------------------------------------------------- son etkinlikler */}
        <section className="panel flex min-h-0 flex-col xl:max-h-[calc(100vh-140px)]">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <ActivityIcon size={12} className="shrink-0 text-fg-dim" aria-hidden="true" />
            <h2 className="eyebrow flex-1">{t('home.recentActivity')}</h2>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {data?.activity.length === 0 && (
              <p className="px-4 py-8 text-center text-[12.5px] leading-relaxed text-fg-dim">
                {t('home.noActivity')}
                <br />
                {t('home.noActivityHint')}
              </p>
            )}

            {data?.activity.map((item, index) => (
              <div
                key={index}
                className="flex items-center gap-2.5 border-b border-line/40 px-4 py-2 last:border-0"
              >
                <span
                  className={clsx(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    item.outcome === 'failure' ? 'bg-danger' : 'bg-accent',
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[12px]">{item.serverName ?? 'sshby'}</p>
                  <p className="truncate text-[11px] text-fg-dim">{actionLabel(t, item.action)}</p>
                </div>
                <span className="shrink-0 font-mono text-[10.5px] text-fg-dim">
                  {relativeTime(t, item.at)}
                </span>
              </div>
            ))}
          </div>

          {/*
            Denetim durumu panelin altında sabit: kullanıcı "kayıt tutuluyor mu"
            sorusunu hiçbir zaman sormak zorunda kalmamalı.
          */}
          <Link
            to="/admin/audit"
            className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2.5 transition-colors hover:bg-surface-2"
          >
            <DatabaseIcon
              size={12}
              className={clsx(
                'shrink-0',
                !data?.audit.enabled ? 'text-fg-dim' : data.audit.ok ? 'text-accent' : 'text-danger',
              )}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[11.5px]">
                {!data?.audit.enabled
                  ? t('home.auditDisabled')
                  : data.audit.ok
                    ? t('home.auditWriting')
                    : t('home.auditFailing')}
              </span>
              <span className="block truncate font-mono text-[10px] text-fg-dim">
                {data?.audit.message ?? '—'}
              </span>
            </span>
            <PlugZapIcon size={12} className="shrink-0 text-fg-dim" aria-hidden="true" />
          </Link>
        </section>
      </div>

      {configOpen && <ConfigTransferDialog onClose={() => setConfigOpen(false)} />}
    </div>
  );
}

/**
 * Sunucu kartı — terminal açık değilken ana ekranın birincil öğesi.
 *
 * Kartın gövdesi bağlanır, ad kısmı ayrıntıya götürür: en sık yapılan iş
 * (bağlan) en büyük tıklama hedefi olmalı.
 */
function HostCard({
  host,
  onConnect,
  onOpen,
}: {
  host: Host;
  onConnect: () => void;
  onOpen: () => void;
}) {
  const t = useT();
  const state = useTerminalStore((s) => hostConnectionState(s.tabs, host.id));

  return (
    <div className="group relative flex flex-col gap-2 bg-surface px-4 py-3 transition-colors hover:bg-surface-2">
      <div className="flex items-center gap-2">
        {host.pinned && <PinIcon size={10} className="shrink-0 text-accent" aria-hidden="true" />}
        <span
          className={clsx(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            state === 'connected' ? 'bg-accent' : state === 'connecting' ? 'bg-warn' : 'bg-danger',
          )}
          role="img"
          aria-label={state === 'connected' ? t('home.connectedLabel') : t('home.disconnectedLabel')}
        />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left font-mono text-[13px] hover:text-accent"
          onClick={onOpen}
        >
          {host.name}
        </button>
      </div>

      <p className="truncate font-mono text-[11px] text-fg-dim">
        {host.effectiveUsername ?? '?'}@{host.hostname}:{host.port}
      </p>

      {host.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {host.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="pill">
              {tag}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        className="btn mt-1 w-full justify-center py-1 text-[12px]"
        onClick={onConnect}
      >
        <TerminalIcon size={12} />
        {t('host.connect')}
      </button>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: 'ok' | 'danger';
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="eyebrow">{label}</p>
      <p
        className={clsx(
          'mt-1 font-mono text-[19px] font-bold tracking-tight',
          accent && 'text-accent',
          tone === 'ok' && 'text-accent',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Count({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 bg-surface px-4 py-3">
      <Icon size={15} className="shrink-0 text-fg-dim" aria-hidden="true" />
      <span className="font-mono text-[19px] font-bold">{value}</span>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

function Action({
  icon: Icon,
  title,
  description,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-3 bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-surface"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line text-fg-dim">
        <Icon size={13} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        <span className="block truncate text-[11.5px] text-fg-dim">{description}</span>
      </span>
    </button>
  );
}

function HostRow({
  host,
  onOpen,
  onConnect,
}: {
  host: Host;
  onOpen: () => void;
  onConnect: () => void;
}) {
  const t = useT();
  const state = useTerminalStore((s) => hostConnectionState(s.tabs, host.id));

  return (
    <div className="group flex items-center gap-3 border-b border-line/40 px-4 py-2 last:border-0 hover:bg-surface-2">
      <span
        className={clsx(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          state === 'connected' ? 'bg-accent' : state === 'connecting' ? 'bg-warn' : 'bg-danger',
        )}
        role="img"
        aria-label={state === 'connected' ? t('home.connectedLabel') : t('home.disconnectedLabel')}
      />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <span className="block truncate font-mono text-[12.5px]">{host.name}</span>
        <span className="block truncate font-mono text-[10.5px] text-fg-dim">
          {host.effectiveUsername ?? '?'}@{host.hostname}:{host.port}
        </span>
      </button>

      <span
        className={clsx(
          'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em]',
          state === 'connected' ? 'border-accent/40 text-accent' : 'border-line text-fg-dim',
        )}
      >
        {state === 'connected'
          ? t('home.online')
          : state === 'connecting'
            ? t('home.connecting')
            : t('home.offline')}
      </span>

      <button
        type="button"
        className="btn-ghost shrink-0 rounded p-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        onClick={onConnect}
        aria-label={t('home.connectTo', { name: host.name })}
        title={t('home.openTerminal')}
      >
        <TerminalIcon size={13} />
      </button>
    </div>
  );
}
