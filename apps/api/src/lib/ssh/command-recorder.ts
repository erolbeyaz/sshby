import { StringDecoder } from 'node:string_decoder';

/**
 * Terminal akışından çalıştırılan komutları çıkarır.
 *
 * Gerçek bir PTY'de "komut" diye ayrı bir olay yoktur; yalnızca tuş vuruşları
 * ve ekran çıktısı vardır. Bu yüzden burada yapılan çıkarım sezgiseldir ve
 * sınırları bilinçlidir:
 *
 *  - Satır düzenleme (imleç okları, Ctrl+A/E ile satır ortasına yazma, geçmişten
 *    ↑ ile çağrılan komutlar) tam olarak izlenmez. Bu durumlarda tampon atılır:
 *    yanlış bir komut kaydetmektense hiç kaydetmemek yeğdir.
 *  - Bu kayıt bir *denetim ipucudur*, adli delil değildir. Kesin kayıt gereken
 *    ortamlarda sunucu tarafında `auditd`/`snoopy` kullanılmalıdır.
 *
 * Buna karşılık üç şeyi doğru yapmak zorunda:
 *  1. Parolaları asla kaydetmemek (sudo, ssh, su istemleri).
 *  2. vim/top gibi tam ekran uygulamaların içindeki tuş vuruşlarını komut
 *     sanmamak.
 *  3. Yapıştırılan komutları kaçırmamak.
 */

/** Ekran çıktısında parola istemi görüntüsü. Yakalanırsa sonraki satır yutulur. */
const PASSWORD_PROMPT = /(password|passphrase|parola|şifre)[^\n]{0,40}:\s*$/i;

/** Tam ekran (alternate screen) moduna giriş/çıkış dizileri. */
const ALT_SCREEN_ON = /\x1b\[\?(1049|47|1047)h/;
const ALT_SCREEN_OFF = /\x1b\[\?(1049|47|1047)l/;

/**
 * Bracketed paste sınırlayıcıları. Tarayıcı yapıştırma yaptığında metin bu
 * işaretlerin arasında gelir; sınırlayıcıları tanımasaydık baştaki ESC
 * yüzünden tüm yapıştırma atılır ve yapıştırılarak çalıştırılan komutlar
 * denetim kaydında hiç görünmezdi.
 */
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

const MAX_COMMAND_LENGTH = 8 * 1024;

export class CommandRecorder {
  private buffer = '';
  private altScreen = false;
  private passwordMode = false;
  private pasting = false;
  /** Çıktının son parçası — istem tespiti satır sonuna bakmayı gerektiriyor. */
  private outputTail = '';
  /**
   * Çok baytlı UTF-8 karakterler çerçeve sınırında bölünebilir; StringDecoder
   * yarım kalan baytları bir sonraki parçaya taşır.
   */
  private readonly decoder = new StringDecoder('utf8');

  constructor(private readonly onCommand: (command: string) => void) {}

  /** Sunucudan gelen ekran çıktısı. Yalnızca *durum takibi* için okunuyor. */
  observeOutput(chunk: Buffer): void {
    const text = chunk.toString('utf8');

    if (ALT_SCREEN_ON.test(text)) this.altScreen = true;
    if (ALT_SCREEN_OFF.test(text)) this.altScreen = false;

    // Son 200 karakter yeterli: istem her zaman çıktının sonundadır.
    this.outputTail = (this.outputTail + text).slice(-200);

    /**
     * Parola modu MANDALLIDIR: bir kez tetiklendiğinde sonraki çıktılar onu
     * geri alamaz, yalnızca Enter'a basılması temizler.
     *
     * Sıfırlanabilir yapıldığında sızıntı oluyordu: kullanıcı parolayı yazarken
     * araya giren herhangi bir çıktı (ilerleme satırı, kabuk istemi) bayrağı
     * düşürüyor ve satır denetime yazılıyordu. Mandal, yanlış pozitif hâlinde
     * en fazla bir meşru komutun kaydedilmemesine yol açar — parola sızdırmaya
     * kıyasla kabul edilebilir bir takas.
     */
    if (PASSWORD_PROMPT.test(this.outputTail)) this.passwordMode = true;
  }

  /** İstemciden gelen tuş vuruşları. */
  observeInput(chunk: Buffer): void {
    // Tam ekran uygulamanın içindeyken tuşlar komut değil, uygulama girdisidir.
    if (this.altScreen) return;

    let text = this.decoder.write(chunk);

    // Yapıştırma bloklarını ayıklayıp geri kalanı tuş tuş işliyoruz.
    while (text.length > 0) {
      if (this.pasting) {
        const end = text.indexOf(PASTE_END);
        if (end === -1) {
          this.append(text);
          return;
        }
        this.append(text.slice(0, end));
        this.pasting = false;
        text = text.slice(end + PASTE_END.length);
        continue;
      }

      const start = text.indexOf(PASTE_START);
      if (start === -1) {
        this.consumeKeys(text);
        return;
      }
      this.consumeKeys(text.slice(0, start));
      this.pasting = true;
      text = text.slice(start + PASTE_START.length);
    }
  }

  /** Yapıştırılan metin doğrudan tampona eklenir — düzenleme tuşu içermez. */
  private append(text: string): void {
    if (this.buffer.length >= MAX_COMMAND_LENGTH) return;
    this.buffer += text.slice(0, MAX_COMMAND_LENGTH - this.buffer.length);
  }

  private consumeKeys(text: string): void {
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;

      switch (code) {
        case 0x0d: // Enter
        case 0x0a:
          this.flush();
          break;

        case 0x7f: // Backspace
        case 0x08:
          this.buffer = this.buffer.slice(0, -1);
          break;

        case 0x03: // Ctrl+C — satır iptal edildi, komut çalışmadı
        case 0x15: // Ctrl+U — satırı temizle
          this.buffer = '';
          break;

        case 0x1b:
          /**
           * Yapıştırma dışındaki escape dizileri (ok tuşları, geçmişte gezinme)
           * satırın içeriğini göremediğimiz biçimde değiştirir. Bu noktadan
           * sonra tamponun doğruluğunu garanti edemeyiz, o yüzden atıyoruz.
           */
          this.buffer = '';
          return;

        default:
          // Yazdırılabilir karakterler; kontrol karakterleri elenir.
          if (code >= 0x20 && this.buffer.length < MAX_COMMAND_LENGTH) {
            this.buffer += char;
          }
      }
    }
  }

  private flush(): void {
    const command = this.buffer.trim();
    this.buffer = '';

    // Parola istemine verilen yanıt asla denetime yazılmaz.
    const wasPasswordMode = this.passwordMode;
    this.passwordMode = false;
    // Tampon da temizlensin: eski istem metni bir sonraki satırı da tetiklemesin.
    this.outputTail = '';

    if (wasPasswordMode || command.length === 0) return;

    this.onCommand(command);
  }

  /** Oturum kapanırken yarım kalmış satır varsa yok sayılır — çalıştırılmadı. */
  dispose(): void {
    this.buffer = '';
  }
}
