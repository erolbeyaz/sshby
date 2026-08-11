import type { MetricsSnapshot, ProcessMetric } from '@sshby/shared';
import { runPlain } from './shell-fs.js';
import type { Client } from './ssh2.js';

/**
 * Metrik toplama.
 *
 * Her şey TEK bir kabuk komutuyla toplanıyor. Ayrı ayrı `exec` açmak her
 * metrik için bir tur gecikme demekti; canlı yenilenen bir panoda bu toplam
 * gecikmeyi saniyelere çıkarıyor. Bölümler `###ETİKET` satırlarıyla ayrılıyor.
 *
 * Komutların hiçbiri sudo gerektirmiyor ve hiçbiri sistemi değiştirmiyor.
 */

const SECTION = '###';

/**
 * CPU kullanımı iki `/proc/stat` örneğinin farkından hesaplanıyor.
 * Tek örnek yalnızca açılıştan beri geçen toplam süreyi verir — anlık
 * kullanımı göstermez, bu yüzden 300 ms arayla iki kez okunuyor.
 */
const COLLECTOR = `
echo "${SECTION}CPU1"; grep '^cpu ' /proc/stat
sleep 0.3
echo "${SECTION}CPU2"; grep '^cpu ' /proc/stat
echo "${SECTION}CORES"; nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo
echo "${SECTION}LOAD"; cat /proc/loadavg
echo "${SECTION}MEM"; grep -E '^(MemTotal|MemAvailable|MemFree|SwapTotal|SwapFree):' /proc/meminfo
echo "${SECTION}UPTIME"; cat /proc/uptime
echo "${SECTION}HOSTNAME"; hostname 2>/dev/null || cat /proc/sys/kernel/hostname
echo "${SECTION}OS"; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -s
echo "${SECTION}KERNEL"; uname -r
echo "${SECTION}DF"; df -P -k 2>/dev/null
echo "${SECTION}ADDR"; ip -o -4 addr show 2>/dev/null || true
echo "${SECTION}LINK"; ip -o link show 2>/dev/null || true
echo "${SECTION}PROC"; ps -eo pcpu,pmem,args --sort=-pcpu 2>/dev/null | head -n 12
echo "${SECTION}PROCCOUNT"; ps -eo stat --no-headers 2>/dev/null | wc -l; ps -eo stat --no-headers 2>/dev/null | grep -c '^R'
echo "${SECTION}PORTS"; (ss -tulnH 2>/dev/null || netstat -tuln 2>/dev/null) | head -n 40
echo "${SECTION}LOGINS"; last -w -n 12 2>/dev/null | grep -v '^$' | grep -v '^wtmp' || true
echo "${SECTION}TEMP"; cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null || true
echo "${SECTION}END"
`.trim();

/** Çıktıyı `###ETİKET` sınırlarına göre bölümlere ayırır. */
function splitSections(output: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;

  for (const line of output.split('\n')) {
    if (line.startsWith(SECTION)) {
      current = [];
      sections.set(line.slice(SECTION.length).trim(), current);
      continue;
    }
    if (current && line.trim().length > 0) current.push(line);
  }
  return sections;
}

/** `cpu 123 45 ...` satırından toplam ve boşta geçen süreyi çıkarır. */
function parseCpuLine(line: string | undefined): { total: number; idle: number } | null {
  if (!line) return null;
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  if (values.length < 5 || values.some((v) => !Number.isFinite(v))) return null;

  // Alan sırası: user nice system idle iowait irq softirq steal ...
  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  const total = values.reduce((sum, v) => sum + v, 0);
  return { total, idle };
}

function kbLine(lines: string[], key: string): number {
  const line = lines.find((l) => l.startsWith(`${key}:`));
  const value = Number(line?.replace(/[^\d]/g, ''));
  return Number.isFinite(value) ? value * 1024 : 0;
}

