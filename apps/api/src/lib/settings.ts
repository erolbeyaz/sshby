import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DEFAULT_AUDIT_INDEX_PREFIX, registrationSettingsSchema } from '@sshby/shared';
import { db } from '../db/client.js';
import { appSettings } from '../db/schema.js';

/**
 * Çalışma zamanında admin tarafından değiştirilebilen ayarlar. Ortam
 * değişkenlerinden farkı: bunlar yeniden dağıtım gerektirmeden, uygulama
 * içinden değişir ve her değişiklik denetime yazılır.
 */

export const elasticsearchSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Birden çok düğüm verilebilir; istemci aralarında dolaşır. */
  nodes: z.array(z.string().url()).default([]),
  auth: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('none') }),
      z.object({ type: z.literal('basic'), username: z.string(), password: z.string() }),
      z.object({ type: z.literal('apiKey'), apiKey: z.string() }),
    ])
    .default({ type: 'none' }),
  /** Kurum içi CA ile imzalı ES için PEM sertifika. */
  caCert: z.string().nullable().default(null),
  /**
   * Yalnızca kurulum aşamasında açılmalı. Açıkken denetim trafiği MITM'e
   * karşı korumasız kalır; UI'da bunu açıkça uyarı olarak gösteriyoruz.
   */
  insecureSkipTlsVerify: z.boolean().default(false),
  indexPrefix: z.string().min(1).default(DEFAULT_AUDIT_INDEX_PREFIX),
  /** ILM ile silme süresi (gün). 0 = otomatik silme yok. */
  retentionDays: z.number().int().min(0).default(90),
});
export type ElasticsearchSettings = z.infer<typeof elasticsearchSettingsSchema>;

// Kayıt politikasının şeması istemciyle ortak; @sshby/shared'dan geliyor.
export { registrationSettingsSchema };
export type { RegistrationSettings } from '@sshby/shared';

const SETTING_DEFS = {
  'audit.elasticsearch': elasticsearchSettingsSchema,
  registration: registrationSettingsSchema,
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;
type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFS)[K]>;

/**
 * Ayarlar her SSH bağlantısında ve her denetim yazımında okunuyor; her seferinde
 * veritabanına gitmemek için kısa ömürlü önbellek. TTL bilerek küçük: admin bir
 * ayarı değiştirdiğinde en geç birkaç saniyede tüm pod'lar yakalar.
 */
const CACHE_TTL_MS = 5_000;
const cache = new Map<SettingKey, { value: unknown; expiresAt: number }>();

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as SettingValue<K>;
  }

  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  // Kayıt yoksa şemanın kendi varsayılanlarıyla doldur — ilk açılışta ayar
  // satırlarını seed etmek zorunda kalmıyoruz.
  const parsed = SETTING_DEFS[key].parse(row?.value ?? {}) as SettingValue<K>;
  cache.set(key, { value: parsed, expiresAt: Date.now() + CACHE_TTL_MS });
  return parsed;
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
  updatedBy: string | null,
): Promise<SettingValue<K>> {
  const parsed = SETTING_DEFS[key].parse(value) as SettingValue<K>;
  await db
    .insert(appSettings)
    .values({ key, value: parsed, updatedBy })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: parsed, updatedBy, updatedAt: sql`now()` },
    });
  cache.delete(key);
  return parsed;
}

/** Testler ve ayar değişikliği sonrası anlık tutarlılık için. */
export function invalidateSettingsCache(): void {
  cache.clear();
}
