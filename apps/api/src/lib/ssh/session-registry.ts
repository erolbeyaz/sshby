import { env } from '../../env.js';
import { tooManyRequests } from '../errors.js';
import type { Client as SshClient } from './ssh2.js';

/**
 * Açık SSH oturumlarının bellek içi kaydı.
 *
 * Amacı tek bir kullanıcının sunucuyu tüketmesini engellemek. Bellek içi
 * olması, birden fazla API kopyası çalıştığında sınırın kopya başına
 * uygulanacağı anlamına geliyor; kabul edilebilir, çünkü asıl koruma
 * kaynak tüketimine karşı ve her kopyanın kendi kaynağı var.
 */

export interface ActiveSession {
  sessionId: string;
  userId: string;
  hostId: string;
  hostLabel: string;
  startedAt: number;
  /**
   * Oturumun SSH bağlantısı. SFTP bunu yeniden kullanır: aynı sunucuya ikinci
   * kez kimlik doğrulamak hem yavaş hem de etkileşimli parolayla bağlanılmışsa
   * imkânsız (parolayı saklamıyoruz).
   */
  client: SshClient;
  /** Oturumu dışarıdan kapatmak için (yönetici müdahalesi, kapanış). */
  close: () => void;
}

const sessions = new Map<string, ActiveSession>();

function countForUser(userId: string): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.userId === userId) count += 1;
  }
  return count;
}

export function assertCanOpenSession(userId: string): void {
  if (countForUser(userId) >= env.SSH_MAX_SESSIONS_PER_USER) {
    throw tooManyRequests(
      `Aynı anda en fazla ${env.SSH_MAX_SESSIONS_PER_USER} SSH oturumu açabilirsiniz. ` +
        'Kullanmadığınız sekmeleri kapatın.',
    );
  }
}

export function registerSession(session: ActiveSession): void {
  sessions.set(session.sessionId, session);
}

export function unregisterSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/**
 * Bir sunucuya ait açık terminal oturumunun SSH bağlantısını verir.
 * SFTP önce buna bakar; varsa yeni bağlantı kurmaz.
 */
export function findSessionClient(userId: string, hostId: string): SshClient | null {
  for (const session of sessions.values()) {
    if (session.userId === userId && session.hostId === hostId) return session.client;
  }
  return null;
}

export function listSessions(userId?: string): ActiveSession[] {
  const all = [...sessions.values()];
  return userId ? all.filter((s) => s.userId === userId) : all;
}

/** Kapanışta tüm oturumları düzgünce sonlandırmak için. */
export function closeAllSessions(): void {
  for (const session of sessions.values()) {
    try {
      session.close();
    } catch {
      // Kapanış sırasında tek tek hataların süreci engellemesine gerek yok.
    }
  }
  sessions.clear();
}