export async function collectMetrics(client: Client): Promise<MetricsSnapshot> {
  const output = await runPlain(client, COLLECTOR);
  const sections = splitSections(output);
  const get = (key: string): string[] => sections.get(key) ?? [];

  // ---- CPU ----
  const first = parseCpuLine(get('CPU1')[0]);
  const second = parseCpuLine(get('CPU2')[0]);
  let usagePercent = 0;
  if (first && second && second.total > first.total) {
    const totalDelta = second.total - first.total;
    const idleDelta = second.idle - first.idle;
    usagePercent = Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
  }

  const loadParts = (get('LOAD')[0] ?? '').trim().split(/\s+/);
  const cores = Math.max(1, Number(get('CORES')[0]) || 1);

  // ---- bellek ----
  const memLines = get('MEM');
  const totalBytes = kbLine(memLines, 'MemTotal');
  const availableBytes = kbLine(memLines, 'MemAvailable') || kbLine(memLines, 'MemFree');
  const swapTotal = kbLine(memLines, 'SwapTotal');
  const swapFree = kbLine(memLines, 'SwapFree');
  const usedBytes = Math.max(0, totalBytes - availableBytes);

  // ---- disk ----
  const storage = get('DF')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 6)
    .map((parts) => {
      const [filesystem, totalK, usedK, availK, , ...mountParts] = parts;
      return {
        filesystem: filesystem ?? '',
        mount: mountParts.join(' '),
        totalBytes: Number(totalK) * 1024,
        usedBytes: Number(usedK) * 1024,
        availableBytes: Number(availK) * 1024,
      };
    })
    .filter(
      (entry) =>
        entry.mount &&
        entry.totalBytes > 0 &&
        // Sanal dosya sistemleri gerçek disk alanını temsil etmiyor.
        !/^(tmpfs|devtmpfs|udev|overlay|shm|none)$/i.test(entry.filesystem) &&
        !/^\/(proc|sys|dev|run)(\/|$)/.test(entry.mount),
    )
    .map((entry) => ({
      mount: entry.mount,
      usedBytes: entry.usedBytes,
      totalBytes: entry.totalBytes,
      availableBytes: entry.availableBytes,
      percent: Math.round((entry.usedBytes / entry.totalBytes) * 100),
    }))
    .sort((a, b) => (a.mount === '/' ? -1 : b.mount === '/' ? 1 : a.mount.localeCompare(b.mount)));

  // ---- ağ ----
  const addresses = new Map<string, string>();
  for (const line of get('ADDR')) {
    // "2: ens192    inet 10.0.0.5/24 brd ..." → ad ve adres
    const parts = line.trim().split(/\s+/);
    const name = parts[1];
    const inetIndex = parts.indexOf('inet');
    if (name && inetIndex !== -1 && parts[inetIndex + 1]) {
      addresses.set(name, parts[inetIndex + 1]!.split('/')[0] ?? '');
    }
  }

  const network = get('LINK')
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      const name = (parts[1] ?? '').replace(/:$/, '').split('@')[0] ?? '';
      return { name, up: /\bstate UP\b|\bUP\b/.test(line), address: addresses.get(name) ?? null };
    })
    .filter((entry) => entry.name && entry.name !== 'lo');

  // ---- işlemler ----
  const processes: ProcessMetric[] = get('PROC')
    .slice(1)
    .map((line) => {
      const match = line.trim().match(/^(\S+)\s+(\S+)\s+(.*)$/);
      if (!match) return null;
      return {
        cpuPercent: Number(match[1]) || 0,
        memoryPercent: Number(match[2]) || 0,
        command: (match[3] ?? '').slice(0, 120),
      };
    })
    .filter((p): p is ProcessMetric => p !== null);

  const countLines = get('PROCCOUNT');

  // ---- dinlenen portlar ----
  const ports = get('PORTS')
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      // ss: "tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:*"
      const local = parts.find((p) => /:\d+$/.test(p));
      if (!local) return null;
      const port = Number(local.slice(local.lastIndexOf(':') + 1));
      if (!Number.isFinite(port)) return null;

      const processMatch = line.match(/users:\(\("([^"]+)"/);
      return {
        port,
        protocol: (parts[0] ?? '').toLowerCase(),
        address: local.slice(0, local.lastIndexOf(':')),
        process: processMatch?.[1] ?? null,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => a.port - b.port);

  // ---- SSH girişleri ----
  const logins = get('LOGINS')
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) return null;
      return {
        user: parts[0] ?? '',
        from: parts[2] ?? '',
        when: parts.slice(3, 8).join(' '),
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null && l.user.length > 0);

  // ---- sıcaklık ----
  const tempRaw = get('TEMP')
    .map((line) => Number(line.trim()))
    .filter((v) => Number.isFinite(v) && v > 0);
  // /sys değerleri mili-santigrat; en yükseğini gösteriyoruz.
  const temperatureCelsius = tempRaw.length > 0 ? Math.max(...tempRaw) / 1000 : null;

  return {
    collectedAt: new Date().toISOString(),
    cpu: {
      usagePercent: Number(usagePercent.toFixed(1)),
      cores,
      load1: Number(loadParts[0]) || 0,
      load5: Number(loadParts[1]) || 0,
      load15: Number(loadParts[2]) || 0,
    },
    memory: {
      totalBytes,
      usedBytes,
      freeBytes: availableBytes,
      percent: totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 0,
      swapTotalBytes: swapTotal,
      swapUsedBytes: Math.max(0, swapTotal - swapFree),
    },
    system: {
      hostname: get('HOSTNAME')[0]?.trim() ?? 'bilinmiyor',
      operatingSystem: get('OS')[0]?.trim().replace(/^"|"$/g, '') ?? 'bilinmiyor',
      kernel: get('KERNEL')[0]?.trim() ?? 'bilinmiyor',
      uptimeSeconds: Math.floor(Number((get('UPTIME')[0] ?? '0').split(/\s+/)[0]) || 0),
    },
    storage,
    network,
    processes,
    processCount: {
      total: Number(countLines[0]) || 0,
      running: Number(countLines[1]) || 0,
    },
    ports,
    logins,
    temperatureCelsius,
  };
}
