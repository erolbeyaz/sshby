import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIcon,
  DatabaseIcon,
  FolderIcon,
  KeyRoundIcon,
  PlugZapIcon,
  ServerIcon,
  TerminalIcon,
  UserIcon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import type { Host } from '@sshby/shared';
import { apiFetch } from '@/lib/api';
import { useInventory } from '@/lib/queries';
import { hostConnectionState, useTerminalStore } from '@/lib/terminal-store';

interface Dashboard {
  version: string;
  uptimeSeconds: number;
  totals: { hosts: number; credentials: number; folders: number };
  sessions: { active: number; hosts: number };
  audit: { enabled: boolean; ok: boolean; message: string };
  activity: { action: string; outcome: string; serverName: string | null; at: string }[];
}

/** Denetim aksiyonlarının insan okunur karşılığı. */
const ACTION_LABEL: Record<string, string> = {
  'ssh.connect': 'Terminal',
  'ssh.connect_failed': 'Bağlantı başarısız',
  'ssh.disconnect': 'Oturum kapandı',
  'ssh.command': 'Komut',
  'ssh.hostkey_accepted': 'Host anahtarı kabul edildi',
  'ssh.hostkey_changed': 'Host anahtarı değişti',
  'sftp.list': 'Dosya yöneticisi',
  'sftp.download': 'Dosya indirildi',
  'sftp.upload': 'Dosya yüklendi',
  'sftp.delete': 'Dosya silindi',
  'sftp.rename': 'Yeniden adlandırıldı',
  'sftp.mkdir': 'Klasör oluşturuldu',
  'sftp.chmod': 'İzin değişti',
  'host.create': 'Sunucu eklendi',
  'host.update': 'Sunucu güncellendi',
  'host.delete': 'Sunucu silindi',
  'host.move': 'Sunucu taşındı',
  'folder.create': 'Klasör eklendi',
  'folder.update': 'Klasör güncellendi',
  'folder.delete': 'Klasör silindi',
  'credential.create': 'Kimlik eklendi',
  'credential.update': 'Kimlik güncellendi',
  'credential.delete': 'Kimlik silindi',
  'settings.change': 'Ayar değişti',
  'auth.register': 'Kayıt olundu',
  'auth.login': 'Giriş yapıldı',
  'auth.login_failed': 'Başarısız giriş',
  'auth.logout': 'Çıkış yapıldı',
  'auth.token_refresh': 'Oturum yenilendi',
  'user.role_change': 'Rol değişti',
  'user.activate': 'Kullanıcı etkinleştirildi',
  'user.deactivate': 'Kullanıcı pasifleştirildi',
  'config.export': 'Yapılandırma dışa aktarıldı',
  'config.import': 'Yapılandırma içe aktarıldı',
};

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

