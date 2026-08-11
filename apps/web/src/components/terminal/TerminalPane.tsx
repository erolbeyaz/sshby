import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {
  serverTerminalMessageSchema,
  type ClientTerminalMessage,
  type ServerTerminalMessage,
} from '@sshby/shared';
import { apiFetch, ApiRequestError } from '@/lib/api';
import { useTerminalStore } from '@/lib/terminal-store';
import { AuthPromptDialog } from './AuthPromptDialog';
import { HostKeyDialog } from './HostKeyDialog';
import { TerminalContextMenu } from './TerminalContextMenu';
import { copyText, readClipboard } from './clipboard';

/** xterm teması — marka paletiyle birebir. */
const XTERM_THEME = {
  background: '#181818',
  foreground: '#F3F3F3',
  cursor: '#10B981',
  cursorAccent: '#08201A',
  selectionBackground: 'rgba(16,185,129,0.28)',
  black: '#181818',
  red: '#E06C6C',
  green: '#10B981',
  yellow: '#D8A657',
  blue: '#7DAEA3',
  magenta: '#6E5AE6',
  cyan: '#89B4B0',
  white: '#D4D4D4',
  brightBlack: '#8A8A8A',
  brightRed: '#EE8A8A',
  brightGreen: '#3DD9A4',
  brightYellow: '#E8BE79',
  brightBlue: '#9CC7BD',
  brightMagenta: '#8E7BF0',
  brightCyan: '#A6CCC8',
  brightWhite: '#F3F3F3',
};

type PromptState = Extract<ServerTerminalMessage, { type: 'hostkey_prompt' }> | null;
type AuthState = Extract<ServerTerminalMessage, { type: 'auth_prompt' }> | null;

