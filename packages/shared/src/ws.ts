import { z } from 'zod';

/**
 * Terminal ve metrik WebSocket protokolü.
 *
 * Kontrol mesajları JSON metin çerçevesi olarak gider. Terminal veri akışı
 * (her iki yönde) **ikili** çerçeve olarak gider — her tuş vuruşunu JSON'a
 * sarmak hem gecikme hem de çöp üretimi anlamına gelirdi.
 */

// ---- istemci -> sunucu -------------------------------------------------

export const clientTerminalMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
  }),
  /** TOFU diyaloğunda kullanıcının verdiği karar. */
  z.object({
    type: z.literal('hostkey_decision'),
    fingerprint: z.string(),
    accept: z.boolean(),
  }),
  /**
   * Kasada kaydı olmayan sunucular için oturum anında girilen parola.
   * Sunucuda hiçbir yere yazılmaz; yalnızca bu bağlantı için kullanılır.
   */
  z.object({
    type: z.literal('auth_response'),
    password: z.string().max(1024),
    /** Kullanıcı vazgeçtiyse bağlantı kapatılır. */
    cancelled: z.boolean().default(false),
  }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientTerminalMessage = z.infer<typeof clientTerminalMessageSchema>;

// ---- sunucu -> istemci -------------------------------------------------

export const hostKeyPromptSchema = z.object({
  type: z.literal('hostkey_prompt'),
  /** Daha önce kabul edilmiş bir anahtar varsa dolu gelir — değişim uyarısı gösterilir. */
  knownFingerprint: z.string().nullable(),
  fingerprint: z.string(),
  algorithm: z.string(),
  hostLabel: z.string(),
});

export const serverTerminalMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('status'),
    state: z.enum(['connecting', 'authenticating', 'ready', 'closed']),
    message: z.string().optional(),
  }),
  hostKeyPromptSchema,
  /**
   * Sunucuya kasadan kimlik atanmamışsa parola bu istekle sorulur. Parolayı
   * saklamamak bilinçli: tek seferlik erişimlerde kullanıcıyı kasaya kayıt
   * eklemeye zorlamak, gereğinden fazla gizli veri biriktirmeye yol açar.
   */
  z.object({
    type: z.literal('auth_prompt'),
    hostLabel: z.string(),
    username: z.string(),
    /** Sunucu parolayı reddettiyse tekrar sorarken true gelir. */
    retry: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    /** Host key değiştiğinde true — istemci kırmızı, kalıcı uyarı gösterir. */
    fatal: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('session'),
    sessionId: z.string(),
    /** Durum çubuğundaki mor "iz:" etiketinde gösterilir. */
    auditIndex: z.string().nullable(),
  }),
  z.object({ type: z.literal('pong') }),
]);
export type ServerTerminalMessage = z.infer<typeof serverTerminalMessageSchema>;

// ---- metrikler ---------------------------------------------------------

export const diskUsageSchema = z.object({
  mount: z.string(),
  filesystem: z.string(),
  totalBytes: z.number(),
  usedBytes: z.number(),
  usePercent: z.number(),
});

export const processInfoSchema = z.object({
  pid: z.number(),
  user: z.string(),
  cpuPercent: z.number(),
  memPercent: z.number(),
  command: z.string(),
});

export const metricSampleSchema = z.object({
  type: z.literal('sample'),
  at: z.string().datetime(),
  /** İlk örnekte delta hesaplanamaz, cpu null gelir. */
  cpuPercent: z.number().nullable(),
  cpuCores: z.number(),
  load: z.tuple([z.number(), z.number(), z.number()]),
  uptimeSeconds: z.number(),
  memory: z.object({
    totalBytes: z.number(),
    usedBytes: z.number(),
    availableBytes: z.number(),
    swapTotalBytes: z.number(),
    swapUsedBytes: z.number(),
  }),
  network: z.object({
    rxBytesPerSec: z.number().nullable(),
    txBytesPerSec: z.number().nullable(),
  }),
  disks: z.array(diskUsageSchema),
  topProcesses: z.array(processInfoSchema),
});
export type MetricSample = z.infer<typeof metricSampleSchema>;

export const serverMetricMessageSchema = z.discriminatedUnion('type', [
  metricSampleSchema,
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type ServerMetricMessage = z.infer<typeof serverMetricMessageSchema>;

/** Metrik örnekleme aralığı (ms). Sunucuya yük bindirmeyecek kadar seyrek. */
export const METRIC_INTERVAL_MS = 5000;
/** İstemcinin sparkline için tuttuğu örnek sayısı — 5 dakika. */
export const METRIC_HISTORY_POINTS = (5 * 60 * 1000) / METRIC_INTERVAL_MS;
