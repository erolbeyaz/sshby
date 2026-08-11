import { posix } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import {
  remotePathSchema,
  sftpChmodSchema,
  sftpDeleteSchema,
  sftpMkdirSchema,
  sftpRenameSchema,
  type SftpEntry,
  type SftpEntryType,
  type SftpListResponse,
  type StorageMount,
} from '@sshby/shared';
import type { FileEntryWithStats, SFTPWrapper, Stats } from '../lib/ssh/ssh2.js';
import { emitAudit } from '../lib/audit.js';
import { badRequest, notFound, requireUuid } from '../lib/errors.js';
import { getSftp, getSshClient } from '../lib/ssh/sftp.js';
import { runPlain, streamSudoRead, streamSudoWrite } from '../lib/ssh/shell-fs.js';
import {
  sudoChmod,
  sudoDelete,
  sudoHome,
  sudoList,
  sudoMkdir,
  sudoRename,
  sudoStat,
} from '../lib/ssh/sudo-fs.js';
import {
  forgetSudoPassword,
  getSudoContext,
  hasSudoPassword,
  rememberSudoPassword,
} from '../lib/ssh/sudo-session.js';
import { requireUser } from '../plugins/auth.js';
import { env } from '../env.js';
import { db } from '../db/client.js';
import { hosts } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';

/**
 * SFTP uçları HTTP üzerinden çalışıyor, WebSocket üzerinden değil.
 *
 * Dosya indirme/yükleme doğal olarak akış tabanlı ve HTTP bunu bedavaya
 * veriyor: tarayıcı indirmesi, ilerleme, iptal, aralık istekleri hep hazır.
 * Aynı şeyi WebSocket üzerinde kurmak, çerçeveleme ve akış kontrolünü elle
 * yazmak demekti.
 */

function toEntryType(stats: Stats): SftpEntryType {
  if (stats.isDirectory()) return 'directory';
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isFile()) return 'file';
  return 'other';
}

/** Sekizlik izin dizesi: 0o644 → "0644". */
function toModeString(mode: number): string {
  return `0${(mode & 0o777).toString(8).padStart(3, '0')}`;
}

/** SFTP geri çağrılarını söze çevirir; ssh2 hâlâ callback tabanlı. */
function promisify<T>(fn: (cb: (err: Error | null | undefined, result: T) => void) => void) {
  return new Promise<T>((resolve, reject) => {
    fn((err, result) => (err ? reject(err) : resolve(result)));
  });
}

