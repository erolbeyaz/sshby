import { Transform, type Readable, type TransformCallback, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { badRequest, forbidden } from '../errors.js';
import type { Client, ClientChannel } from './ssh2.js';

/**
 * Kabuk komutlarıyla dosya sistemi erişimi — "sudo modu".
 *
 * Neden gerekli: SFTP alt sistemi, sshd tarafından giriş yapan kullanıcı
 * kimliğiyle ayrı bir süreç olarak başlatılır. Terminalde `sudo su` yapmak
 * yalnızca o kabuğun sürecini yükseltir; SFTP kanalı bundan etkilenmez.
 * Yetki gerektiren dizinlere ulaşmanın tek yolu komutları `sudo` ile
 * çalıştırmak.
 *
 * Bedeli açık: `find` çıktısı ayrıştırılıyor, ikili veri base64 ile taşınıyor
 * (~%33 fazladan trafik) ve büyük dosyalarda SFTP'den yavaş. Bu yüzden sudo
 * modu varsayılan değil, kullanıcının açtığı bir kip.
 */

/**
 * Kabuk için tek tırnak içine alır.
 *
 * Bu fonksiyon güvenliğin taşıyıcı kolonu: yol kullanıcıdan geliyor ve komut
 * root olarak çalışıyor. Tek tırnak içinde kabuk hiçbir şeyi yorumlamaz;
 * tek kaçış gereken karakter tırnağın kendisi, o da tırnağı kapatıp kaçırılmış
 * bir tırnak ekleyip yeniden açarak halledilir.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export interface SudoContext {
  client: Client;
  /** Bellekte tutulan sudo parolası; asla diske ya da denetime yazılmaz. */
  password: string;
}

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * `sudo -S -k`: parolayı stdin'den okur (`-S`) ve önbelleğe alınmış yetkiyi
 * geçersiz kılar (`-k`).
 *
 * `-k` şart: sudo yetkisi önbellekteyse parolayı stdin'den OKUMAZ, o zaman
 * yazdığımız parola satırı komutun kendi girdisine karışır. Yükleme sırasında
 * bu, dosyanın başına parolanın yazılması demek olurdu. `-k` ile davranış her
 * çağrıda aynı: sudo bir satır tüketir.
 */
function sudoCommand(command: string): string {
  return `sudo -S -k -p '' ${command}`;
}

function openChannel(client: Client, command: string): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.exec(command, { pty: false }, (err, channel) => {
      if (err) reject(err);
      else resolve(channel);
    });
  });
}

/** Sudo hatalarını kullanıcıya anlamlı hâle getirir. */
function interpret(result: ExecResult): never | void {
  if (result.code === 0) return;

  const stderr = result.stderr.toLowerCase();
  if (stderr.includes('incorrect password') || stderr.includes('sorry, try again')) {
    throw forbidden('Sudo parolası yanlış.');
  }
  if (stderr.includes('is not in the sudoers')) {
    throw forbidden('Bu kullanıcının sunucuda sudo yetkisi yok.');
  }
  if (stderr.includes('no such file or directory')) {
    throw badRequest('not_found', 'Dosya ya da dizin bulunamadı.');
  }
  if (stderr.includes('permission denied')) {
    throw badRequest('permission_denied', 'Sudo ile bile erişilemedi.');
  }
  if (stderr.includes('not empty')) {
    throw badRequest('directory_not_empty', 'Dizin boş değil. Önce içindekileri silin.');
  }

  throw badRequest(
    'shell_error',
    `Komut başarısız: ${result.stderr.trim().split('\n')[0] || `çıkış kodu ${result.code}`}`,
  );
}

/** Çıktısı belleğe sığan komutlar için. */
export async function runSudo(ctx: SudoContext, command: string): Promise<string> {
  const channel = await openChannel(ctx.client, sudoCommand(command));

  const result = await new Promise<ExecResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let code = -1;

    channel.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      // Kaçak bir çıktı belleği doldurmasın.
      if (stdout.length > 32 * 1024 * 1024) {
        channel.destroy();
        reject(new Error('Komut çıktısı beklenenden büyük'));
      }
    });
    channel.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    channel.on('exit', (exitCode: number) => {
      code = exitCode ?? -1;
    });
    channel.on('close', () => resolve({ code, stdout, stderr }));
    channel.on('error', reject);

    /**
     * Parolayı yazıp stdin'i HEMEN kapatıyoruz.
     *
     * Kapatmazsak parola yanlış olduğunda sudo ikinci ve üçüncü denemeler için
     * girdi beklemeye devam ediyor ve istek dakikalarca asılı kalıyor. EOF
     * görünce ilk denemede pes edip hata veriyor. Buradaki komutların hiçbiri
     * stdin okumadığı için kapatmanın başka bir maliyeti yok.
     */
    channel.write(`${ctx.password}\n`);
    channel.end();
  });

  interpret(result);
  return result.stdout;
}

/**
 * Sudo GEREKTİRMEYEN komutlar için. `df` gibi okuma komutları normal
 * kullanıcıyla çalışır; sudo istemek gereksiz sürtünme olurdu.
 */
export async function runPlain(client: Client, command: string): Promise<string> {
  const channel = await openChannel(client, command);

  return new Promise<string>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    channel.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    channel.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    channel.on('close', () => {
      if (stdout.trim().length > 0) resolve(stdout);
      else reject(badRequest('shell_error', stderr.trim() || 'Komut çıktı üretmedi.'));
    });
    channel.on('error', reject);
    channel.end();
  });
}

