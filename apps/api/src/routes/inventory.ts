import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  createFolderSchema,
  hostInputSchema,
  moveNodeSchema,
  quickConnectSchema,
  updateFolderSchema,
  type Folder,
  type Host,
  type Inventory,
} from '@sshby/shared';
import { db } from '../db/client.js';
import { credentials, folders, hosts, type FolderRow, type HostRow } from '../db/schema.js';
import { emitAudit } from '../lib/audit.js';
import { badRequest, notFound, requireUuid } from '../lib/errors.js';
import { sealSecret, type CredentialSecret } from '../lib/credentials.js';
import { fingerprintPrivateKey } from '../lib/crypto/ssh-key.js';
import { requireUser } from '../plugins/auth.js';

function toFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    color: row.color,
    sortIndex: row.sortIndex,
  };
}

/**
 * Bağlantıda kullanılacak kullanıcı adı: sunucuda açıkça yazılmışsa o,
 * yazılmamışsa kimlik bilgisindeki. Tek doğruluk kaynağı burası — terminal
 * ve SFTP katmanları da bu sırayı uygular.
 */
export function resolveUsername(
  hostUsername: string | null,
  credentialUsername: string | null | undefined,
): string | null {
  return hostUsername?.trim() || credentialUsername?.trim() || null;
}

function toHost(row: HostRow, credentialUsername: string | null): Host {
  return {
    id: row.id,
    folderId: row.folderId,
    name: row.name,
    hostname: row.hostname,
    port: row.port,
    username: row.username,
    effectiveUsername: resolveUsername(row.username, credentialUsername),
    credentialId: row.credentialId,
    defaultPath: row.defaultPath,
    tags: row.tags,
    jumpHostId: row.jumpHostId,
    sortIndex: row.sortIndex,
  };
}

/** Yeni öğe her zaman kardeşlerinin sonuna eklenir. */
async function nextSortIndex(
  table: typeof folders | typeof hosts,
  ownerId: string,
  parentColumn: typeof folders.parentId | typeof hosts.folderId,
  parentId: string | null,
): Promise<number> {
  const rows = await db
    .select({ max: sql<number | null>`max(${table.sortIndex})` })
    .from(table)
    .where(
      and(
        eq(table.ownerId, ownerId),
        parentId === null ? sql`${parentColumn} is null` : eq(parentColumn, parentId),
        /**
         * Geçici (hızlı bağlantı) kayıtlar sıralamaya katılmaz. Ağaçta
         * görünmedikleri hâlde sayacı ilerletiyorlar ve bir hızlı bağlantı
         * sonrası eklenen gerçek sunucular kaymış indislerle başlıyordu.
         */
        table === hosts ? eq(hosts.ephemeral, false) : undefined,
      ),
    );
  return (rows[0]?.max ?? -1) + 1;
}

/** Kullanıcının klasörünü doğrular; yoksa 404. */
async function assertFolderOwned(folderId: string, ownerId: string): Promise<void> {
  const [row] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.ownerId, ownerId)))
    .limit(1);
  if (!row) throw notFound('Klasör bulunamadı.');
}

/**
 * Kimlik bilgisinin isteği yapan kullanıcıya ait olduğunu doğrular.
 *
 * Bu kontrol olmadan bir kullanıcı, başka birinin credential kimliğini kendi
 * sunucusuna atayabiliyordu. Gizli veri yine sızmıyordu (çözme katmanı da
 * sahibe göre filtreliyor, üstelik şifreleme sahiple bağlı) ama hata ancak
 * bağlanma anında ve anlamsız bir "internal_error" olarak ortaya çıkıyordu.
 * Yanlış veriyi en baştan reddetmek hem daha anlaşılır hem de tek savunma
 * hattına bel bağlamamak açısından doğru.
 */
