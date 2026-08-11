/**
 * Pano erişimi.
 *
 * Önemli kısıt: `navigator.clipboard` yalnızca **güvenli bağlamda** (HTTPS ya
 * da localhost) tanımlıdır. Uygulama şirket içinde düz HTTP üzerinden
 * sunulursa tarayıcı bu API'yi hiç vermez. Bu yüzden her çağrı başarısız
 * olabilir kabul edilir ve kullanıcıya ne yapması gerektiği söylenir —
 * sessizce hiçbir şey olmaması en kötü davranış olurdu.
 */

export type ClipboardResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

const INSECURE_HINT =
  'Tarayıcı panoya erişemiyor. Bu özellik yalnızca HTTPS (ya da localhost) ' +
  'üzerinden çalışır. Şimdilik Ctrl+V ile yapıştırabilirsiniz.';

/**
 * Panoyu programatik okuma yalnızca sağ tık menüsünde kullanılır. Ctrl+V
 * tarayıcının kendi yapıştırma olayına bırakıldığı için bu yolun başarısız
 * olması kullanıcıyı yapıştırmaktan alıkoymaz.
 */
export async function readClipboard(): Promise<ClipboardResult> {
  if (typeof navigator.clipboard?.readText !== 'function') {
    return { ok: false, reason: INSECURE_HINT };
  }

  try {
    return { ok: true, text: await navigator.clipboard.readText() };
  } catch {
    // Kullanıcı izni reddettiyse ya da tarayıcı politikası engellediyse.
    return {
      ok: false,
      reason:
        'Pano okunamadı. Tarayıcı izin istemişse onaylayın ya da Ctrl+V ile yapıştırın.',
    };
  }
}

export async function copyText(text: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch {
      // Aşağıdaki geri düşüşü dene.
    }
  }

  /**
   * HTTPS olmayan ortamlar için geri düşüş. `execCommand` kullanımdan
   * kaldırılmış sayılıyor ama kopyalama için hâlâ evrensel olarak çalışıyor
   * ve düz HTTP'de tek seçenek. (Yapıştırmanın böyle bir karşılığı yok:
   * tarayıcılar sayfanın panoyu izinsiz OKUMASINA hiçbir koşulda izin vermez.)
   */
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Ekran dışına al: görünür bir alan sayfayı kaydırır ve titremeye yol açar.
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (copied) return { ok: true };
  } catch {
    // Aşağıdaki mesajla bitir.
  }

  return { ok: false, reason: 'Panoya kopyalanamadı. Metni seçip Ctrl+C kullanabilirsiniz.' };
}
