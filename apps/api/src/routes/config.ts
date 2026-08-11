import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  CONFIG_PACKAGE_FORMAT,
  CONFIG_PACKAGE_VERSION,
  configExportSchema,
  configImportSchema,
  type ConfigImportResult,
  type ConfigPackage,
  type ConfigVaultPayload,
  type ExportedCredential,
  type ExportedFolder,
  type ExportedHost,
  type ImportConflictStrategy,
  type ImportCounts,
} from '@sshby/shared';
import { db } from '../db/client.js';
import { credentials, folders, hosts, type CredentialRow } from '../db/schema.js';
import { emitAudit } from '../lib/audit.js';
import { openCredentialRow, sealSecret } from '../lib/credentials.js';
import { openConfigVault, sealConfigVault } from '../lib/crypto/config-package.js';
import { badRequest } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';

/**
 * Yapılandırma dışa/içe aktarma.
 *
 * Kapsam: klasör ağacı, sunucu envanteri ve kasa kayıtları. TOFU host anahtarları
 * bilinçli olarak dışarıda — güvenilen anahtarı başka bir kuruluma taşımak, o
 * kurulumda ilk bağlantı doğrulamasını kullanıcı görmeden atlatmak olurdu.
 *
 * Geçici (`ephemeral`) kayıtlar da dışarıda: bunlar hızlı bağlantının 24 saatlik
 * artıkları, kullanıcının yapılandırması değil.
 */

function emptyCounts(): ImportCounts {
  return { created: 0, renamed: 0, skipped: 0, overwritten: 0 };
}

/** "Ad" alınmışsa "Ad (2)", "Ad (3)" … ilk boş olanı döndürür. */
function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let counter = 2;
  while (taken.has(`${base} (${counter})`)) counter += 1;
  return `${base} (${counter})`;
}

/**
 * Klasörleri üstten alta sıralar.
 *
 * İçe aktarımda bir klasörün üst klasörü kendisinden önce oluşmuş olmalı;
 * yoksa eski → yeni kimlik eşlemesinde karşılığı bulunamaz. Paketteki sıra
 * garanti değil (dışa aktarım `sortIndex`e göre sıralıyor), bu yüzden burada
 * yeniden düzenleniyor.
 */