/** "3sa", "11d" — etkinlik listesindeki göreli zaman. */
function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}sn`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}dk`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}sa`;
  return `${Math.floor(hours / 24)}g`;
}

export function HomePage() {
  const inventory = useInventory();
  const navigate = useNavigate();
  const openTab = useTerminalStore((s) => s.openTab);
  const setQuickConnectOpen = useTerminalStore((s) => s.setQuickConnectOpen);
  const tabs = useTerminalStore((s) => s.tabs);

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
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const hosts = inventory.data?.hosts ?? [];
  const data = dashboard.data;

  const online = hosts.filter(
    (host) => hostConnectionState(tabs, host.id) === 'connected',
  ).length;

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[20px] font-semibold tracking-tight">Gösterge paneli</h1>
        <span className="font-mono text-[12px] text-fg-dim">
          {new Date().toLocaleDateString('tr-TR', {
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
            <Stat label="Sürüm" value={data?.version ?? '—'} accent />
            <Stat
              label="Çalışma süresi"
              value={data ? formatUptime(data.uptimeSeconds) : '—'}
            />
            <Stat
              label="Veritabanı"
              value={health.data?.database === 'ok' ? 'Sağlıklı' : health.isPending ? '…' : 'Hata'}
              tone={health.data?.database === 'ok' ? 'ok' : 'danger'}
            />
            <Stat label="Bağlı sunucu" value={`${online} / ${hosts.length}`} />
          </div>

          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-3">
            <Count icon={ServerIcon} label="Toplam sunucu" value={data?.totals.hosts ?? 0} />
            <Count icon={KeyRoundIcon} label="Kimlik bilgisi" value={data?.totals.credentials ?? 0} />
            <Count icon={FolderIcon} label="Klasör" value={data?.totals.folders ?? 0} />
          </div>

          {/* ---------------------------------------------------- hızlı eylem */}
          <section className="panel">
            <h2 className="eyebrow border-b border-line px-4 py-2.5">Hızlı eylemler</h2>
            <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2">
              <Action
                icon={ZapIcon}
                title="Hızlı bağlantı"
                description="Kaydetmeden tek seferlik bağlan"
                onClick={() => setQuickConnectOpen(true)}
              />
              <Action
                icon={KeyRoundIcon}
                title="Kimlik bilgisi ekle"
                description="SSH anahtarı ya da parola sakla"
                onClick={() => navigate('/kasa')}
              />
              <Action
                icon={TerminalIcon}
                title="Sunucuya bağlan"
                description="Soldaki ağaçtan çift tıklayın"
                onClick={() => hosts[0] && navigate(`/sunucu/${hosts[0].id}`)}
                disabled={hosts.length === 0}
              />
              <Action
                icon={UserIcon}
                title="Hesabım"
                description="Oturumlar ve profil"
                onClick={() => navigate('/kasa')}
              />
            </div>
          </section>

          {/* --------------------------------------------------- sunucu listesi */}
          <section className="panel">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="eyebrow">Sunucu durumu</h2>
              <span className="font-mono text-[11px] text-fg-dim">
                {online}/{hosts.length} bağlı
              </span>
            </div>

            {hosts.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-fg-dim">
                Henüz sunucu yok. Soldaki ağaçtan ekleyebilirsiniz.
              </p>
            ) : (
              <div className="max-h-[280px] overflow-y-auto">
                {hosts.map((host) => (
                  <HostRow
                    key={host.id}
                    host={host}
                    onOpen={() => navigate(`/sunucu/${host.id}`)}
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
            <h2 className="eyebrow flex-1">Son etkinlikler</h2>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {data?.activity.length === 0 && (
              <p className="px-4 py-8 text-center text-[12.5px] leading-relaxed text-fg-dim">
                Henüz etkinlik yok.
                <br />
                Bir sunucuya bağlandığınızda burada görünür.
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
                  <p className="truncate font-mono text-[12px]">
                    {item.serverName ?? 'sshby'}
                  </p>
                  <p className="truncate text-[11px] text-fg-dim">
                    {ACTION_LABEL[item.action] ?? item.action}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[10.5px] text-fg-dim">
                  {relativeTime(item.at)}
                </span>
              </div>
            ))}
          </div>

          {/*
            Denetim durumu panelin altında sabit: kullanıcı "kayıt tutuluyor mu"
            sorusunu hiçbir zaman sormak zorunda kalmamalı.
          */}
          <Link
            to="/yonetim/denetim"
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
                  ? 'Denetim aktarımı kapalı'
                  : data.audit.ok
                    ? "Elasticsearch'e yazılıyor"
                    : 'Denetim gönderimi başarısız'}
              </span>
              <span className="block truncate font-mono text-[10px] text-fg-dim">
                {data?.audit.message ?? '—'}
              </span>
            </span>
            <PlugZapIcon size={12} className="shrink-0 text-fg-dim" aria-hidden="true" />
          </Link>
        </section>
      </div>
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
  const state = useTerminalStore((s) => hostConnectionState(s.tabs, host.id));

  return (
    <div className="group flex items-center gap-3 border-b border-line/40 px-4 py-2 last:border-0 hover:bg-surface-2">
      <span
        className={clsx(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          state === 'connected' ? 'bg-accent' : state === 'connecting' ? 'bg-warn' : 'bg-danger',
        )}
        role="img"
        aria-label={state === 'connected' ? 'bağlı' : 'bağlı değil'}
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
          state === 'connected'
            ? 'border-accent/40 text-accent'
            : 'border-line text-fg-dim',
        )}
      >
        {state === 'connected' ? 'çevrimiçi' : state === 'connecting' ? 'bağlanıyor' : 'kapalı'}
      </span>

      <button
        type="button"
        className="btn-ghost shrink-0 rounded p-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        onClick={onConnect}
        aria-label={`${host.name} sunucusuna bağlan`}
        title="Terminal aç"
      >
        <TerminalIcon size={13} />
      </button>
    </div>
  );
}