/** Sudo parolasının doğruluğunu, hiçbir şey değiştirmeden sınar. */
export async function verifySudo(ctx: SudoContext): Promise<void> {
  await runSudo(ctx, 'true');
}

/**
 * İndirme: uzak uçta base64'e çevrilip akıtılır, burada çözülüp yanıta yazılır.
 * Dosya hiçbir zaman tamamen belleğe alınmaz.
 */
export async function streamSudoRead(
  ctx: SudoContext,
  path: string,
  destination: Writable,
): Promise<void> {
  const channel = await openChannel(ctx.client, sudoCommand(`base64 -- ${shellQuote(path)}`));

  return new Promise<void>((resolve, reject) => {
    let stderr = '';
    /** base64 satır sonlarıyla gelir; yarım kalan parçayı taşımak gerekiyor. */
    let carry = '';

    channel.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    channel.on('data', (chunk: Buffer) => {
      const text = carry + chunk.toString('ascii').replace(/\s+/g, '');
      // base64 dört karakterlik bloklar hâlinde çözülür; artanı sonraya bırak.
      const usable = text.length - (text.length % 4);
      carry = text.slice(usable);
      if (usable > 0) destination.write(Buffer.from(text.slice(0, usable), 'base64'));
    });

    channel.on('close', () => {
      if (stderr.trim()) {
        reject(
          stderr.toLowerCase().includes('no such file')
            ? badRequest('not_found', 'Dosya bulunamadı.')
            : badRequest('shell_error', `Okunamadı: ${stderr.trim().split('\n')[0]}`),
        );
        return;
      }
      if (carry.length > 0) destination.write(Buffer.from(carry, 'base64'));
      resolve();
    });
    channel.on('error', reject);

    channel.write(`${ctx.password}\n`);
  });
}

/**
 * Gövdeyi base64'e çeviren dönüştürücü.
 *
 * base64 üç baytı dört karaktere çevirir. Gelen parçaları tek tek kodlayıp uç
 * uca eklemek YANLIŞ olurdu: uzunluğu üçün katı olmayan her parçanın sonuna
 * `=` dolgusu gelir ve `base64 -d` dolguyu akışın sonu sayar. Bu yüzden
 * yalnızca üçün katı kadarı yazılıp artan bir sonraki parçaya taşınıyor;
 * dolgu yalnızca en sonda, bir kez oluşuyor.
 */
class Base64Encoder extends Transform {
  private carry: Buffer = Buffer.alloc(0);

  override _transform(chunk: Buffer, _encoding: string, done: TransformCallback): void {
    const buffer = this.carry.length > 0 ? Buffer.concat([this.carry, chunk]) : chunk;
    const usable = buffer.length - (buffer.length % 3);
    // Kopyalıyoruz: subarray aynı belleği paylaşır, sonraki concat bozabilir.
    this.carry = Buffer.from(buffer.subarray(usable));
    done(null, usable > 0 ? `${buffer.subarray(0, usable).toString('base64')}\n` : undefined);
  }

  override _flush(done: TransformCallback): void {
    done(null, this.carry.length > 0 ? `${this.carry.toString('base64')}\n` : undefined);
  }
}

/** Yükleme: gövde base64'e çevrilerek uzak uçtaki `base64 -d`ye akıtılır. */
export async function streamSudoWrite(
  ctx: SudoContext,
  path: string,
  source: Readable,
): Promise<void> {
  const channel = await openChannel(
    ctx.client,
    sudoCommand(`sh -c ${shellQuote(`base64 -d > ${shellQuote(path)}`)}`),
  );

  let stderr = '';
  let code = -1;
  channel.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  channel.on('exit', (exitCode: number) => {
    code = exitCode ?? -1;
  });

  /**
   * Uzak ucun stdout'unu tüketmek ŞART, çıktısını kullanmasak bile.
   *
   * Kanal çift yönlü bir akış; `close` olayı ancak iki taraf da bittiğinde
   * yayılıyor. Okunabilir tarafı hiç okumazsak akış hiç bitmiyor, `close`
   * gelmiyor ve istek — dosya sunucuya yazılmış olmasına rağmen — sonsuza
   * kadar yanıtsız kalıyor. Bunu bulmak zor oldu: yükleme çalışıyor ama
   * cevap dönmüyordu.
   */
  channel.resume();

  const finished = new Promise<void>((resolve, reject) => {
    channel.on('close', () => resolve());
    channel.on('error', reject);
  });

  // Sudo parolası veriden önce, ayrı bir satır olarak.
  channel.write(`${ctx.password}\n`);

  /**
   * Geri basıncı `pipeline` yönetiyor.
   *
   * Elle `write()` dönüş değerine bakıp `pause()`/`drain` kurgusu yazmıştım ve
   * yükleme kilitleniyordu: ssh2 kanalı beklediğimiz anda `drain` yaymayınca
   * kaynak sonsuza kadar duraklı kalıyor, dolayısıyla `end` hiç gelmiyordu.
   * Akış yönetimini Node'a bırakmak bu hata sınıfını tamamen ortadan
   * kaldırıyor.
   */
  await pipeline(source, new Base64Encoder(), channel);
  await finished;

  if (code !== 0 || stderr.toLowerCase().includes('incorrect password')) {
    interpret({ code, stdout: '', stderr });
  }
}
