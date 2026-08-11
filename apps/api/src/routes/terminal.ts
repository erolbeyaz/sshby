import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  clientTerminalMessageSchema,
  type ServerTerminalMessage,
} from '@sshby/shared';
import { auditIndexName } from '@sshby/shared';
import { db } from '../db/client.js';
import { credentials, hosts, users, type HostRow } from '../db/schema.js';
import { emitAudit, type AuditActor } from '../lib/audit.js';
import { assertAuditHealthy } from '../lib/audit/shipper.js';
import { signWsTicket, verifyWsTicket } from '../lib/auth/ws-ticket.js';
import { resolveCredentialSecret } from '../lib/credentials.js';
import { badRequest, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { CommandRecorder } from '../lib/ssh/command-recorder.js';
import { checkHostKey, trustHostKey } from '../lib/ssh/host-key.js';
import {
  assertCanOpenSession,
  registerSession,
  unregisterSession,
} from '../lib/ssh/session-registry.js';
import { Client, type ClientChannel } from '../lib/ssh/ssh2.js';
import { env } from '../env.js';
import { requireUser } from '../plugins/auth.js';
import { resolveUsername } from './inventory.js';
import { getSetting } from '../lib/settings.js';

/** Kullanıcının gördüğü sunucu etiketi — denetim ve hata mesajlarında ortak. */
function hostLabel(host: HostRow, username: string): string {
  return `${username}@${host.hostname}:${host.port}`;
}

function send(socket: WebSocket, message: ServerTerminalMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

/** SSH kütüphanesinin İngilizce hatalarını kullanıcıya anlamlı Türkçeye çevirir. */
function describeSshError(error: Error & { level?: string; code?: string }): string {
  const raw = error.message ?? '';

  if (error.level === 'client-authentication' || /All configured authentication/i.test(raw)) {
    return 'Kimlik doğrulama başarısız. Kullanıcı adı, parola veya anahtarı kontrol edin.';
  }
  if (error.code === 'ENOTFOUND' || /getaddrinfo/i.test(raw)) {
    return 'Sunucu adresi çözümlenemedi. Adresi ve DNS ayarlarını kontrol edin.';
  }
  if (error.code === 'ECONNREFUSED') {
    return 'Bağlantı reddedildi. SSH servisi çalışmıyor ya da port kapalı olabilir.';
  }
  if (error.code === 'ETIMEDOUT' || /Timed out/i.test(raw)) {
    return 'Bağlantı zaman aşımına uğradı. Sunucuya ağdan erişilemiyor olabilir.';
  }
  if (/Cannot parse privateKey|Unsupported key format/i.test(raw)) {
    return 'Özel anahtar okunamadı. Kasadaki anahtarı kontrol edin.';
  }
  return `Bağlantı kurulamadı: ${raw}`;
}

/**
 * HTTP uçları `/api` altında. Bilet uç noktası burada: tarayıcı WebSocket'e
 * Authorization başlığı ekleyemediği için önce buradan kısa ömürlü bir bilet
 * alınır.
 */
export async function registerTerminalHttpRoutes(app: FastifyInstance): Promise<void> {
  app.post('/terminal/ticket', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);
    const { hostId } = request.body as { hostId?: string };
    if (!hostId) throw badRequest('host_required', 'Sunucu kimliği gerekli.');

    const [host] = await db
      .select()
      .from(hosts)
      .where(and(eq(hosts.id, hostId), eq(hosts.ownerId, user.id)))
      .limit(1);
    if (!host) throw notFound('Sunucu bulunamadı.');

    /**
     * Kimlik bilgisi zorunlu DEĞİL. Atanmamışsa parola bağlantı anında
     * kullanıcıya sorulur ve hiçbir yere yazılmaz — tek seferlik erişimler
     * için kasaya kayıt eklemeye zorlamak gereksiz gizli veri biriktirir.
     * Bu durumda kullanıcı adının sunucu kaydında bulunması şart, çünkü
     * devralınacak bir kimlik yok.
     */
    if (!host.credentialId && !host.username?.trim()) {
      throw badRequest(
        'username_required',
        'Bu sunucuda kimlik bilgisi de kullanıcı adı da yok. Sunucuyu düzenleyip ' +
          'en azından bir SSH kullanıcı adı yazın.',
      );
    }

    if (host.credentialId) {
      /**
       * Kimlik bilgisi sahipliği envanter uçlarında da doğrulanıyor; burada bir
       * kez daha bakıyoruz. Eski kayıtlar (bu kontrol eklenmeden önce yazılmış)
       * ya da ileride açılabilecek paylaşım özellikleri yüzünden bu katmanın
       * kendi başına doğru davranması gerekiyor.
       */
      const [ownedCredential] = await db
        .select({ id: credentials.id })
        .from(credentials)
        .where(and(eq(credentials.id, host.credentialId), eq(credentials.ownerId, user.id)))
        .limit(1);
      if (!ownedCredential) {
        throw badRequest(
          'credential_not_owned',
          'Bu sunucuya atanmış kimlik bilgisi kasanızda yok. Sunucuyu düzenleyip kendi kasanızdan bir kayıt seçin.',
        );
      }
    }

    // Oturum sınırı burada da kontrol ediliyor: kullanıcı hatayı WebSocket
    // kapanma koduyla değil, düzgün bir HTTP yanıtıyla görsün.
    assertCanOpenSession(user.id);

    // Katı mod açıksa denetim yazılamıyorken yeni oturum açılmaz.
    await assertAuditHealthy();

    return {
      ticket: await signWsTicket({
        sub: user.id,
        sid: user.sessionId,
        hostId,
        scope: 'terminal',
      }),
    };
  });
}