function topologicalFolders(list: ExportedFolder[]): ExportedFolder[] {
  const byParent = new Map<string | null, ExportedFolder[]>();
  const known = new Set(list.map((f) => f.id));

  for (const folder of list) {
    // Üst klasörü pakete girmemiş bir klasör kök seviyeye alınır; kayıt
    // düşürmektense ağacın bir dalını yukarı taşımak daha az zararlı.
    const parent = folder.parentId && known.has(folder.parentId) ? folder.parentId : null;
    const bucket = byParent.get(parent);
    if (bucket) bucket.push(folder);
    else byParent.set(parent, [folder]);
  }

  const ordered: ExportedFolder[] = [];
  const walk = (parentId: string | null): void => {
    for (const folder of byParent.get(parentId) ?? []) {
      ordered.push(folder);
      walk(folder.id);
    }
  };
  walk(null);
  return ordered;
}

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Dışa aktarma POST — parola gövdede taşınmak zorunda. GET olsaydı parola
   * sorgu dizesine düşer ve nginx erişim loglarına, tarayıcı geçmişine yazılırdı.
   */
  app.post('/config/export', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);
    const body = configExportSchema.parse(request.body);

    const [folderRows, hostRows, credentialRows] = await Promise.all([
      db
        .select()
        .from(folders)
        .where(eq(folders.ownerId, user.id))
        .orderBy(asc(folders.sortIndex), asc(folders.name)),
      db
        .select()
        .from(hosts)
        .where(and(eq(hosts.ownerId, user.id), eq(hosts.ephemeral, false)))
        .orderBy(asc(hosts.sortIndex), asc(hosts.name)),
      db
        .select()
        .from(credentials)
        .where(and(eq(credentials.ownerId, user.id), eq(credentials.ephemeral, false)))
        .orderBy(asc(credentials.name)),
    ]);

    const exportedFolders: ExportedFolder[] = folderRows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      color: row.color,
      sortIndex: row.sortIndex,
    }));

    const exportedCredentials: ExportedCredential[] = credentialRows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      username: row.username,
      publicFingerprint: row.publicFingerprint,
    }));

    /**
     * Geçici kimlik bilgilerine bağlı sunucular dışarıda kaldığı için burada
     * ayrıca eleme gerekmiyor; yine de pakete girmeyen bir kimliğe referans
     * kalmasın diye bağ kontrol ediliyor.
     */
    const exportedCredentialIds = new Set(exportedCredentials.map((c) => c.id));
    const exportedHostIds = new Set(hostRows.map((h) => h.id));

    const exportedHosts: ExportedHost[] = hostRows.map((row) => ({
      id: row.id,
      folderId: row.folderId,
      name: row.name,
      hostname: row.hostname,
      port: row.port,
      username: row.username,
      credentialId:
        row.credentialId && exportedCredentialIds.has(row.credentialId) ? row.credentialId : null,
      defaultPath: row.defaultPath,
      tags: row.tags,
      jumpHostId: row.jumpHostId && exportedHostIds.has(row.jumpHostId) ? row.jumpHostId : null,
      sortIndex: row.sortIndex,
    }));

    const pkg: ConfigPackage = {
      format: CONFIG_PACKAGE_FORMAT,
      version: CONFIG_PACKAGE_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: user.email,
      secrets: body.secrets,
      folders: exportedFolders,
      credentials: exportedCredentials,
      hosts: exportedHosts,
    };

    if (body.secrets === 'encrypted') {
      const payload: ConfigVaultPayload = {};
      for (const row of credentialRows) {
        payload[row.id] = openCredentialRow(row, user.id);
      }
      pkg.vault = await sealConfigVault(payload, body.password);
    }

    await emitAudit({
      action: 'config.export',
      actor: user,
      request,
      detail: {
        secrets: body.secrets,
        folders: exportedFolders.length,
        hosts: exportedHosts.length,
        credentials: exportedCredentials.length,
      },
    });

    return pkg;
  });

  app.post('/config/import', { preHandler: app.requireAuth }, async (request) => {
    const user = requireUser(request);
    const body = configImportSchema.parse(request.body);
    const pkg = body.package;
    const strategy: ImportConflictStrategy = body.conflictStrategy;

    let vault: ConfigVaultPayload = {};
    if (pkg.secrets === 'encrypted') {
      if (!body.password) {
        throw badRequest(
          'package_password_required',
          'Bu paket şifreli gizli veri içeriyor; açmak için paket parolası gerekli.',
        );
      }
      // Zod `secrets: 'encrypted'` iken kasa bölümünün varlığını garanti ediyor.
      vault = await openConfigVault(pkg.vault!, body.password);
    }

    const result: ConfigImportResult = {
      folders: emptyCounts(),
      credentials: emptyCounts(),
      hosts: emptyCounts(),
      warnings: [],
    };

    /**
     * Paket kimliği → hedef kurulumdaki kimlik. Atlanan ve üzerine yazılan
     * kayıtlarda mevcut satırın kimliği yazılır: paketteki bir sunucu, atlanmış
     * bir klasörün altına gitmek istiyorsa hedefteki eşdeğer klasöre gitmeli.
     */
    const folderIdMap = new Map<string, string>();
    const credentialIdMap = new Map<string, string>();
    const hostIdMap = new Map<string, string>();

    await db.transaction(async (tx) => {
      // ------------------------------------------------------------ klasörler

      const existingFolders = await tx
        .select({ id: folders.id, parentId: folders.parentId, name: folders.name })
        .from(folders)
        .where(eq(folders.ownerId, user.id));

      /**
       * Klasör adları yalnızca aynı üst klasör altında çakışır — iki ayrı dalda
       * "sunucular" adında iki klasör olması tamamen meşru.
       */
      const folderKey = (parentId: string | null, name: string) => `${parentId ?? 'root'} ${name}`;
      const folderByKey = new Map(
        existingFolders.map((f) => [folderKey(f.parentId, f.name), f.id]),
      );
      const takenFolderNames = new Map<string, Set<string>>();
      for (const f of existingFolders) {
        const bucket = takenFolderNames.get(f.parentId ?? 'root');
        if (bucket) bucket.add(f.name);
        else takenFolderNames.set(f.parentId ?? 'root', new Set([f.name]));
      }

      /**
       * Sıra numaraları mevcut kardeşlerin arkasına eklenir; paketten gelen
       * kayıtların içindeki göreli sıra korunur ama hedefteki mevcut ağacın
       * sıralamasını bozmaz.
       */
      const folderCursor = new Map<string, number>();
      const nextFolderIndex = async (parentId: string | null): Promise<number> => {
        const key = parentId ?? 'root';
        let cursor = folderCursor.get(key);
        if (cursor === undefined) {
          const [row] = await tx
            .select({ max: sql<number | null>`max(${folders.sortIndex})` })
            .from(folders)
            .where(
              and(
                eq(folders.ownerId, user.id),
                parentId === null
                  ? sql`${folders.parentId} is null`
                  : eq(folders.parentId, parentId),
              ),
            );
          cursor = (row?.max ?? -1) + 1;
        }
        folderCursor.set(key, cursor + 1);
        return cursor;
      };

      for (const folder of topologicalFolders(pkg.folders)) {
        const parentId = folder.parentId ? folderIdMap.get(folder.parentId) ?? null : null;
        const bucketKey = parentId ?? 'root';
        const existingId = folderByKey.get(folderKey(parentId, folder.name));

        if (existingId && strategy === 'skip') {
          folderIdMap.set(folder.id, existingId);
          result.folders.skipped += 1;
          continue;
        }

        if (existingId && strategy === 'overwrite') {
          await tx
            .update(folders)
            .set({ color: folder.color, updatedAt: new Date() })
            .where(eq(folders.id, existingId));
          folderIdMap.set(folder.id, existingId);
          result.folders.overwritten += 1;
          continue;
        }

        const taken = takenFolderNames.get(bucketKey) ?? new Set<string>();
        const name = existingId ? uniqueName(folder.name, taken) : folder.name;
        taken.add(name);
        takenFolderNames.set(bucketKey, taken);

        const [created] = await tx
          .insert(folders)
          .values({
            ownerId: user.id,
            parentId,
            name,
            color: folder.color,
            sortIndex: await nextFolderIndex(parentId),
          })
          .returning({ id: folders.id });
        if (!created) throw new Error('Klasör içe aktarılamadı');

        folderIdMap.set(folder.id, created.id);
        folderByKey.set(folderKey(parentId, name), created.id);
        if (existingId) result.folders.renamed += 1;
        else result.folders.created += 1;
      }

      // ------------------------------------------------------ kimlik bilgileri

      const existingCredentials = await tx
        .select()
        .from(credentials)
        .where(and(eq(credentials.ownerId, user.id), eq(credentials.ephemeral, false)));
      const credentialByName = new Map(existingCredentials.map((c) => [c.name, c]));
      const takenCredentialNames = new Set(existingCredentials.map((c) => c.name));

      for (const credential of pkg.credentials) {
        const secret = vault[credential.id];
        const existing: CredentialRow | undefined = credentialByName.get(credential.name);

        /**
         * Gizli verisi olmayan kayıt oluşturulamaz — kasa satırı şifreli veri
         * olmadan anlamsız. Bunun yerine hedefte aynı adlı bir kayıt varsa
         * sunucular ona bağlanır; bu, gizli veri hariç paketi iki kurulum
         * arasında yapılandırma taşımak için gerçekten kullanılabilir kılıyor.
         */
        if (!secret) {
          if (existing) {
            credentialIdMap.set(credential.id, existing.id);
            result.credentials.skipped += 1;
          } else {
            result.credentials.skipped += 1;
            result.warnings.push(
              `"${credential.name}" kimlik bilgisi gizli veri içermediği için oluşturulamadı; ` +
                'bu kimliği kullanan sunucular kimlik bilgisiz içe aktarıldı.',
            );
          }
          continue;
        }

        if (existing && strategy === 'skip') {
          credentialIdMap.set(credential.id, existing.id);
          result.credentials.skipped += 1;
          continue;
        }

        if (existing && strategy === 'overwrite') {
          await tx
            .update(credentials)
            .set({
              type: secret.type,
              username: credential.username,
              publicFingerprint: credential.publicFingerprint,
              ...sealSecret(secret, user.id),
              updatedAt: new Date(),
            })
            .where(eq(credentials.id, existing.id));
          credentialIdMap.set(credential.id, existing.id);
          result.credentials.overwritten += 1;
          continue;
        }

        const name = existing ? uniqueName(credential.name, takenCredentialNames) : credential.name;
        takenCredentialNames.add(name);

        const [created] = await tx
          .insert(credentials)
          .values({
            ownerId: user.id,
            name,
            type: secret.type,
            username: credential.username,
            publicFingerprint: credential.publicFingerprint,
            ...sealSecret(secret, user.id),
          })
          .returning();
        if (!created) throw new Error('Kimlik bilgisi içe aktarılamadı');

        credentialIdMap.set(credential.id, created.id);
        credentialByName.set(name, created);
        if (existing) result.credentials.renamed += 1;
        else result.credentials.created += 1;
      }

      // ------------------------------------------------------------- sunucular

      const existingHosts = await tx
        .select({ id: hosts.id, name: hosts.name })
        .from(hosts)
        .where(and(eq(hosts.ownerId, user.id), eq(hosts.ephemeral, false)));
      const hostByName = new Map(existingHosts.map((h) => [h.name, h.id]));
      const takenHostNames = new Set(existingHosts.map((h) => h.name));

      const hostCursor = new Map<string, number>();
      const nextHostIndex = async (folderId: string | null): Promise<number> => {
        const key = folderId ?? 'root';
        let cursor = hostCursor.get(key);
        if (cursor === undefined) {
          const [row] = await tx
            .select({ max: sql<number | null>`max(${hosts.sortIndex})` })
            .from(hosts)
            .where(
              and(
                eq(hosts.ownerId, user.id),
                eq(hosts.ephemeral, false),
                folderId === null ? sql`${hosts.folderId} is null` : eq(hosts.folderId, folderId),
              ),
            );
          cursor = (row?.max ?? -1) + 1;
        }
        hostCursor.set(key, cursor + 1);
        return cursor;
      };

      const credentialNameById = new Map(pkg.credentials.map((c) => [c.id, c.name]));

      for (const host of pkg.hosts) {
        const folderId = host.folderId ? folderIdMap.get(host.folderId) ?? null : null;
        const credentialId = host.credentialId
          ? credentialIdMap.get(host.credentialId) ?? null
          : null;

        if (host.credentialId && !credentialId) {
          result.warnings.push(
            `"${host.name}" sunucusu "${credentialNameById.get(host.credentialId) ?? 'bilinmeyen'}" ` +
              'kimlik bilgisine bağlıydı; kimlik içe aktarılamadığı için sunucu kimlik bilgisiz kaldı.',
          );
        }

        /**
         * Kullanıcı adı ne sunucuda ne kimlik bilgisinde varsa bağlantı
         * kurulamaz. Envanter uçları bunu baştan reddediyor ama içe aktarımda
         * kaydı düşürmek kullanıcının verisini yok etmek olurdu; uyarıp
         * alıyoruz, düzeltmesi tek alan.
         */
        if (!host.username && !credentialId) {
          result.warnings.push(
            `"${host.name}" sunucusunda SSH kullanıcı adı belirlenemiyor; bağlanmadan önce düzenleyin.`,
          );
        }

        const existingId = hostByName.get(host.name);

        if (existingId && strategy === 'skip') {
          hostIdMap.set(host.id, existingId);
          result.hosts.skipped += 1;
          continue;
        }

        if (existingId && strategy === 'overwrite') {
          await tx
            .update(hosts)
            .set({
              folderId,
              hostname: host.hostname,
              port: host.port,
              username: host.username,
              credentialId,
              defaultPath: host.defaultPath,
              tags: host.tags,
              updatedAt: new Date(),
            })
            .where(eq(hosts.id, existingId));
          hostIdMap.set(host.id, existingId);
          result.hosts.overwritten += 1;
          continue;
        }

        const name = existingId ? uniqueName(host.name, takenHostNames) : host.name;
        takenHostNames.add(name);

        const [created] = await tx
          .insert(hosts)
          .values({
            ownerId: user.id,
            folderId,
            name,
            hostname: host.hostname,
            port: host.port,
            username: host.username,
            credentialId,
            defaultPath: host.defaultPath,
            tags: host.tags,
            // Atlama sunucusu ikinci geçişte bağlanır; hedef sunucu henüz
            // oluşmamış olabilir.
            jumpHostId: null,
            sortIndex: await nextHostIndex(folderId),
          })
          .returning({ id: hosts.id });
        if (!created) throw new Error('Sunucu içe aktarılamadı');

        hostIdMap.set(host.id, created.id);
        hostByName.set(name, created.id);
        if (existingId) result.hosts.renamed += 1;
        else result.hosts.created += 1;
      }

      /**
       * Atlama sunucusu bağları: sunucular birbirine referans verdiği için tek
       * geçişte çözülemiyor. Hepsi oluştuktan sonra ikinci turda bağlanıyor.
       */
      for (const host of pkg.hosts) {
        if (!host.jumpHostId) continue;
        const selfId = hostIdMap.get(host.id);
        const jumpId = hostIdMap.get(host.jumpHostId);
        if (!selfId || !jumpId || selfId === jumpId) continue;
        await tx.update(hosts).set({ jumpHostId: jumpId }).where(eq(hosts.id, selfId));
      }
    });

    await emitAudit({
      action: 'config.import',
      actor: user,
      request,
      detail: {
        secrets: pkg.secrets,
        conflictStrategy: strategy,
        folders: result.folders,
        credentials: result.credentials,
        hosts: result.hosts,
        warnings: result.warnings.length,
      },
    });

    return result;
  });
}
