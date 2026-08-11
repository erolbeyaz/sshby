import type { FastifyRequest } from 'fastify';
import {
  AUDIT_CATEGORY,
  auditEventSchema,
  type AuditAction,
  type AuditEvent,
  type AuditOutcome,
} from '@sshby/shared';
import { db } from '../db/client.js';
import { auditOutbox } from '../db/schema.js';
import { logger } from './logger.js';

/**
 * Denetim olayı yayınlama.
 *
 * Olay doğrudan Elasticsearch'e değil, önce `audit_outbox` tablosuna yazılır.
 * ES kapalı ya da yavaş olduğunda ne olay kaybolur ne de kullanıcının isteği
 * bekler. Kuyruğu Faz 6'daki gönderici boşaltır.
 */

export interface AuditActor {
  id: string;
  email: string;
  role: string;
}

export interface AuditInput {
  action: AuditAction;
  outcome?: AuditOutcome;
  actor?: AuditActor | null;
  request?: FastifyRequest;
  durationMs?: number;
  server?: AuditEvent['server'];
  file?: AuditEvent['file'];
  sessionId?: string;
  command?: string;
  settingKey?: string;
  targetUserId?: string;
  errorMessage?: string;
  /** Serbest ek alanlar. Gizli veri koymayın — bu alan olduğu gibi indekslenir. */
  detail?: Record<string, unknown>;
  /** Metrik toplayıcı gibi arka plan işleri için 'system'. */
  source?: 'user' | 'system';
}

export function buildAuditEvent(input: AuditInput): AuditEvent {
  const event: AuditEvent = {
    '@timestamp': new Date().toISOString(),
    event: {
      action: input.action,
      category: AUDIT_CATEGORY[input.action],
      outcome: input.outcome ?? 'success',
      ...(input.durationMs !== undefined ? { duration_ms: Math.round(input.durationMs) } : {}),
    },
    sshby: {
      source: input.source ?? 'user',
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
      ...(input.command ? { command: input.command } : {}),
      ...(input.settingKey ? { setting_key: input.settingKey } : {}),
      ...(input.targetUserId ? { target_user_id: input.targetUserId } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
    },
  };

  if (input.actor) {
    event.user = {
      id: input.actor.id,
      email: input.actor.email,
      roles: [input.actor.role],
    };
  }

  if (input.request) {
    event.client = {
      ip: input.request.ip,
      user_agent: input.request.headers['user-agent'],
    };
  }

  if (input.server) event.server = input.server;
  if (input.file) event.file = input.file;
  if (input.errorMessage) event.error = { message: input.errorMessage };

  return event;
}

/**
 * Olayı kuyruğa yazar.
 *
 * Denetim yazımı kullanıcının işlemini engellememeli: burada hata olursa
 * loglanır ama isteğe yansıtılmaz. Tek istisna, denetimin işlemle aynı
 * veritabanı işleminde olması gereken yerler — orada `tx` geçirilir.
 */
export async function emitAudit(input: AuditInput): Promise<void> {
  try {
    const event = buildAuditEvent(input);
    // Şemayı burada doğruluyoruz: bozuk bir olayın kuyrukta birikip her
    // gönderim denemesinde patlamasındansa yazım anında yakalanması iyi.
    const parsed = auditEventSchema.parse(event);
    await db.insert(auditOutbox).values({ payload: parsed });
  } catch (err) {
    logger.error({ err, action: input.action }, 'Denetim olayı kuyruğa yazılamadı');
  }
}