async function assertCredentialOwned(credentialId: string, ownerId: string): Promise<void> {
  const [row] = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.id, credentialId), eq(credentials.ownerId, ownerId)))
    .limit(1);
  if (!row) throw notFound('Kimlik bilgisi bulunamadı.');
}

/** Kimlik bilgisinin taşıdığı varsayılan kullanıcı adı (yoksa null). */
async function credentialUsername(
  credentialId: string | null,
  ownerId: string,
): Promise<string | null> {
  if (!credentialId) return null;
  const [row] = await db
    .select({ username: credentials.username })
    .from(credentials)
    .where(and(eq(credentials.id, credentialId), eq(credentials.ownerId, ownerId)))
    .limit(1);
  return row?.username ?? null;
}

/**
 * Kaydetmeden önce kullanıcı adının çözülebildiğini doğrular. Hatayı bağlanma
 * anına bırakmak yerine formda göstermek, kullanıcının düzeltebileceği yerde
 * uyarmak demek.
 */
function assertUsernameResolvable(
  hostUsername: string | null,
  credUsername: string | null,
): void {
  if (resolveUsername(hostUsername, credUsername)) return;
  throw badRequest(
    'username_required',
    'SSH kullanıcı adı belirlenemedi. Sunucuda bir kullanıcı adı yazın ya da ' +
      'kasadaki kimlik bilgisine varsayılan kullanıcı adı ekleyin.',
  );
}

/**
 * Kullanılmayan geçici kayıtları siler.
 *
 * Süre dolduğunda temizlemek şart: hızlı bağlantılar birikirse veritabanında
 * şifreli gizli veriler gereğinden uzun yaşar. Silme sırası önemli — önce
 * sunucu, sonra kimlik bilgisi (yabancı anahtar bağı).
 */
const EPHEMERAL_TTL_MS = 24 * 60 * 60 * 1000;

async function sweepEphemeral(ownerId: string): Promise<void> {
  const cutoff = new Date(Date.now() - EPHEMERAL_TTL_MS);

  await db
    .delete(hosts)
    .where(and(eq(hosts.ownerId, ownerId), eq(hosts.ephemeral, true), lt(hosts.updatedAt, cutoff)));

  await db
    .delete(credentials)
    .where(
      and(
        eq(credentials.ownerId, ownerId),
        eq(credentials.ephemeral, true),
        lt(credentials.updatedAt, cutoff),
      ),
    );
}

