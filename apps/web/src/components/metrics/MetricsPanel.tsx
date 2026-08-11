import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIcon,
  CpuIcon,
  GaugeIcon,
  HardDriveIcon,
  InfoIcon,
  LoaderIcon,
  LogInIcon,
  type LucideIcon,
  MemoryStickIcon,
  NetworkIcon,
  PlugIcon,
  RefreshCwIcon,
  ThermometerIcon,
  TimerIcon,
  XIcon,
} from 'lucide-react';
import clsx from 'clsx';
import type { MetricsSnapshot } from '@sshby/shared';
import { ApiRequestError, apiFetch } from '@/lib/api';

function formatBytes(bytes: number, digits = 1): string {
  if (bytes <= 0) return '0';
  const units = ['B', 'K', 'M', 'G', 'T'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(digits)}${units[unit]}`;
}

/** 12777731 → "147d 21h 22m" */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function usageTone(percent: number): { ring: string; text: string } {
  if (percent >= 90) return { ring: 'stroke-danger', text: 'text-danger' };
  if (percent >= 75) return { ring: 'stroke-warn', text: 'text-warn' };
  return { ring: 'stroke-accent', text: 'text-accent' };
}

/**
 * Halka gösterge.
 *
 * SVG ile çiziliyor; grafik kütüphanesi tek bir yüzde göstermek için fazla
 * ağır kalırdı. `strokeDasharray` çevre uzunluğuna eşit, `strokeDashoffset`
 * de dolu olmayan kısım.
 */
function Gauge({ percent, label }: { percent: number; label: string }) {
  const tone = usageTone(percent);
  const radius = 30;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative flex h-[86px] w-[86px] shrink-0 items-center justify-center">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={radius} className="fill-none stroke-surface-2" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          className={clsx('fill-none transition-all duration-500', tone.ring)}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(100, percent) / 100)}
        />
      </svg>
      <div className="absolute text-center">
        <div className={clsx('font-mono text-[17px] font-bold', tone.text)}>
          {Math.round(percent)}%
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-fg-dim">{label}</div>
      </div>
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  action,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx('panel flex flex-col overflow-hidden', className)}>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <Icon size={12} className="shrink-0 text-fg-dim" aria-hidden="true" />
        <h3 className="eyebrow flex-1">{title}</h3>
        {action}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="shrink-0 font-mono text-[11px] text-fg-dim">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-[12px]">{value}</span>
    </div>
  );
}

export function MetricsPanel({
  hostId,
  hostName,
  onClose,
}: {
  hostId: string;
  hostName: string;
  onClose: () => void;
}) {
  const [live, setLive] = useState(true);
  const [mountIndex, setMountIndex] = useState(0);

  const metrics = useQuery({
    queryKey: ['metrics', hostId],
    queryFn: () => apiFetch<MetricsSnapshot>(`/metrics/${hostId}`),
    /**
     * Canlı kip 5 saniyede bir örnekliyor. Daha sık sormak sunucuda gereksiz
     * yük, daha seyrek sormak "canlı" hissini kaybettiriyor.
     */
    refetchInterval: live ? 5_000 : false,
    retry: 1,
  });

  const data = metrics.data;

  if (metrics.isPending) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <p className="flex items-center gap-2 font-mono text-[13px] text-fg-dim">
          <LoaderIcon size={14} className="animate-spin" aria-hidden="true" />
          metrikler toplanıyor…
        </p>
      </div>
    );
  }

  if (metrics.isError || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
        <p className="text-[13px] text-danger">
          {metrics.error instanceof ApiRequestError
            ? metrics.error.message
            : 'Metrikler alınamadı.'}
        </p>
        <button type="button" className="btn" onClick={() => void metrics.refetch()}>
          <RefreshCwIcon size={13} />
          Yeniden dene
        </button>
      </div>
    );
  }

  const disk = data.storage[Math.min(mountIndex, data.storage.length - 1)];

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <GaugeIcon size={14} className="shrink-0 text-accent" aria-hidden="true" />
        <h2 className="flex-1 truncate font-mono text-[13px] font-semibold">{hostName}</h2>

        <button
          type="button"
          className={clsx(
            'rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors',
            live
              ? 'border-accent/50 text-accent'
              : 'border-line text-fg-dim hover:border-fg-dim hover:text-fg',
          )}
          onClick={() => setLive((v) => !v)}
          aria-pressed={live}
          title={live ? '5 saniyede bir yenileniyor' : 'Otomatik yenileme kapalı'}
        >
          {live ? 'canlı' : 'duraklatıldı'}
        </button>

        <button
          type="button"
          className="btn-ghost rounded p-1.5"
          onClick={() => void metrics.refetch()}
          aria-label="Yenile"
          title="Yenile"
        >
          <RefreshCwIcon size={13} className={clsx(metrics.isFetching && 'animate-spin')} />
        </button>
        <button
          type="button"
          className="btn-ghost rounded p-1.5"
          onClick={onClose}
          aria-label="Metrik panelini kapat"
        >
          <XIcon size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* ------------------------------------------------------- CPU */}
          <Card icon={CpuIcon} title="CPU kullanımı">
            <div className="flex items-center gap-4">
              <Gauge percent={data.cpu.usagePercent} label={`${data.cpu.cores} çekirdek`} />
              <div className="min-w-0 flex-1">
                <Row label="1m" value={data.cpu.load1.toFixed(2)} />
                <Row label="5m" value={data.cpu.load5.toFixed(2)} />
                <Row label="15m" value={data.cpu.load15.toFixed(2)} />
              </div>
            </div>
          </Card>

          {/* ---------------------------------------------------- bellek */}
          <Card icon={MemoryStickIcon} title="Bellek kullanımı">
            <div className="flex items-center gap-4">
              <Gauge percent={data.memory.percent} label="bellek" />
              <div className="min-w-0 flex-1">
                <Row
                  label="bellek"
                  value={`${formatBytes(data.memory.usedBytes)} / ${formatBytes(data.memory.totalBytes)}`}
                />
                <Row label="boş" value={formatBytes(data.memory.freeBytes)} />
                <Row
                  label="takas"
                  value={
                    data.memory.swapTotalBytes > 0
                      ? `${formatBytes(data.memory.swapUsedBytes)} / ${formatBytes(data.memory.swapTotalBytes)}`
                      : 'yok'
                  }
                />
              </div>
            </div>
          </Card>

          {/* ------------------------------------------------------ disk */}
          <Card
            icon={HardDriveIcon}
            title="Disk kullanımı"
            action={
              data.storage.length > 1 && (
                <select
                  className="rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[10.5px] text-fg-dim"
                  value={mountIndex}
                  onChange={(e) => setMountIndex(Number(e.target.value))}
                  aria-label="Bağlama noktası"
                >
                  {data.storage.map((mount, index) => (
                    <option key={mount.mount} value={index}>
                      {mount.mount}
                    </option>
                  ))}
                </select>
              )
            }
          >
            {disk ? (
              <div className="flex items-center gap-4">
                <Gauge percent={disk.percent} label={disk.mount} />
                <div className="min-w-0 flex-1">
                  <Row
                    label={disk.mount}
                    value={`${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`}
                  />
                  <Row label="kullanılabilir" value={formatBytes(disk.availableBytes)} />
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-fg-dim">Disk bilgisi okunamadı.</p>
            )}
          </Card>

          {/* -------------------------------------------------- ağ / süre */}
          <Card icon={NetworkIcon} title="Ağ arayüzleri">
            {data.network.length === 0 && (
              <p className="text-[12px] text-fg-dim">Arayüz bulunamadı.</p>
            )}
            {data.network.map((iface) => (
              <div
                key={iface.name}
                className="mb-1.5 flex items-center gap-2 rounded border border-line px-2.5 py-1.5 last:mb-0"
              >
                <span
                  className={clsx(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    iface.up ? 'bg-accent' : 'bg-[#4A4A4A]',
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12px]">{iface.name}</div>
                  <div className="truncate font-mono text-[10.5px] text-fg-dim">
                    {iface.address ?? '—'}
                  </div>
                </div>
                <span
                  className={clsx(
                    'shrink-0 font-mono text-[9.5px] uppercase tracking-[0.1em]',
                    iface.up ? 'text-accent' : 'text-fg-dim',
                  )}
                >
                  {iface.up ? 'up' : 'down'}
                </span>
              </div>
            ))}
          </Card>

          <Card icon={TimerIcon} title="Çalışma süresi">
            <div className="font-mono text-[26px] font-bold tracking-tight text-accent">
              {formatUptime(data.system.uptimeSeconds)}
            </div>
            <p className="mt-1 font-mono text-[11px] text-fg-dim">
              {data.system.uptimeSeconds.toLocaleString('tr-TR')} saniye
            </p>
          </Card>

          <Card icon={InfoIcon} title="Sistem bilgisi">
            <Row label="sunucu adı" value={data.system.hostname} />
            <Row label="işletim sistemi" value={data.system.operatingSystem} />
            <Row label="çekirdek" value={data.system.kernel} />
            <Row
              label="sıcaklık"
              value={
                data.temperatureCelsius === null
                  ? 'N/A'
                  : `${data.temperatureCelsius.toFixed(1)} °C`
              }
            />
          </Card>

          {/* -------------------------------------------------- işlemler */}
          <Card icon={ActivityIcon} title="İşlemler" className="lg:col-span-2">
            <p className="mb-2 font-mono text-[11px] text-fg-dim">
              <span className="text-fg">{data.processCount.total}</span> toplam ·{' '}
              <span className="text-fg">{data.processCount.running}</span> çalışan
            </p>
            {data.processes.map((process, index) => (
              <div
                key={index}
                className="flex items-baseline gap-3 border-b border-line/40 py-[3px] last:border-0"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                  {process.command}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-fg-dim">
                  {process.cpuPercent.toFixed(1)}% cpu · {process.memoryPercent.toFixed(1)}% mem
                </span>
              </div>
            ))}
          </Card>

          {/* ------------------------------------------------- girişler */}
          <Card icon={LogInIcon} title="SSH giriş istatistikleri">
            {data.logins.length === 0 && (
              <p className="text-[12px] text-fg-dim">Kayıt bulunamadı.</p>
            )}
            {data.logins.map((login, index) => (
              <div key={index} className="border-b border-line/40 py-1 last:border-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-mono text-[11.5px] text-accent">{login.user}</span>
                  <span className="shrink-0 font-mono text-[10px] text-fg-dim">{login.when}</span>
                </div>
                <div className="truncate font-mono text-[10.5px] text-fg-dim">{login.from}</div>
              </div>
            ))}
          </Card>

          {/* --------------------------------------------------- portlar */}
          <Card icon={PlugIcon} title="Dinlenen portlar" className="lg:col-span-2">
            {data.ports.length === 0 && (
              <p className="text-[12px] text-fg-dim">Port bilgisi okunamadı.</p>
            )}
            <div className="grid grid-cols-2 gap-x-6">
              {data.ports.map((port, index) => (
                <div
                  key={index}
                  className="flex items-baseline gap-3 border-b border-line/40 py-[3px]"
                >
                  <span className="w-12 shrink-0 font-mono text-[11.5px] text-accent">
                    {port.port}
                  </span>
                  <span className="w-10 shrink-0 font-mono text-[10.5px] uppercase text-fg-dim">
                    {port.protocol}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-fg-dim">
                    {port.process ?? port.address}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card icon={ThermometerIcon} title="Sıcaklık">
            <div className="font-mono text-[26px] font-bold">
              {data.temperatureCelsius === null
                ? 'N/A'
                : `${data.temperatureCelsius.toFixed(1)}°`}
            </div>
            <p className="mt-1 text-[11px] text-fg-dim">
              {data.temperatureCelsius === null
                ? 'Bu sunucuda sensör okunamıyor (sanal makinelerde olağan).'
                : 'En yüksek sıcaklık'}
            </p>
          </Card>
        </div>

        <p className="mt-3 text-center font-mono text-[10px] text-fg-dim">
          son toplama: {new Date(data.collectedAt).toLocaleTimeString('tr-TR')}
        </p>
      </div>
    </div>
  );
}
