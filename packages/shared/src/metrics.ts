import { z } from 'zod';

/**
 * Sunucu metrikleri.
 *
 * Tümü kabuk komutlarıyla toplanıyor — hedef sunuculara ajan kurmak
 * gerekmiyor. Bu, kurumsal ortamda uygulamanın benimsenmesini kolaylaştıran
 * bilinçli bir kısıt: sshby'yi kullanmak için sunuculara hiçbir şey yüklemek
 * gerekmez.
 */

export const cpuMetricSchema = z.object({
  /** Anlık kullanım yüzdesi (iki /proc/stat örneği arasındaki fark). */
  usagePercent: z.number().min(0).max(100),
  cores: z.number().int().positive(),
  load1: z.number().nonnegative(),
  load5: z.number().nonnegative(),
  load15: z.number().nonnegative(),
});

export const memoryMetricSchema = z.object({
  totalBytes: z.number().int().nonnegative(),
  usedBytes: z.number().int().nonnegative(),
  freeBytes: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
  swapTotalBytes: z.number().int().nonnegative(),
  swapUsedBytes: z.number().int().nonnegative(),
});

export const networkInterfaceSchema = z.object({
  name: z.string(),
  address: z.string().nullable(),
  up: z.boolean(),
});

export const processMetricSchema = z.object({
  command: z.string(),
  cpuPercent: z.number().nonnegative(),
  memoryPercent: z.number().nonnegative(),
});

export const listeningPortSchema = z.object({
  port: z.number().int().nonnegative(),
  protocol: z.string(),
  address: z.string(),
  process: z.string().nullable(),
});

export const sshLoginSchema = z.object({
  user: z.string(),
  from: z.string(),
  when: z.string(),
});

export const systemInfoSchema = z.object({
  hostname: z.string(),
  operatingSystem: z.string(),
  kernel: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
});

export const storageMetricSchema = z.object({
  mount: z.string(),
  usedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  availableBytes: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
});

export const metricsSnapshotSchema = z.object({
  collectedAt: z.string(),
  cpu: cpuMetricSchema,
  memory: memoryMetricSchema,
  system: systemInfoSchema,
  storage: z.array(storageMetricSchema),
  network: z.array(networkInterfaceSchema),
  processes: z.array(processMetricSchema),
  processCount: z.object({ total: z.number().int(), running: z.number().int() }),
  ports: z.array(listeningPortSchema),
  logins: z.array(sshLoginSchema),
  /** Santigrat; okunamazsa null (sanal makinelerde sensör yok). */
  temperatureCelsius: z.number().nullable(),
});

export type CpuMetric = z.infer<typeof cpuMetricSchema>;
export type MemoryMetric = z.infer<typeof memoryMetricSchema>;
export type NetworkInterface = z.infer<typeof networkInterfaceSchema>;
export type ProcessMetric = z.infer<typeof processMetricSchema>;
export type ListeningPort = z.infer<typeof listeningPortSchema>;
export type SshLogin = z.infer<typeof sshLoginSchema>;
export type SystemInfo = z.infer<typeof systemInfoSchema>;
export type StorageMetric = z.infer<typeof storageMetricSchema>;
export type MetricsSnapshot = z.infer<typeof metricsSnapshotSchema>;