export async function registerInventoryRoutes(app: FastifyInstance): Promise<void> {
  // Ağacın tamamı tek istekte: envanter birkaç yüz satır, sayfalama gereksiz.
  app.get('/inventory', { preHandler: app.requireAuth }, async (request): Promise<Inventory> => {
    const user = requireUser(request);
    const [folderRows, hostRows, credentialRows] = await Promise.all([
      db
        .select()
        .from(folders)
        .where(eq(folders.ownerId, user.id))
        .orderBy(asc(folders.sortIndex), asc(folders.name)),
      db
        .select()
        .from(hosts)
        // Geçici (hızlı bağlantı) kayıtları ağaçta göstermiyoruz.
        .where(and(eq(hosts.ownerId, user.id), eq(hosts.ephemeral, false)))
        .orderBy(asc(hosts.sortIndex), asc(hosts.name)),
      // Kasa küçük; join yerine bellekte eşleme kurmak hem basit hem hızlı.
      db
        .select({ id: credentials.id, username: credentials.username })
        .from(credentials)
        .where(eq(credentials.ownerId, user.id)),
    ]);

    const usernameByCredential = new Map(credentialRows.map((c) => [c.id, c.username]));

    return {
      folders: folderRows.map(toFolder),
      hosts: hostRows.map((row) =>
        toHost(row, row.credentialId ? usernameByCredential.get(row.credentialId) ?? null : null),
      ),
    };
  });

  // --------------------------------------------------------------- klasörler

  app.post('/folders', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const body = createFolderSchema.parse(request.body);
    const parentId = body.parentId ?? null;

    if (parentId) await assertFolderOwned(parentId, user.id);

    const [created] = await db
      .insert(folders)
      .values({
        ownerId: user.id,
        parentId,
        name: body.name.trim(),
        color: body.color ?? null,
        sortIndex: await nextSortIndex(folders, user.id, folders.parentId, parentId),
      })
      .returning();
    if (!created) throw new Error('Klasör oluşturulamadı');

    await emitAudit({
      action: 'folder.create',
      actor: user,
      request,
      detail: { folderId: created.id, name: created.name, parentId },
    });

    return reply.status(201).send(toFolder(created));
  });

  app.patch('/folders/:id', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);
    const id = requireUuid((request.params as { id?: string }).id);
    const body = updateFolderSchema.parse(request.body);

    const [updated] = await db
      .update(folders)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(folders.id, id), eq(folders.ownerId, user.id)))
      .returning();
    if (!updated) throw notFound('Klasör bulunamadı.');

    await emitAudit({
      action: 'folder.update',
      actor: user,
      request,
      detail: { folderId: updated.id, name: updated.name },
    });

    return toFolder(updated);
  });

  app.delete('/folders/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const id = requireUuid((request.params as { id?: string }).id);

    /**
     * Alt klasörler şemadaki `on delete cascade` ile gider. Sunucular ise
     * `on delete set null` ile köke taşınır — klasör silmek yanlışlıkla sunucu
     * kaydını yok etmemeli, bunlar kullanıcının asıl verisi.
     */
    const [deleted] = await db
      .delete(folders)
      .where(and(eq(folders.id, id), eq(folders.ownerId, user.id)))
      .returning();
    if (!deleted) throw notFound('Klasör bulunamadı.');

    await emitAudit({
      action: 'folder.delete',
      actor: user,
      request,
      detail: { folderId: deleted.id, name: deleted.name },
    });

    return reply.status(204).send();
  });

  // ---------------------------------------------------------------- sunucular

  app.post('/hosts', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const body = hostInputSchema.parse(request.body);
    const folderId = body.folderId ?? null;

    if (folderId) await assertFolderOwned(folderId, user.id);
    if (body.credentialId) await assertCredentialOwned(body.credentialId, user.id);

    const credUsername = await credentialUsername(body.credentialId ?? null, user.id);
    const hostUsername = body.username?.trim() || null;
    assertUsernameResolvable(hostUsername, credUsername);

    const [created] = await db
      .insert(hosts)
      .values({
        ownerId: user.id,
        folderId,
        name: body.name.trim(),
        hostname: body.hostname.trim(),
        port: body.port,
        username: hostUsername,
        credentialId: body.credentialId ?? null,
        defaultPath: body.defaultPath ?? null,
        tags: body.tags,
        jumpHostId: body.jumpHostId ?? null,
        sortIndex: await nextSortIndex(hosts, user.id, hosts.folderId, folderId),
      })
      .returning();
    if (!created) throw new Error('Sunucu oluşturulamadı');

    await emitAudit({
      action: 'host.create',
      actor: user,
      request,
      server: {
        host_id: created.id,
        name: created.name,
        hostname: created.hostname,
        port: created.port,
        username: resolveUsername(created.username, credUsername) ?? undefined,
      },
    });

    return reply.status(201).send(toHost(created, credUsername));
  });

  app.patch('/hosts/:id', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);
    const id = requireUuid((request.params as { id?: string }).id);
    const body = hostInputSchema.partial().parse(request.body);

    if (body.folderId) await assertFolderOwned(body.folderId, user.id);
    if (body.credentialId) await assertCredentialOwned(body.credentialId, user.id);
    if (body.jumpHostId === id) {
      throw badRequest('self_jump_host', 'Bir sunucu kendi atlama sunucusu olamaz.');
    }

    /**
     * Kısmi güncellemede kullanıcı adı ve kimlik bilgisi ayrı ayrı
     * değişebiliyor; ikisinin birleşimi hâlâ geçerli mi diye bakmak için
     * mevcut satırı okumak gerekiyor.
     */
    const [existing] = await db
      .select()
      .from(hosts)
      .where(and(eq(hosts.id, id), eq(hosts.ownerId, user.id)))
      .limit(1);
    if (!existing) throw notFound('Sunucu bulunamadı.');

    const nextUsername =
      body.username !== undefined ? body.username?.trim() || null : existing.username;
    const nextCredentialId =
      body.credentialId !== undefined ? body.credentialId ?? null : existing.credentialId;

    const credUsername = await credentialUsername(nextCredentialId, user.id);
    assertUsernameResolvable(nextUsername, credUsername);

    const [updated] = await db
      .update(hosts)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.hostname !== undefined ? { hostname: body.hostname.trim() } : {}),
        ...(body.port !== undefined ? { port: body.port } : {}),
        ...(body.username !== undefined ? { username: nextUsername } : {}),
        ...(body.credentialId !== undefined ? { credentialId: nextCredentialId } : {}),
        ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
        ...(body.defaultPath !== undefined ? { defaultPath: body.defaultPath } : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
        ...(body.jumpHostId !== undefined ? { jumpHostId: body.jumpHostId } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(hosts.id, id), eq(hosts.ownerId, user.id)))
      .returning();
    if (!updated) throw notFound('Sunucu bulunamadı.');

    await emitAudit({
      action: 'host.update',
      actor: user,
      request,
      server: {
        host_id: updated.id,
        name: updated.name,
        hostname: updated.hostname,
        port: updated.port,
        username: resolveUsername(updated.username, credUsername) ?? undefined,
      },
    });

    return toHost(updated, credUsername);
  });

  /**
   * Sunucuyu kopyalar.
   *
   * Benzer yapılandırmalı sunucuları tek tek girmek yerine birini kopyalayıp
   * adresini değiştirmek yaygın bir akış. Kimlik bilgisi de devralınır —
   * kopyalanan bir sunucu genelde aynı kasadaki kayıtla erişilen kardeşidir.
   */
  app.post('/hosts/:id/clone', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const id = requireUuid((request.params as { id?: string }).id, 'Sunucu bulunamadı.');

    const [source] = await db
      .select()
      .from(hosts)
      .where(and(eq(hosts.id, id), eq(hosts.ownerId, user.id)))
      .limit(1);
    if (!source) throw notFound('Sunucu bulunamadı.');

    /**
     * Ad çakışmasını kullanıcıya hata olarak döndürmek yerine sayıyı
     * artırıyoruz: "kopyala" tek tıklık bir eylem, araya diyalog sokmak
     * akışı bölerdi.
     */
    const siblings = await db
      .select({ name: hosts.name })
      .from(hosts)
      .where(eq(hosts.ownerId, user.id));
    const taken = new Set(siblings.map((s) => s.name));

    let name = `${source.name} (kopya)`;
    let counter = 2;
    while (taken.has(name)) {
      name = `${source.name} (kopya ${counter})`;
      counter += 1;
    }

    const [created] = await db
      .insert(hosts)
      .values({
        ownerId: user.id,
        folderId: source.folderId,
        name,
        hostname: source.hostname,
        port: source.port,
        username: source.username,
        credentialId: source.credentialId,
        defaultPath: source.defaultPath,
        tags: source.tags,
        jumpHostId: source.jumpHostId,
        sortIndex: await nextSortIndex(hosts, user.id, hosts.folderId, source.folderId),
      })
      .returning();
    if (!created) throw new Error('Sunucu kopyalanamadı');

    const credUsername = await credentialUsername(created.credentialId, user.id);

    await emitAudit({
      action: 'host.create',
      actor: user,
      request,
      server: {
        host_id: created.id,
        name: created.name,
        hostname: created.hostname,
        port: created.port,
        username: resolveUsername(created.username, credUsername) ?? undefined,
      },
      detail: { clonedFrom: source.id },
    });

    return reply.status(201).send(toHost(created, credUsername));
  });

  app.delete('/hosts/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const id = requireUuid((request.params as { id?: string }).id);

    const [deleted] = await db
      .delete(hosts)
      .where(and(eq(hosts.id, id), eq(hosts.ownerId, user.id)))
      .returning();
    if (!deleted) throw notFound('Sunucu bulunamadı.');

    await emitAudit({
      action: 'host.delete',
      actor: user,
      request,
      server: {
        host_id: deleted.id,
        name: deleted.name,
        hostname: deleted.hostname,
        port: deleted.port,
        username: deleted.username ?? undefined,
      },
    });

    return reply.status(204).send();
  });

  /**
   * Hızlı bağlantı — envantere kalıcı kayıt eklemeden bağlanma.
   *
   * Bağlantı bilgilerini imzalı bilete gömmek yerine `ephemeral` işaretli
   * geçici satır yazıyoruz. Böylece terminal, SFTP, metrik, geçmiş, TOFU ve
   * denetim katmanlarının hiçbiri değişmiyor — hepsi sunucu kimliğiyle
   * konuşuyor. Bilete gömme yaklaşımı beş katmanı birden değiştirmeyi
   * gerektirirdi.
   */
  app.post('/hosts/quick', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const body = quickConnectSchema.parse(request.body);

    // Eski geçici kayıtları temizle: her hızlı bağlantı bir süpürme fırsatı.
    await sweepEphemeral(user.id);

    let credentialId: string | null = null;

    if (body.auth === 'credential') {
      await assertCredentialOwned(body.credentialId, user.id);
      credentialId = body.credentialId;
    } else {
      /**
       * Elle girilen gizli veri geçici bir kasa kaydına yazılıyor — kasadaki
       * kalıcı kayıtlarla aynı zarf şifrelemesiyle. Bellekte tutup bilete
       * gömmek şifrelenmemiş bir kopya üretirdi; şifreli ve süresi dolunca
       * silinen bir satır daha güvenli.
       */
      const secret: CredentialSecret =
        body.auth === 'password'
          ? { type: 'password', password: body.password }
          : { type: 'key', privateKey: body.privateKey, passphrase: body.passphrase };

      const publicFingerprint =
        secret.type === 'key'
          ? fingerprintPrivateKey(secret.privateKey, secret.passphrase)
          : null;

      const [credential] = await db
        .insert(credentials)
        .values({
          ownerId: user.id,
          // Ada zaman damgası: kasa adları benzersiz ve bu kayıt gizli.
          name: `hızlı-${body.hostname}-${Date.now()}`,
          type: secret.type,
          username: body.username,
          publicFingerprint,
          ephemeral: true,
          ...sealSecret(secret, user.id),
        })
        .returning();
      if (!credential) throw new Error('Geçici kimlik bilgisi oluşturulamadı');
      credentialId = credential.id;
    }

    const [created] = await db
      .insert(hosts)
      .values({
        ownerId: user.id,
        folderId: null,
        name: `${body.username}@${body.hostname}`,
        hostname: body.hostname.trim(),
        port: body.port,
        username: body.username.trim(),
        credentialId,
        ephemeral: true,
        tags: [],
        sortIndex: 0,
      })
      .returning();
    if (!created) throw new Error('Hızlı bağlantı oluşturulamadı');

    await emitAudit({
      action: 'host.create',
      actor: user,
      request,
      server: {
        host_id: created.id,
        name: created.name,
        hostname: created.hostname,
        port: created.port,
        username: created.username ?? undefined,
      },
      detail: { quickConnect: true, auth: body.auth },
    });

    return reply.status(201).send(toHost(created, null));
  });

  // ------------------------------------------------------------ sürükle-bırak

  app.post('/inventory/move', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);
    const body = moveNodeSchema.parse(request.body);
    const targetFolderId = body.targetFolderId;

    if (targetFolderId) await assertFolderOwned(targetFolderId, user.id);

    const allFolders = await db
      .select({ id: folders.id, parentId: folders.parentId })
      .from(folders)
      .where(eq(folders.ownerId, user.id));

    if (body.kind === 'folder') {
      if (targetFolderId === body.id) {
        throw badRequest('cyclic_move', 'Bir klasör kendi içine taşınamaz.');
      }
      /**
       * Klasörü kendi alt ağacına taşımak, ağacı veritabanında erişilemez bir
       * döngüye sokar. Envanter küçük olduğu için zinciri bellekte yürüyoruz.
       */
      let cursor = targetFolderId;
      const parentOf = new Map(allFolders.map((f) => [f.id, f.parentId]));
      while (cursor) {
        if (cursor === body.id) {
          throw badRequest('cyclic_move', 'Bir klasör kendi alt klasörüne taşınamaz.');
        }
        cursor = parentOf.get(cursor) ?? null;
      }
    }

    /**
     * Klasör ve sunucu ayrı sıralama uzaylarında yaşıyor (arayüzde klasörler
     * her zaman üstte). İki tablo farklı Drizzle tipleri olduğu için dalları
     * ayrı yazıyoruz; birleştirilmiş bir `table` değişkeni tip güvenliğini
     * kaybettiriyor.
     */
    let insertAt = 0;

    if (body.kind === 'folder') {
      const siblings = await db
        .select({ id: folders.id })
        .from(folders)
        .where(
          and(
            eq(folders.ownerId, user.id),
            targetFolderId === null
              ? sql`${folders.parentId} is null`
              : eq(folders.parentId, targetFolderId),
          ),
        )
        .orderBy(asc(folders.sortIndex), asc(folders.name));

      const ordered = siblings.map((s) => s.id).filter((id) => id !== body.id);
      insertAt = Math.min(body.position, ordered.length);
      ordered.splice(insertAt, 0, body.id);

      await db.transaction(async (tx) => {
        const moved = await tx
          .update(folders)
          .set({ parentId: targetFolderId, updatedAt: new Date() })
          .where(and(eq(folders.id, body.id), eq(folders.ownerId, user.id)))
          .returning({ id: folders.id });
        if (moved.length === 0) throw notFound('Taşınacak klasör bulunamadı.');

        for (const [index, id] of ordered.entries()) {
          await tx.update(folders).set({ sortIndex: index }).where(eq(folders.id, id));
        }
      });
    } else {
      const siblings = await db
        .select({ id: hosts.id })
        .from(hosts)
        .where(
          and(
            eq(hosts.ownerId, user.id),
            targetFolderId === null
              ? sql`${hosts.folderId} is null`
              : eq(hosts.folderId, targetFolderId),
          ),
        )
        .orderBy(asc(hosts.sortIndex), asc(hosts.name));

      const ordered = siblings.map((s) => s.id).filter((id) => id !== body.id);
      insertAt = Math.min(body.position, ordered.length);
      ordered.splice(insertAt, 0, body.id);

      await db.transaction(async (tx) => {
        const moved = await tx
          .update(hosts)
          .set({ folderId: targetFolderId, updatedAt: new Date() })
          .where(and(eq(hosts.id, body.id), eq(hosts.ownerId, user.id)))
          .returning({ id: hosts.id });
        if (moved.length === 0) throw notFound('Taşınacak sunucu bulunamadı.');

        for (const [index, id] of ordered.entries()) {
          await tx.update(hosts).set({ sortIndex: index }).where(eq(hosts.id, id));
        }
      });
    }

    await emitAudit({
      action: body.kind === 'folder' ? 'folder.update' : 'host.move',
      actor: user,
      request,
      detail: { kind: body.kind, id: body.id, targetFolderId, position: insertAt },
    });

    return { ok: true };
  });
}