function promisifyVoid(fn: (cb: (err: Error | null | undefined) => void) => void) {
  return new Promise<void>((resolve, reject) => {
    fn((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * SFTP hatalarını kullanıcıya anlamlı Türkçeye çevirir.
 * ssh2 hata kodları: 2=yok, 3=izin yok, 4=genel, 11=zaten var.
 */
function describeSftpError(err: unknown): never {
  const code = (err as { code?: number }).code;
  const message = err instanceof Error ? err.message : String(err);

  if (code === 2) throw notFound('Dosya ya da dizin bulunamadı.');
  if (code === 3) throw badRequest('permission_denied', 'Bu işlem için sunucuda yetkiniz yok.');
  if (code === 11) throw badRequest('already_exists', 'Bu adda bir dosya ya da dizin zaten var.');
  if (/not empty/i.test(message)) {
    throw badRequest('directory_not_empty', 'Dizin boş değil. Önce içindekileri silin.');
  }
  throw badRequest('sftp_error', `İşlem başarısız: ${message}`);
}

/** Yolu normalleştirir; göreli yol gelirse mutlaklaştırır. */
function normalize(path: string): string {
  const trimmed = path.trim();
  return posix.normalize(trimmed.startsWith('/') ? trimmed : `/${trimmed}`);
}

export async function registerSftpRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Yükleme gövdesi ham akış olarak alınıyor: Fastify'ın varsayılan
   * ayrıştırıcısı tüm dosyayı belleğe toplardı.
   */
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
    done(null, payload);
  });

  /**
   * Sudo modu isteğin `sudo=1` parametresiyle açılır. Kip başına ayrı uç
   * yapmak yerine tek uçta dallanmak, istemcinin her işlem için aynı yolu
   * kullanmasını sağlıyor.
   */
  const wantsSudo = (request: { query?: unknown; body?: unknown }): boolean => {
    const q = (request.query ?? {}) as { sudo?: string };
    const b = (request.body ?? {}) as { sudo?: boolean };
    return q.sudo === '1' || b.sudo === true;
  };

  /** Sudo parolasını doğrular ve oturum belleğine alır. */
  app.post('/sftp/:hostId/sudo', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);
    const hostId = requireUuid((request.params as { hostId?: string }).hostId, 'Sunucu bulunamadı.');
    await hostFor(hostId, user.id);

    const { password } = request.body as { password?: string };
    if (!password) throw badRequest('password_required', 'Sudo parolası gerekli.');

    await rememberSudoPassword(user.id, hostId, password);

    // Denetime yalnızca "sudo modu açıldı" bilgisi düşer, parola asla.
    await emitAudit({
      action: 'sftp.list',
      actor: user,
      request,
      detail: { sudoMode: 'enabled', hostId },
    });

    return { ok: true };
  });

  app.delete('/sftp/:hostId/sudo', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const hostId = requireUuid((request.params as { hostId?: string }).hostId, 'Sunucu bulunamadı.');
    forgetSudoPassword(user.id, hostId);
    return reply.status(204).send();
  });

  app.get('/sftp/:hostId/sudo', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);
    const hostId = requireUuid((request.params as { hostId?: string }).hostId, 'Sunucu bulunamadı.');
    return { active: hasSudoPassword(user.id, hostId) };
  });

  /**
   * Bağlama noktalarının doluluk durumu.
   *
   * `df -P -k`: POSIX çıktı biçimi (`-P`) uzun aygıt adlarında satırın
   * bölünmesini engelliyor, `-k` ise birimi kilobayta sabitliyor — yerele göre
   * değişen "1G" gibi değerleri ayrıştırmak zorunda kalmıyoruz.
   */
  app.get('/sftp/:hostId/storage', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);
    const hostId = requireUuid((request.params as { hostId?: string }).hostId, 'Sunucu bulunamadı.');
    await hostFor(hostId, user.id);

    const client = await getSshClient(user.id, hostId);
    const output = await runPlain(client, 'df -P -k');

    const mounts: StorageMount[] = [];
    for (const line of output.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const [filesystem, totalK, usedK, , , ...mountParts] = parts;
      const mount = mountParts.join(' ');
      const totalBytes = Number(totalK) * 1024;
      const usedBytes = Number(usedK) * 1024;
      if (!mount || !Number.isFinite(totalBytes) || totalBytes === 0) continue;

      /**
       * Sanal dosya sistemleri (tmpfs, devtmpfs, overlay katmanları) listeyi
       * kirletiyor ve kullanıcının umursadığı disk alanını göstermiyor.
       */
      if (/^(tmpfs|devtmpfs|udev|overlay|shm|none)$/i.test(filesystem ?? '')) continue;
      if (/^\/(proc|sys|dev|run)(\/|$)/.test(mount)) continue;

      mounts.push({
        mount,
        filesystem: filesystem ?? '',
        usedBytes,
        totalBytes,
        percent: Math.round((usedBytes / totalBytes) * 100),
      });
    }

    // Kök en üstte, sonra yola göre — kullanıcı genelde `/` ile ilgileniyor.
    mounts.sort((a, b) => (a.mount === '/' ? -1 : b.mount === '/' ? 1 : a.mount.localeCompare(b.mount)));
    return mounts;
  });

  /** Sunucunun kullanıcıya ait olduğunu doğrular ve varsayılan dizini verir. */
  async function hostFor(hostId: string, ownerId: string) {
    const [host] = await db
      .select()
      .from(hosts)
      .where(and(eq(hosts.id, hostId), eq(hosts.ownerId, ownerId)))
      .limit(1);
    if (!host) throw notFound('Sunucu bulunamadı.');
    return host;
  }

  app.get('/sftp/:hostId/list', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);
    const hostId = requireUuid((request.params as { hostId?: string }).hostId, 'Sunucu bulunamadı.');
    const host = await hostFor(hostId, user.id);
    const sudo = wantsSudo(request);

    const requested = (request.query as { path?: string }).path;
    let path = requested ? normalize(remotePathSchema.parse(requested)) : null;

    // ---- sudo modu: kabuk komutlarıyla ----
    if (sudo) {
      const ctx = await getSudoContext(user.id, hostId);
      if (!path) {
        path = host.defaultPath?.trim() ? normalize(host.defaultPath) : await sudoHome(ctx);
      }
      const sudoEntries = await sudoList(ctx, path);

      await emitAudit({
        action: 'sftp.list',
        actor: user,
        request,
        server: { host_id: host.id, name: host.name, hostname: host.hostname, port: host.port },
        file: { path },
        detail: { sudo: true },
      });

      return {
        path,
        parent: path === '/' ? null : posix.dirname(path),
        entries: sudoEntries,
      } satisfies SftpListResponse;
    }

    // ---- normal SFTP ----
    const sftp = await getSftp(user.id, hostId);
    if (!path) {
      path = host.defaultPath?.trim()
        ? normalize(host.defaultPath)
        : await promisify<string>((cb) => sftp.realpath('.', cb)).catch(() => '/');
    }

    let raw: FileEntryWithStats[];
    try {
      raw = await promisify<FileEntryWithStats[]>((cb) => sftp.readdir(path, cb));
    } catch (err) {
      describeSftpError(err);
    }

    /**
     * Sembolik bağların hedef türü ayrıca sorulur: dosya yöneticisinde bir
     * bağa çift tıklandığında dizin mi açılacak yoksa indirme mi başlayacak,
     * bunu bilmek gerekiyor. Hedef kırıksa null bırakılır.
     */
    const entries: SftpEntry[] = await Promise.all(
      raw.map(async (item) => {
        const type = toEntryType(item.attrs);
        let linkTargetType: SftpEntryType | null = null;

        if (type === 'symlink') {
          linkTargetType = await promisify<Stats>((cb) =>
            sftp.stat(posix.join(path, item.filename), cb),
          )
            .then(toEntryType)
            .catch(() => null);
        }

        return {
          name: item.filename,
          path: posix.join(path, item.filename),
          type,
          size: item.attrs.size,
          modifiedAt: item.attrs.mtime,
          mode: toModeString(item.attrs.mode),
          owner: item.attrs.uid ?? null,
          group: item.attrs.gid ?? null,
          linkTargetType,
        };
      }),
    );

    // Dizinler önce, sonra ada göre — Türkçe sıralamayla.
    entries.sort((a, b) => {
      const aDir = a.type === 'directory' || a.linkTargetType === 'directory';
      const bDir = b.type === 'directory' || b.linkTargetType === 'directory';
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.name.localeCompare(b.name, 'tr');
    });

    await emitAudit({
      action: 'sftp.list',
      actor: user,
      request,
      server: { host_id: host.id, name: host.name, hostname: host.hostname, port: host.port },
      file: { path },
    });

    const response: SftpListResponse = {
      path,
      parent: path === '/' ? null : posix.dirname(path),
      entries,
    };
    return response;
  });

  app.get('/sftp/:hostId/download', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const hostId = requireUuid((request.params as { hostId?: string }).hostId, 'Sunucu bulunamadı.');
    const host = await hostFor(hostId, user.id);
    const path = normalize(remotePathSchema.parse((request.query as { path?: string }).path));
    const serverInfo = {
      host_id: host.id,
      name: host.name,
      hostname: host.hostname,
      port: host.port,
    };
    const name = posix.basename(path);
    const asciiName = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    const disposition = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`;

    if (wantsSudo(request)) {
      const ctx = await getSudoContext(user.id, hostId);
      const info = await sudoStat(ctx, path);
      if (info.type === 'directory') {
        throw badRequest('is_directory', 'Dizin indirilemez. Önce içine girin.');
      }

      await emitAudit({
        action: 'sftp.download',
        actor: user,
        request,
        server: serverInfo,
        file: { path, name, size: info.size, direction: 'outbound' },
        detail: { sudo: true },
      });

      reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Length', String(info.size))
        .header('Content-Disposition', disposition);

      // Akış doğrudan yanıta yazılıyor; dosya belleğe alınmıyor.
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(info.size),
        'Content-Disposition': disposition,
      });
      await streamSudoRead(ctx, path, reply.raw);
      reply.raw.end();
      return reply;
    }

    const sftp = await getSftp(user.id, hostId);

    let stats: Stats;
    try {
      stats = await promisify<Stats>((cb) => sftp.stat(path, cb));
    } catch (err) {
      describeSftpError(err);
    }
    if (stats.isDirectory()) {
      throw badRequest('is_directory', 'Dizin indirilemez. Önce içine girin.');
    }

    await emitAudit({
      action: 'sftp.download',
      actor: user,
      request,
      server: { host_id: host.id, name: host.name, hostname: host.hostname, port: host.port },
      file: { path, name: posix.basename(path), size: stats.size, direction: 'outbound' },
    });

    /**
     * Dosya adı iki kez veriliyor: ASCII'ye indirgenmiş `filename` eski
     * istemciler için, `filename*` ise UTF-8 adları (Türkçe karakterler)
     * bozulmadan taşımak için.
     */
    reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Length', String(stats.size))
      .header('Content-Disposition', disposition);

    return reply.send(sftp.createReadStream(path));
  });

  app.post('/sftp/:hostId/upload', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const hostId = requireUuid((request.params as { hostId?: string }).hostId, 'Sunucu bulunamadı.');
    const host = await hostFor(hostId, user.id);
    const path = normalize(remotePathSchema.parse((request.query as { path?: string }).path));
    const declared = Number(request.headers['content-length'] ?? 0);

    if (wantsSudo(request)) {
      const ctx = await getSudoContext(user.id, hostId);
      await streamSudoWrite(ctx, path, request.raw);
      await emitAudit({
        action: 'sftp.upload',
        actor: user,
        request,
        server: { host_id: host.id, name: host.name, hostname: host.hostname, port: host.port },
        file: { path, name: posix.basename(path), size: declared, direction: 'inbound' },
        detail: { sudo: true },
      });
      return reply.status(201).send({ path });
    }

    const sftp = await getSftp(user.id, hostId);
    if (declared > env.SFTP_MAX_UPLOAD_BYTES) {
      throw badRequest(
        'file_too_large',
        `Dosya çok büyük. Sınır: ${Math.floor(env.SFTP_MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
      );
    }

    const started = Date.now();
    try {
      // pipeline: hata durumunda iki akışı da düzgün kapatır, yarım dosya bırakmaz.
      await pipeline(request.raw, sftp.createWriteStream(path));
    } catch (err) {
      await emitAudit({
        action: 'sftp.upload',
        outcome: 'failure',
        actor: user,
        request,
        server: { host_id: host.id, name: host.name, hostname: host.hostname, port: host.port },
        file: { path, name: posix.basename(path), direction: 'inbound' },
        errorMessage: err instanceof Error ? err.message : 'bilinmeyen hata',
      });
      describeSftpError(err);
    }

    await emitAudit({
      action: 'sftp.upload',
      actor: user,
      request,
      durationMs: Date.now() - started,
      server: { host_id: host.id, name: host.name, hostname: host.hostname, port: host.port },
      file: { path, name: posix.basename(path), size: declared, direction: 'inbound' },
    });

    return reply.status(201).send({ path });
  });

  app.post('/sftp/:hostId/mkdir', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const hostId = requireUuid((request.params as { hostId?: string }).hostId, 'Sunucu bulunamadı.');
    const host = await hostFor(hostId, user.id);

    const path = normalize(sftpMkdirSchema.parse(request.body).path);

    if (wantsSudo(request)) {
      await sudoMkdir(await getSudoContext(user.id, hostId), path);
      await emitAudit({
        action: 'sftp.mkdir', actor: user, request,
        server: { host_id: host.id, name: host.name, hostname: host.hostname, port: host.port },
        file: { path }, detail: { sudo: true },
      });
      return reply.status(201).send({ path });
    }

    /**
     * OpenSSH'ın sftp-server'ı "zaten var", "yetki yok" ve "üst dizin yok"
     * durumlarının hepsine SSH_FX_FAILURE (4) döndürüyor. Kullanıcıya
     * "İşlem başarısız" demek yerine önce durumu sorup gerçek nedeni
     * söylüyoruz — fazladan bir tur maliyeti, anlamlı bir mesaja değer.
     */
    const sftp = await getSftp(user.id, hostId);
    const zatenVar = await promisify<Stats>((cb) => sftp.stat(path, cb))
      .then(() => true)
      .catch(() => false);
    if (zatenVar) {
      throw badRequest('already_exists', 'Bu adda bir dosya ya da dizin zaten var.');
    }

    try {
      await promisifyVoid((cb) => sftp.mkdir(path, cb));
    } catch (err) {
      describeSftpError(err);
    }

    await emitAudit({
      action: 'sftp.mkdir',
      actor: user,
      request,
      server: { host_id: host.id, name: host.name, hostname: host.hostname, port: host.port },
      file: { path },
    });

    return reply.status(201).send({ path });
  });

  app.post('/sftp/:hostId/rename', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);
    const hostId = requireUuid((request.params as { hostId?: string }).hostId, 'Sunucu bulunamadı.');
    const host = await hostFor(hostId, user.id);
    const sftp = await getSftp(user.id, hostId);

    const body = sftpRenameSchema.parse(request.body);
    const from = normalize(body.from);
    const to = normalize(body.to);

    if (wantsSudo(request)) {
      await sudoRename(await getSudoContext(user.id, hostId), from, to);
      await emitAudit({
        action: 'sftp.rename', actor: user, request,
        server: { host_id: host.id, name: host.name, hostname: host.hostname, port: host.port },
        file: { path: to }, detail: { from, to, sudo: true },
      });
      return { path: to };
    }

    try {
      await promisifyVoid((cb) => sftp.rename(from, to, cb));
    } catch (err) {
      describeSftpError(err);
    }

    await emitAudit({
      action: 'sftp.rename',
      actor: user,
      request,
      server: { host_id: host.id, name: host.name, hostname: host.hostname, port: host.port },
      file: { path: to },
      detail: { from, to },
    });

    return { path: to };
  });

  app.post('/sftp/:hostId/chmod', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);
    const hostId = requireUuid((request.params as { hostId?: string }).hostId, 'Sunucu bulunamadı.');
    const host = await hostFor(hostId, user.id);
    const sftp = await getSftp(user.id, hostId);

    const body = sftpChmodSchema.parse(request.body);
    const path = normalize(body.path);
    const mode = parseInt(body.mode, 8);

    if (wantsSudo(request)) {
      await sudoChmod(await getSudoContext(user.id, hostId), path, body.mode);
      await emitAudit({
        action: 'sftp.chmod', actor: user, request,
        server: { host_id: host.id, name: host.name, hostname: host.hostname, port: host.port },
        file: { path }, detail: { mode: body.mode, sudo: true },
      });
      return { path, mode: body.mode };
    }

    try {
      await promisifyVoid((cb) => sftp.chmod(path, mode, cb));
    } catch (err) {
      describeSftpError(err);
    }

    await emitAudit({
      action: 'sftp.chmod',
      actor: user,
      request,
      server: { host_id: host.id, name: host.name, hostname: host.hostname, port: host.port },
      file: { path },
      detail: { mode: body.mode },
    });

    return { path, mode: body.mode };
  });

  app.post('/sftp/:hostId/delete', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const hostId = requireUuid((request.params as { hostId?: string }).hostId, 'Sunucu bulunamadı.');
    const host = await hostFor(hostId, user.id);
    const sftp = await getSftp(user.id, hostId);

    const body = sftpDeleteSchema.parse(request.body);
    const path = normalize(body.path);

    if (path === '/') {
      throw badRequest('refused', 'Kök dizin silinemez.');
    }

    if (wantsSudo(request)) {
      await sudoDelete(await getSudoContext(user.id, hostId), path, body.directory);
      await emitAudit({
        action: 'sftp.delete',
        actor: user,
        request,
        server: { host_id: host.id, name: host.name, hostname: host.hostname, port: host.port },
        file: { path, name: posix.basename(path) },
        detail: { directory: body.directory, sudo: true },
      });
      return reply.status(204).send();
    }

    /**
     * Dolu dizin silme de SSH_FX_FAILURE ile dönüyor; kaç öğe olduğunu
     * söylemek kullanıcıya "neden olmadı"yı doğrudan anlatıyor.
     */
    if (body.directory) {
      const icerik = await promisify<FileEntryWithStats[]>((cb) => sftp.readdir(path, cb)).catch(
        () => null,
      );
      if (icerik && icerik.length > 0) {
        throw badRequest(
          'directory_not_empty',
          `Dizin boş değil (${icerik.length} öğe). Önce içindekileri silin.`,
        );
      }
    }

    try {
      // Dizin ve dosya için SFTP'de ayrı çağrılar var; istemci hangisi
      // olduğunu listeden bildiği için tahmin etmiyoruz.
      await promisifyVoid((cb) => (body.directory ? sftp.rmdir(path, cb) : sftp.unlink(path, cb)));
    } catch (err) {
      describeSftpError(err);
    }

    await emitAudit({
      action: 'sftp.delete',
      actor: user,
      request,
      server: { host_id: host.id, name: host.name, hostname: host.hostname, port: host.port },
      file: { path, name: posix.basename(path) },
      detail: { directory: body.directory },
    });

    return reply.status(204).send();
  });
}
