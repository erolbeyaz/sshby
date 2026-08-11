import { z } from 'zod';

/**
 * Denetim olay modeli.
 *
 * Alan adları bilerek Elastic Common Schema (ECS) ile hizalandı; Kibana'daki hazır
 * görselleştirmeler ve `user.*` / `event.*` alanlarını bekleyen SIEM kuralları
 * ek eşleme yapmadan çalışsın diye. ECS'te karşılığı olmayan her şey `sshby.*`
 * altında toplanır.
 */

export const AUDIT_ACTIONS = [
  // kimlik
  'auth.register',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.token_refresh',
  // yönetim
  'user.role_change',
  'user.deactivate',
  'user.activate',
  'settings.change',
  // envanter
  'folder.create',
  'folder.update',
  'folder.delete',
  'host.create',
  'host.update',
  'host.delete',
  'host.move',
  'credential.create',
  'credential.update',
  'credential.delete',
  // ssh
  'ssh.connect',
  'ssh.connect_failed',
  'ssh.disconnect',
  'ssh.command',
  'ssh.hostkey_accepted',
  'ssh.hostkey_changed',
  // sftp
  'sftp.list',
  'sftp.download',
  'sftp.upload',
  'sftp.delete',
  'sftp.rename',
  'sftp.mkdir',
  'sftp.chmod',
  // yapılandırma taşıma
  'config.export',
  'config.import',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** ECS `event.category` — hangi aksiyonun hangi kategoriye düştüğü. */
export const AUDIT_CATEGORY: Record<AuditAction, string> = {
  'auth.register': 'authentication',
  'auth.login': 'authentication',
  'auth.login_failed': 'authentication',
  'auth.logout': 'authentication',
  'auth.token_refresh': 'authentication',
  'user.role_change': 'iam',
  'user.deactivate': 'iam',
  'user.activate': 'iam',
  'settings.change': 'configuration',
  'folder.create': 'configuration',
  'folder.update': 'configuration',
  'folder.delete': 'configuration',
  'host.create': 'configuration',
  'host.update': 'configuration',
  'host.delete': 'configuration',
  'host.move': 'configuration',
  'credential.create': 'configuration',
  'credential.update': 'configuration',
  'credential.delete': 'configuration',
  'ssh.connect': 'session',
  'ssh.connect_failed': 'session',
  'ssh.disconnect': 'session',
  'ssh.command': 'process',
  'ssh.hostkey_accepted': 'session',
  'ssh.hostkey_changed': 'session',
  'sftp.list': 'file',
  'sftp.download': 'file',
  'sftp.upload': 'file',
  'sftp.delete': 'file',
  'sftp.rename': 'file',
  'sftp.mkdir': 'file',
  'sftp.chmod': 'file',
  'config.export': 'configuration',
  'config.import': 'configuration',
};

/**
 * Olayı kimin ürettiği. `system` olanlar metrik toplayıcının çalıştırdığı
 * /proc okumaları gibi arka plan komutlarıdır — denetim ekranında varsayılan
 * olarak gizlenir ki kullanıcının gerçekte yazdığı komutlar kaybolmasın.
 */
export const auditSourceSchema = z.enum(['user', 'system']);
export type AuditSource = z.infer<typeof auditSourceSchema>;

export const auditOutcomeSchema = z.enum(['success', 'failure', 'unknown']);
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

export const auditEventSchema = z.object({
  '@timestamp': z.string().datetime(),
  event: z.object({
    action: z.enum(AUDIT_ACTIONS),
    category: z.string(),
    outcome: auditOutcomeSchema,
    duration_ms: z.number().int().nonnegative().optional(),
  }),
  user: z
    .object({
      id: z.string(),
      email: z.string(),
      name: z.string().optional(),
      roles: z.array(z.string()),
    })
    .optional(),
  client: z
    .object({
      ip: z.string().optional(),
      user_agent: z.string().optional(),
    })
    .optional(),
  server: z
    .object({
      host_id: z.string().optional(),
      name: z.string().optional(),
      hostname: z.string().optional(),
      port: z.number().int().optional(),
      username: z.string().optional(),
    })
    .optional(),
  file: z
    .object({
      path: z.string().optional(),
      name: z.string().optional(),
      size: z.number().int().nonnegative().optional(),
      direction: z.enum(['inbound', 'outbound']).optional(),
    })
    .optional(),
  error: z
    .object({
      message: z.string(),
    })
    .optional(),
  sshby: z.object({
    source: auditSourceSchema,
    session_id: z.string().optional(),
    command: z.string().optional(),
    /** Değişen ayarın anahtarı; değerler asla yazılmaz (gizli olabilir). */
    setting_key: z.string().optional(),
    target_user_id: z.string().optional(),
    detail: z.record(z.unknown()).optional(),
  }),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;

/** Günlük indeks adı: `sshby-audit-2026.08.10` */
export function auditIndexName(prefix: string, when: Date = new Date()): string {
  const y = when.getUTCFullYear();
  const m = String(when.getUTCMonth() + 1).padStart(2, '0');
  const d = String(when.getUTCDate()).padStart(2, '0');
  return `${prefix}-${y}.${m}.${d}`;
}

export const DEFAULT_AUDIT_INDEX_PREFIX = 'sshby-audit';