export function TerminalPane({
  tabId,
  hostId,
  visible,
}: {
  tabId: string;
  hostId: string;
  /** Görünmeyen sekmeler DOM'da kalır (oturum yaşasın) ama ölçülemez. */
  visible: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const [prompt, setPrompt] = useState<PromptState>(null);
  const [authPrompt, setAuthPrompt] = useState<AuthState>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const patchTab = useTerminalStore((s) => s.patchTab);

  /** Panodan okuyup terminale gönderir. */
  const paste = useCallback(async () => {
    const term = termRef.current;
    if (!term) return;

    const result = await readClipboard();
    // Odağı her durumda terminale geri ver: yapıştırdıktan sonra Enter'a
    // basabilmek için kullanıcının tekrar tıklaması gerekmemeli.
    term.focus();

    if (result.ok) {
      // term.paste: bracketed paste modunu doğru uygular, çok satırlı metni
      // kabuğun tek parça olarak görmesini sağlar.
      if (result.text) term.paste(result.text);
      return;
    }
    setNotice(result.reason);
  }, []);

  /** Seçili metni panoya kopyalar. */
  const copy = useCallback(async () => {
    const term = termRef.current;
    const text = term?.getSelection() ?? '';
    if (!text) return;
    const result = await copyText(text);
    term?.focus();
    if (!result.ok) setNotice(result.reason);
  }, []);

  /**
   * Tuş işleyicisi bir kez kurulup ömür boyu yaşıyor; güncel kopyala/yapıştır
   * işlevlerine ref üzerinden erişiyor ki kurulum efektini yeniden çalıştırmak
   * (ve oturumu koparmak) gerekmesin.
   */
  const copyRef = useRef(copy);
  const pasteRef = useRef(paste);
  useEffect(() => {
    copyRef.current = copy;
    pasteRef.current = paste;
  }, [copy, paste]);

  /**
   * Kurulum yalnızca bir kez çalışır. `tabId` sabit olduğu için bağımlılık
   * listesi kasıtlı olarak dar tutuldu — yeniden çalışması oturumu koparırdı.
   */
  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    const term = new Terminal({
      theme: XTERM_THEME,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      // Kaydırma tamponu: uzun derleme çıktılarında geriye bakmak için.
      scrollback: 10_000,
      allowProposedApi: true,
      macOptionIsMeta: true,
      // Sağ tık kendi menümüzü açıyor; xterm'in kelime seçmesi araya girmesin.
      rightClickSelectsWord: false,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    termRef.current = term;

    let disposed = false;
    let socket: WebSocket | null = null;
    const encoder = new TextEncoder();

    /**
     * Ölçümü yeniden yapmadan önce boyutun GERÇEKTEN değiştiğini doğrular.
     *
     * Koşulsuz `fit()` çağırmak sayfayı donduruyordu: fit terminali yeniden
     * boyutlandırır, bu kaydırma çubuğunu getirip götürür, bu da konteynerin
     * genişliğini değiştirip ResizeObserver'ı yeniden tetikler — sonsuz döngü.
     * Yapıştırma tam da bol çıktı ürettiği için kaydırma çubuğunu tetikliyor
     * ve donmanın en kolay görüldüğü an oluyordu. Hedef ölçü mevcutla aynıysa
     * hiçbir şey yapmamak zinciri kırıyor.
     */
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    /** Son uygulanan iki ölçü — salınım tespiti için. */
    let previousDims = '';
    let currentDims = '';
    let lastAppliedAt = 0;

    function refit() {
      if (scheduled !== null || disposed) return;

      // requestAnimationFrame yerine setTimeout: arka plandaki sekmelerde de
      // çalışır ve ölçüm mantığı çizim döngüsüne bağlı kalmaz.
      scheduled = setTimeout(() => {
        scheduled = null;
        if (disposed || !container?.isConnected) return;
        if (container.clientWidth === 0 || container.clientHeight === 0) return;

        const dims = fit.proposeDimensions();
        if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
        if (dims.cols < 1 || dims.rows < 1) return;

        // Döngüyü kıran birinci koşul: hedef ölçü zaten geçerliyse dokunma.
        if (dims.cols === term.cols && dims.rows === term.rows) return;

        /**
         * İkinci koruma: A → B → A salınımını durdur.
         *
         * Kapsayıcı yüksekliği terminalin yüksekliğinden etkilenebildiğinde
         * (kaydırma çubuğunun gelip gitmesi buna yeter) ölçüm iki değer
         * arasında gidip gelebiliyor ve ilk koşul asla sağlanmıyor. Böyle bir
         * durumda son ölçüde kalmak, sayfayı dondurmaktan iyidir.
         */
        const proposal = `${dims.cols}x${dims.rows}`;

        /**
         * Geçmiş yalnızca kısa bir pencerede anlamlı. Salınım milisaniyeler
         * içinde olur; yarım saniye sonra gelen istek kullanıcının pencereyi
         * yeniden boyutlandırmasıdır ve engellenmemeli.
         */
        const now = Date.now();
        if (now - lastAppliedAt > 500) {
          previousDims = '';
          currentDims = '';
        }
        if (proposal === previousDims) return;

        previousDims = currentDims;
        currentDims = proposal;
        lastAppliedAt = now;

        try {
          term.resize(dims.cols, dims.rows);
        } catch {
          // Ölçüm sırasında panel gizlenmiş olabilir.
        }
      }, 16);
    }
    fitRef.current = refit;

    function writeNotice(text: string, color: '31' | '32' | '33' = '33') {
      term.writeln(`\r\n\x1b[${color}m${text}\x1b[0m`);
    }

    function sendControl(message: ClientTerminalMessage) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    }

    async function connect() {
      refit();

      let ticket: string;
      try {
        const res = await apiFetch<{ ticket: string }>('/terminal/ticket', {
          method: 'POST',
          body: JSON.stringify({ hostId }),
        });
        ticket = res.ticket;
      } catch (err) {
        const message =
          err instanceof ApiRequestError ? err.message : 'Bağlantı bileti alınamadı.';
        writeNotice(message, '31');
        patchTab(tabId, { state: 'error', error: message });
        return;
      }

      if (disposed) return;

      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${scheme}://${location.host}/ws/terminal?ticket=${encodeURIComponent(ticket)}&cols=${term.cols}&rows=${term.rows}`;

      socket = new WebSocket(url);
      // İkili çerçeveleri kopyasız okumak için.
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(event.data));
          return;
        }

        const parsed = serverTerminalMessageSchema.safeParse(JSON.parse(String(event.data)));
        if (!parsed.success) return;
        const message = parsed.data;

        switch (message.type) {
          case 'status':
            if (message.state === 'ready') {
              patchTab(tabId, { state: 'ready', error: null });
              // Kabuk açıldıktan sonra gerçek boyutu bildir.
              sendControl({ type: 'resize', cols: term.cols, rows: term.rows });
              term.focus();
            }
            if (message.state === 'closed') {
              patchTab(tabId, { state: 'closed' });
              writeNotice(message.message ?? 'Oturum kapandı.');
            }
            break;

          case 'hostkey_prompt':
            setPrompt(message);
            break;

          case 'auth_prompt':
            setAuthPrompt(message);
            break;

          case 'error':
            patchTab(tabId, { state: 'error', error: message.message });
            writeNotice(message.message, '31');
            break;

          case 'session':
            patchTab(tabId, { state: 'ready' });
            break;

          case 'pong':
            break;
        }
      };

      socket.onclose = () => {
        patchTab(tabId, { state: 'closed' });
        writeNotice('Bağlantı kapandı.');
      };

      socket.onerror = () => {
        patchTab(tabId, { state: 'error', error: 'WebSocket bağlantısı kurulamadı.' });
      };
    }

    // Tuş vuruşları ikili çerçeve olarak gider; kontrol mesajlarıyla karışmaz.
    const dataSub = term.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(encoder.encode(data));
    });

    const resizeSub = term.onResize(({ cols, rows }) => {
      sendControl({ type: 'resize', cols, rows });
    });

    /**
     * Kopyala/yapıştır kısayolları.
     *
     * Kritik incelik: seçim YOKKEN Ctrl+C terminale geçmeli, çünkü orada
     * anlamı "çalışan işlemi durdur" (SIGINT). Bunu kopyalamaya çevirmek
     * terminalin en temel tuşunu bozardı. Seçim varken kopyalıyoruz —
     * VS Code ve Windows Terminal de aynı kuralı uygular.
     */
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;

      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return true;
      const key = event.key.toLowerCase();

      // Ctrl+Shift+C / Ctrl+Shift+V — terminal dünyasının standardı.
      if (event.shiftKey) {
        if (key === 'c') {
          void copyRef.current();
          return false;
        }
        if (key === 'v') {
          void pasteRef.current();
          return false;
        }
        return true;
      }

      if (key === 'c' && term.hasSelection()) {
        void copyRef.current();
        return false;
      }

      /**
       * Ctrl+V bilerek YAKALANMIYOR.
       *
       * Tarayıcının kendi yapıştırma olayı zaten xterm'in gizli textarea'sına
       * düşüyor ve xterm onu doğru şekilde işliyor — üstelik izin istemeden,
       * her tarayıcıda ve HTTPS olmayan sayfalarda da. Tuşu yakalayıp
       * `navigator.clipboard.readText()` ile okumaya kalksaydık, izin
       * reddedildiğinde ya da API bulunmadığında yapıştırmayı tamamen
       * kırardık: tarayıcının çalışan yolunu engellemiş, yerine çalışmayan
       * bir şey koymuş olurduk. Programatik okuma yalnızca sağ tık menüsünde
       * kullanılıyor, çünkü orada yerel bir alternatif yok.
       */
      return true;
    });

    /**
     * Yapıştırmayı xterm'in kendi dinleyicisine bırakmak yerine yakalama
     * (capture) evresinde biz ele alıyoruz.
     *
     * Bu yol tarayıcının kendi yapıştırma olayını kullanır: izin istemez,
     * HTTPS gerektirmez, Firefox dahil her tarayıcıda çalışır. Kendi
     * dinleyicimizin olması davranışı belirlenebilir kılıyor — kütüphanenin
     * iç uygulaması değişse bile yapıştırma çalışmaya devam eder. Olayı
     * durdurduğumuz için çift yapıştırma riski de yok.
     */
    function onPaste(event: ClipboardEvent) {
      const text = event.clipboardData?.getData('text/plain');
      if (!text) return;
      event.preventDefault();
      event.stopPropagation();
      // term.paste: bracketed paste modunu uygular, çok satırlı metni kabuk
      // tek parça olarak görür.
      term.paste(text);
    }
    container.addEventListener('paste', onPaste, true);

    void connect();

    const observer = new ResizeObserver(refit);
    observer.observe(container);

    return () => {
      disposed = true;
      if (scheduled !== null) clearTimeout(scheduled);
      observer.disconnect();
      container.removeEventListener('paste', onPaste, true);
      dataSub.dispose();
      resizeSub.dispose();
      socket?.close();
      term.dispose();
    };
  }, [tabId, hostId, patchTab]);

  /**
   * Sekme yeniden görünür olduğunda yeniden ölç: gizliyken konteynerin
   * genişliği 0 olduğu için xterm yanlış sütun sayısıyla kalıyor.
   */
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      fitRef.current?.();
      termRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [visible]);

  /** Uyarı balonu kendiliğinden kaybolsun. */
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  function decideHostKey(accept: boolean) {
    if (!prompt) return;
    socketRef.current?.send(
      JSON.stringify({ type: 'hostkey_decision', fingerprint: prompt.fingerprint, accept }),
    );
    setPrompt(null);
  }

  return (
    <div
      className="relative h-full min-h-0 w-full bg-bg"
      /**
       * Menü ve odak kök öğede: terminalin çevresindeki dolgu şeridi de
       * terminal gibi davranmalı. Aksi hâlde kullanıcı birkaç piksel dışarı
       * tıkladığında tarayıcının kendi menüsünü görüyor.
       */
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
      onMouseDown={(event) => {
        // Yalnızca xterm'in dışına tıklandığında odağı geri ver; içeride
        // metin seçimini bozmamak için karışmıyoruz.
        if (event.target === event.currentTarget || event.target === hostRef.current) {
          termRef.current?.focus();
        }
      }}
    >
      <div ref={hostRef} className="h-full w-full px-2 py-1.5" />

      {menu && (
        <TerminalContextMenu
          x={menu.x}
          y={menu.y}
          hasSelection={termRef.current?.hasSelection() ?? false}
          onClose={() => {
            setMenu(null);
            // Menü hangi yolla kapanırsa kapansın klavye terminalde kalsın.
            termRef.current?.focus();
          }}
          onCopy={() => void copy()}
          onPaste={() => void paste()}
          onSelectAll={() => termRef.current?.selectAll()}
          onClear={() => {
            termRef.current?.clear();
            termRef.current?.focus();
          }}
        />
      )}

      {notice && (
        <div
          role="status"
          className="absolute bottom-3 left-1/2 z-30 max-w-[90%] -translate-x-1/2 rounded border border-warn/40 bg-surface px-3.5 py-2 text-[12.5px] text-warn shadow-lg"
        >
          {notice}
        </div>
      )}

      {prompt && (
        <HostKeyDialog
          prompt={prompt}
          onAccept={() => decideHostKey(true)}
          onReject={() => decideHostKey(false)}
        />
      )}

      {authPrompt && (
        <AuthPromptDialog
          prompt={authPrompt}
          onSubmit={(password) => {
            socketRef.current?.send(
              JSON.stringify({ type: 'auth_response', password, cancelled: false }),
            );
            setAuthPrompt(null);
            termRef.current?.focus();
          }}
          onCancel={() => {
            socketRef.current?.send(
              JSON.stringify({ type: 'auth_response', password: '', cancelled: true }),
            );
            setAuthPrompt(null);
          }}
        />
      )}
    </div>
  );
}