/**
 * WebSocket uçları `/ws` altında, `/api` altında değil.
 *
 * Ters vekil `/api/` konumunda `Connection ""` başlığı kuruyor (keepalive'lı
 * upstream için gerekli), bu da Upgrade el sıkışmasını sessizce bozar.
 * WebSocket trafiğini ayrı bir konuma almak iki davranışı da bozmadan
 * yaşatmanın en temiz yolu.
 */
export async function registerTerminalWsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/terminal', { websocket: true }, (socket, request) => {
    // Fastify'ın hata yöneticisi WebSocket kapsamında çalışmıyor; bu yüzden
    // tüm kurulum kendi try/catch'i olan bir async fonksiyona alınıyor.
    void openTerminalSession(socket, request.query as Record<string, string>, request.ip).catch(
      (err) => {
        logger.error({ err }, 'Terminal oturumu kurulamadı');
        send(socket, {
          type: 'error',
          code: 'internal_error',
          message: 'Terminal oturumu açılamadı.',
          fatal: true,
        });
        socket.close();
      },
    );
  });
}

async function openTerminalSession(
  socket: WebSocket,
  query: Record<string, string>,
  clientIp: string,
): Promise<void> {
  const sessionId = randomUUID();
  const startedAt = Date.now();

  // ---- bilet doğrulama ----
  let claims;
  try {
    claims = await verifyWsTicket(query.ticket ?? '', 'terminal');
  } catch {
    send(socket, {
      type: 'error',
      code: 'invalid_ticket',
      message: 'Bağlantı bileti geçersiz veya süresi dolmuş. Sayfayı yenileyin.',
      fatal: true,
    });
    socket.close();
    return;
  }

  // ---- sunucu ve kimlik bilgisi ----
  const [host] = await db
    .select()
    .from(hosts)
    .where(and(eq(hosts.id, claims.hostId), eq(hosts.ownerId, claims.sub)))
    .limit(1);

  if (!host) {
    send(socket, {
      type: 'error',
      code: 'host_unavailable',
      message: 'Sunucu bulunamadı.',
      fatal: true,
    });
    socket.close();
    return;
  }

  /**
   * Kimlik bilgisi varsa kasadan çözülür; yoksa parola birazdan kullanıcıya
   * sorulacak (aşağıda, host anahtarı doğrulandıktan sonra).
   */
  const vaulted = host.credentialId
    ? await resolveCredentialSecret(host.credentialId, claims.sub)
    : null;

  /**
   * Kullanıcı adı sunucuda boş bırakılmışsa kimlik bilgisinden devralınır.
   * Çözüm sırası envanter katmanıyla aynı; ayrışmaması için tek yardımcı.
   */
  const sshUsername = resolveUsername(host.username, vaulted?.row.username);
  if (!sshUsername) {
    send(socket, {
      type: 'error',
      code: 'username_missing',
      message:
        'SSH kullanıcı adı belirlenemedi. Sunucuyu düzenleyip bir kullanıcı adı yazın ' +
        'ya da kasadaki kimlik bilgisine varsayılan kullanıcı adı ekleyin.',
      fatal: true,
    });
    socket.close();
    return;
  }

  /**
   * Denetim aktörü. WebSocket kapsamında `request.user` yok; bileti doğruladık
   * ama denetim kaydında e-posta ve rol de bulunmalı, o yüzden kullanıcı satırı
   * bir kez okunuyor.
   */
  const [userRow] = await db
    .select({ email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);

  const actor: AuditActor = {
    id: claims.sub,
    email: userRow?.email ?? '',
    role: userRow?.role ?? 'user',
  };
  const serverInfo = {
    host_id: host.id,
    name: host.name,
    hostname: host.hostname,
    port: host.port,
    username: sshUsername,
  };

  // Durum çubuğundaki "iz:" etiketi — denetimin nereye aktığını kullanıcı görsün.
  const esSettings = await getSetting('audit.elasticsearch');
  const auditIndexLabel = esSettings.enabled ? auditIndexName(esSettings.indexPrefix) : null;

  try {
    assertCanOpenSession(claims.sub);
  } catch (err) {
    send(socket, {
      type: 'error',
      code: 'session_limit',
      message: err instanceof Error ? err.message : 'Oturum sınırına ulaşıldı.',
      fatal: true,
    });
    socket.close();
    return;
  }

  send(socket, { type: 'status', state: 'connecting' });

  const conn = new Client();
  let stream: ClientChannel | null = null;
  let closed = false;

  /** Host key kararı bekleyen çözücü — istemciden yanıt gelince tetiklenir. */
  let pendingHostKey: { fingerprint: string; resolve: (accepted: boolean) => void } | null = null;
  /** Parola bekleyen çözücü (kasada kayıt olmayan sunucular için). */
  let pendingAuth: ((password: string | null) => void) | null = null;

  /**
   * Kullanıcıdan tek seferlik parola ister.
   *
   * Parola yalnızca bu değişkende yaşar; kasaya yazılmaz, denetime yazılmaz,
   * loglanmaz. Kullanıcı vazgeçerse ya da yanıt gelmezse null döner.
   */
  // Daraltılmış değerleri sabitlere alıyoruz: TypeScript, fonksiyon bildirimi
  // içinde dış kapsamdaki daraltmayı koruyamıyor.
  const targetHost = host;
  const targetUsername = sshUsername;

  function askPassword(retry: boolean): Promise<string | null> {
    send(socket, {
      type: 'auth_prompt',
      hostLabel: hostLabel(targetHost, targetUsername),
      username: targetUsername,
      retry,
    });

    return new Promise<string | null>((resolve) => {
      pendingAuth = resolve;
      // Yanıtsız kalan bir istem bağlantıyı süresiz açık tutmasın.
      setTimeout(() => {
        if (pendingAuth === resolve) {
          pendingAuth = null;
          resolve(null);
        }
      }, 120_000).unref();
    });
  }

  const recorder = new CommandRecorder((command) => {
    void emitAudit({
      action: 'ssh.command',
      actor,
      sessionId,
      command,
      server: serverInfo,
    });
  });

  function finish(reason: string, outcome: 'success' | 'failure' = 'success'): void {
    if (closed) return;
    closed = true;

    recorder.dispose();
    unregisterSession(sessionId);
    try {
      conn.end();
    } catch {
      // Bağlantı zaten kopmuş olabilir.
    }

    void emitAudit({
      action: 'ssh.disconnect',
      outcome,
      actor,
      sessionId,
      server: serverInfo,
      durationMs: Date.now() - startedAt,
      detail: { reason },
    });

    if (socket.readyState === socket.OPEN) socket.close();
  }

  // ---- host anahtarı doğrulama (TOFU) ----
  conn.on('error', (err: Error) => {
    const message = describeSshError(err);
    send(socket, { type: 'error', code: 'ssh_error', message, fatal: true });
    void emitAudit({
      action: 'ssh.connect_failed',
      outcome: 'failure',
      actor,
      sessionId,
      server: serverInfo,
      errorMessage: message,
      durationMs: Date.now() - startedAt,
    });
    finish('error', 'failure');
  });

  /**
   * `keyboard-interactive`: sunucu parolayı bu yöntemle isterse elimizdeki
   * parolayı veriyoruz. Yanıt dizisi soru sayısı kadar olmalı.
   */
  conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finishAuth) => {
    const answer =
      vaulted?.secret.type === 'password' ? vaulted.secret.password : (interactivePassword ?? '');
    finishAuth(prompts.map(() => answer));
  });

  conn.on('ready', () => {
    void emitAudit({
      action: 'ssh.connect',
      actor,
      sessionId,
      server: serverInfo,
      durationMs: Date.now() - startedAt,
      // Denetimde kimliğin nereden geldiği görünsün: kasadan mı, elle mi.
      detail: { credentialName: vaulted?.row.name ?? null, interactiveAuth: !vaulted },
    });

    const cols = Number(query.cols) || 80;
    const rows = Number(query.rows) || 24;

    conn.shell({ term: 'xterm-256color', cols, rows }, (err, channel) => {
      if (err) {
        send(socket, {
          type: 'error',
          code: 'shell_failed',
          message: `Kabuk açılamadı: ${err.message}`,
          fatal: true,
        });
        finish('shell_failed', 'failure');
        return;
      }

      stream = channel;

      /**
       * `ready` ancak kabuk kanalı açıldıktan sonra gönderilir. Daha erken
       * gönderildiğinde istemci hemen yazmaya başlıyor ama `stream` henüz
       * kurulmadığı için ilk komut sessizce kayboluyordu.
       */
      send(socket, { type: 'status', state: 'ready' });
      send(socket, { type: 'session', sessionId, auditIndex: auditIndexLabel });

      channel.on('data', (chunk: Buffer) => {
        recorder.observeOutput(chunk);
        if (socket.readyState === socket.OPEN) socket.send(chunk);
      });
      channel.stderr.on('data', (chunk: Buffer) => {
        if (socket.readyState === socket.OPEN) socket.send(chunk);
      });
      channel.on('close', () => {
        send(socket, { type: 'status', state: 'closed', message: 'Kabuk kapandı.' });
        finish('shell_closed');
      });
    });
  });

  registerSession({
    sessionId,
    userId: claims.sub,
    hostId: host.id,
    hostLabel: hostLabel(host, sshUsername),
    startedAt,
    // SFTP bu bağlantıyı ödünç alır; ikinci kez kimlik doğrulamaya gerek kalmaz.
    client: conn,
    close: () => finish('forced'),
  });

  socket.on('message', (data: Buffer, isBinary: boolean) => {
    /**
     * İkili çerçeve = tuş vuruşu, metin çerçeve = kontrol mesajı. Ayrımı
     * çerçeve tipiyle yapmak, her tuşu JSON'a sarmaktan hem hızlı hem de
     * kullanıcının yazdığı JSON benzeri metinlerin yanlış yorumlanmasını
     * imkânsız kılıyor.
     */
    if (isBinary) {
      recorder.observeInput(data);
      stream?.write(data);
      return;
    }

    let parsed;
    try {
      parsed = clientTerminalMessageSchema.parse(JSON.parse(data.toString('utf8')));
    } catch {
      return; // Bozuk kontrol mesajını sessizce yok say.
    }

    switch (parsed.type) {
      case 'resize':
        stream?.setWindow(parsed.rows, parsed.cols, 0, 0);
        break;

      case 'hostkey_decision':
        if (pendingHostKey && pendingHostKey.fingerprint === parsed.fingerprint) {
          const resolve = pendingHostKey.resolve;
          pendingHostKey = null;
          resolve(parsed.accept);
        }
        break;

      case 'auth_response':
        if (pendingAuth) {
          const resolve = pendingAuth;
          pendingAuth = null;
          resolve(parsed.cancelled ? null : parsed.password);
        }
        break;

      case 'ping':
        send(socket, { type: 'pong' });
        break;
    }
  });

  socket.on('close', () => finish('client_closed'));

  send(socket, { type: 'status', state: 'authenticating' });

  /**
   * Kimlik bilgisi kasada yoksa parolayı burada, bağlanmadan hemen önce
   * soruyoruz. ssh2'nin `keyboard-interactive` olayı da kullanılabilirdi ama
   * o yol yalnızca sunucu bu yöntemi sunduğunda çalışır; parolayı önden almak
   * hem `password` hem `keyboard-interactive` için tek kod yolu bırakıyor.
   */
  let interactivePassword: string | null = null;
  if (!vaulted) {
    interactivePassword = await askPassword(false);
    if (interactivePassword === null) {
      send(socket, {
        type: 'error',
        code: 'auth_cancelled',
        message: 'Parola girilmedi, bağlantı iptal edildi.',
        fatal: true,
      });
      finish('auth_cancelled', 'failure');
      return;
    }
  }

  const authOptions = vaulted
    ? vaulted.secret.type === 'password'
      ? { password: vaulted.secret.password }
      : { privateKey: vaulted.secret.privateKey, passphrase: vaulted.secret.passphrase }
    : { password: interactivePassword ?? '' };

  conn.connect({
    host: host.hostname,
    port: host.port,
    username: sshUsername,
    readyTimeout: env.SSH_CONNECT_TIMEOUT_MS,
    keepaliveInterval: env.SSH_KEEPALIVE_INTERVAL_MS,
    ...authOptions,

    /**
     * Bazı sunucular parolayı `keyboard-interactive` üzerinden ister.
     * Elimizdeki parolayı orada da sunuyoruz ki kullanıcıya ikinci kez
     * sorulmasın.
     */
    tryKeyboard: true,

    hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
      void (async () => {
        const verdict = await checkHostKey(claims.sub, host.hostname, host.port, key);

        if (verdict.kind === 'trusted') {
          verify(true);
          return;
        }

        if (verdict.kind === 'changed') {
          // Anahtar değişimi olası bir ortadaki adam saldırısıdır; kullanıcı
          // onaylasa bile olay her hâlükârda denetime düşer.
          void emitAudit({
            action: 'ssh.hostkey_changed',
            outcome: 'failure',
            actor,
            sessionId,
            server: serverInfo,
            detail: {
              knownFingerprint: verdict.knownFingerprint,
              newFingerprint: verdict.fingerprint,
              clientIp,
            },
          });
        }

        send(socket, {
          type: 'hostkey_prompt',
          knownFingerprint: verdict.kind === 'changed' ? verdict.knownFingerprint : null,
          fingerprint: verdict.fingerprint,
          algorithm: verdict.algorithm,
          hostLabel: hostLabel(host, sshUsername),
        });

        const accepted = await new Promise<boolean>((resolve) => {
          pendingHostKey = { fingerprint: verdict.fingerprint, resolve };
          // Kullanıcı yanıtlamazsa bağlantı asılı kalmasın.
          setTimeout(() => {
            if (pendingHostKey?.fingerprint === verdict.fingerprint) {
              pendingHostKey = null;
              resolve(false);
            }
          }, 120_000).unref();
        });

        if (!accepted) {
          verify(false);
          return;
        }

        await trustHostKey(
          claims.sub,
          host.hostname,
          host.port,
          verdict.algorithm,
          verdict.fingerprint,
        );
        void emitAudit({
          action: 'ssh.hostkey_accepted',
          actor,
          sessionId,
          server: serverInfo,
          detail: { fingerprint: verdict.fingerprint, algorithm: verdict.algorithm },
        });
        verify(true);
      })();
    },
  });
}
