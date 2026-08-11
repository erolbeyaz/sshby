import { posix } from 'node:path';
import type { SftpEntry, SftpEntryType } from '@sshby/shared';
import { badRequest } from '../errors.js';
import { runSudo, shellQuote, type SudoContext } from './shell-fs.js';

/** Sudo modunda dizin listeleme ve dosya işlemleri. */

/** `find -printf %y` tür harfleri. */
function typeFromLetter(letter: string): SftpEntryType {
  if (letter === 'd') return 'directory';
  if (letter === 'f') return 'file';
  if (letter === 'l') return 'symlink';
  return 'other';
}

/**
 * `ls -l` yerine `find -printf` kullanılıyor.
 *
 * `ls` çıktısı insan için biçimlendirilmiş: sütun hizalaması yerele göre
 * değişiyor, boşluklu adlar sütunları kaydırıyor, tarih biçimi dosyanın
 * yaşına göre farklılaşıyor. `find -printf` ise alanları istediğimiz sırada
 * ve ayraçla veriyor. Ad en sonda: içinde ayraç geçse bile geri kalan alanlar
 * bozulmuyor.
 */
const FIND_FORMAT = '%y\\t%Y\\t%m\\t%s\\t%T@\\t%U\\t%G\\t%f\\n';

export async function sudoList(ctx: SudoContext, path: string): Promise<SftpEntry[]> {
  const output = await runSudo(
    ctx,
    `find ${shellQuote(path)} -maxdepth 1 -mindepth 1 -printf ${shellQuote(FIND_FORMAT)}`,
  );

  const entries: SftpEntry[] = [];

  for (const line of output.split('\n')) {
    if (!line) continue;
    // Ad en sonda ve içinde sekme olabilir; ilk 7 alanı ayırıp gerisini ad say.
    const parts = line.split('\t');
    if (parts.length < 8) continue;

    const [typeLetter, targetLetter, mode, size, mtime, uid, gid] = parts;
    const name = parts.slice(7).join('\t');
    const type = typeFromLetter(typeLetter ?? '');

    entries.push({
      name,
      path: posix.join(path, name),
      type,
      size: Number(size) || 0,
      modifiedAt: Math.floor(Number(mtime) || 0),
      // find %m sekizlik ama başında sıfır olmadan verir: "755" → "0755".
      mode: `0${(mode ?? '0').padStart(3, '0')}`,
      owner: Number(uid),
      group: Number(gid),
      linkTargetType:
        type === 'symlink' && targetLetter && targetLetter !== 'l'
          ? typeFromLetter(targetLetter)
          : null,
    });
  }

  entries.sort((a, b) => {
    const aDir = a.type === 'directory' || a.linkTargetType === 'directory';
    const bDir = b.type === 'directory' || b.linkTargetType === 'directory';
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'tr');
  });

  return entries;
}

/** Yol verilmediğinde açılacak dizin. */
export async function sudoHome(ctx: SudoContext): Promise<string> {
  const output = await runSudo(ctx, 'pwd');
  return output.trim() || '/';
}

export async function sudoMkdir(ctx: SudoContext, path: string): Promise<void> {
  // Var olan yolu sessizce başarılı saymamak için önce bakıyoruz.
  const exists = await runSudo(ctx, `test -e ${shellQuote(path)} && echo VAR || echo YOK`);
  if (exists.trim() === 'VAR') {
    throw badRequest('already_exists', 'Bu adda bir dosya ya da dizin zaten var.');
  }
  await runSudo(ctx, `mkdir -- ${shellQuote(path)}`);
}

export async function sudoRename(ctx: SudoContext, from: string, to: string): Promise<void> {
  // `mv -n`: hedef varsa üzerine yazma, sessizce geç. Üzerine yazma kararını
  // kullanıcı vermeli, biz varsayamayız.
  const exists = await runSudo(ctx, `test -e ${shellQuote(to)} && echo VAR || echo YOK`);
  if (exists.trim() === 'VAR') {
    throw badRequest('already_exists', 'Hedefte bu adda bir kayıt zaten var.');
  }
  await runSudo(ctx, `mv -n -- ${shellQuote(from)} ${shellQuote(to)}`);
}

export async function sudoChmod(ctx: SudoContext, path: string, mode: string): Promise<void> {
  await runSudo(ctx, `chmod ${shellQuote(mode)} -- ${shellQuote(path)}`);
}

export async function sudoDelete(
  ctx: SudoContext,
  path: string,
  directory: boolean,
): Promise<void> {
  if (path === '/') throw badRequest('refused', 'Kök dizin silinemez.');

  /**
   * Dizinler için `rmdir` kullanılıyor, `rm -rf` değil.
   *
   * Root olarak çalışan özyinelemeli bir silme, yanlış bir yolla çağrıldığında
   * sunucuyu geri dönülemez biçimde bozar. Kullanıcı boş olmayan bir dizini
   * silmek istiyorsa içindekileri tek tek silmeli — bu yavaşlık bilinçli.
   */
  await runSudo(ctx, directory ? `rmdir -- ${shellQuote(path)}` : `rm -f -- ${shellQuote(path)}`);
}

/** Boyut ve tür bilgisi — indirme öncesi doğrulama için. */
export async function sudoStat(
  ctx: SudoContext,
  path: string,
): Promise<{ type: SftpEntryType; size: number }> {
  const output = await runSudo(ctx, `stat -c '%F|%s' -- ${shellQuote(path)}`);
  const [kind, size] = output.trim().split('|');

  return {
    type: kind?.includes('directory')
      ? 'directory'
      : kind?.includes('symbolic')
        ? 'symlink'
        : kind?.includes('regular')
          ? 'file'
          : 'other',
    size: Number(size) || 0,
  };
}
