import { z } from 'zod';

/**
 * Ortam değişkenleri tek yerde doğrulanır ve süreç açılışında patlar.
 * Yanlış yapılandırılmış bir pod'un "sağlıklı" görünüp ilk isteği almasındansa
 * hiç açılmaması yeğdir.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

  /**
   * Kredensiyel şifrelemesinin kök anahtarı: base64 kodlanmış 32 bayt.
   * Kaybedilirse kasadaki hiçbir gizli veri geri getirilemez.
   */
  SSHBY_MASTER_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'base64 kodlanmış tam 32 bayt olmalı'),
  /** Anahtar rotasyonunda artırılır; yeni kayıtlar bu sürümle yazılır. */
  SSHBY_MASTER_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  /**
   * Rotasyon sırasında eski anahtarlarla yazılmış kayıtları çözebilmek için:
   * "2:<base64>,1:<base64>" biçiminde.
   */
  SSHBY_MASTER_KEY_PREVIOUS: z.string().optional(),

  JWT_SECRET: z.string().min(32, 'en az 32 karakter olmalı'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(15 * 60),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().default(30 * 24 * 60 * 60),

  /** Tarayıcının uygulamaya eriştiği kök adres — cookie ve CORS için. */
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:8080'),
  COOKIE_SECURE: z
    .enum(['true', 'false', 'auto'])
    .default('auto')
    .transform((v) => v),

  /** Vite dev sunucusundan gelen isteklere izin verilsin mi. */
  DEV_CORS_ORIGIN: z.string().optional(),

  /** SSH bağlantısı bu süre içinde kurulamazsa iptal edilir. */
  SSH_CONNECT_TIMEOUT_MS: z.coerce.number().int().default(15_000),
  SSH_KEEPALIVE_INTERVAL_MS: z.coerce.number().int().default(20_000),
  /** Bir kullanıcının aynı anda açabileceği azami SSH oturumu. */
  SSH_MAX_SESSIONS_PER_USER: z.coerce.number().int().default(20),

  /** SFTP bağlantısı bu süre boyunca kullanılmazsa kapatılır. */
  SFTP_IDLE_TIMEOUT_MS: z.coerce.number().int().default(5 * 60 * 1000),
  /** Tek dosya yükleme sınırı. */
  SFTP_MAX_UPLOAD_BYTES: z.coerce.number().int().default(2 * 1024 * 1024 * 1024),
  /**
   * Sudo parolasının bellekte tutulma süresi. Kısa tutmak güvenli ama
   * kullanıcıyı sık sık sorguya çeker; 15 dakika sudo'nun kendi varsayılanına
   * (5 dk) yakın ama dosya gezmeye yetecek kadar uzun.
   */
  SUDO_PASSWORD_TTL_MS: z.coerce.number().int().default(15 * 60 * 1000),

  /** Denetim kuyruğunun ES'e boşaltılma sıklığı. */
  AUDIT_FLUSH_INTERVAL_MS: z.coerce.number().int().default(2000),
  AUDIT_BULK_SIZE: z.coerce.number().int().default(500),
  /**
   * Gönderilmiş denetim satırları bu süre sonunda silinir. Varsayılan 30 gün.
   *
   * Süre kısa tutulamaz: `audit_outbox` yalnızca bir kuyruk değil, aynı zamanda
   * YEREL denetim deposu. Komut geçmişi paneli ve gösterge panelindeki son
   * etkinlikler bu tablodan okuyor ve Elasticsearch açık olmayan kurulumlarda
   * başka kaynak yok. Bir saatlik saklama denenmişti; gönderim başarılı olur
   * olmaz komut geçmişi boşalıyordu.
   */
  AUDIT_RETAIN_SHIPPED_MS: z.coerce.number().int().default(30 * 24 * 60 * 60 * 1000),
  /**
   * Katı mod: denetim ES'e yazılamıyorsa yeni SSH oturumu açılmasına izin verilmez.
   * "kayıt tutulamıyorsa bağlanma" politikası olan ortamlar için.
   */
  AUDIT_STRICT_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(kök)'}: ${i.message}`)
      .join('\n');
    // Bilerek logger'dan önce: env okunamadıysa logger da kurulamamıştır.
    console.error(`Ortam değişkenleri geçersiz:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';

/** `auto` iken: public origin https ise güvenli cookie kullan. */
export const cookieSecure =
  env.COOKIE_SECURE === 'auto' ? env.PUBLIC_ORIGIN.startsWith('https://') : env.COOKIE_SECURE === 'true';
