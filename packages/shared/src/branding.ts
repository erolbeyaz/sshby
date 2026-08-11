/**
 * Marka token'ları — `sshby-images/sshby-brand.html` marka panosundan birebir alındı.
 * Tek kaynak burasıdır; Tailwind teması ve xterm renk paleti bunu okur.
 */
export const BRAND = {
  bg: '#181818',
  surface: '#1E1E1E',
  surface2: '#232323',
  line: '#2A2A2A',
  fg: '#F3F3F3',
  fgDim: '#8A8A8A',
  /** Vurgu, imleç, aktif oturum, birincil buton. */
  accent: '#10B981',
  /** YALNIZCA denetim / Elasticsearch izi bağlamında. Yeşille aynı öğede kullanılmaz. */
  trace: '#6E5AE6',
  danger: '#E06C6C',
  /** İkonun içindeki koyu yeşil — yeşil zemin üzerindeki metin/şekil rengi. */
  onAccent: '#08201A',
} as const;

export const FONTS = {
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  sans: "'Inter', system-ui, -apple-system, sans-serif",
} as const;

/** xterm.js tema nesnesi — terminal, uygulamanın geri kalanıyla aynı paleti kullanır. */
export const TERMINAL_THEME = {
  background: BRAND.bg,
  foreground: BRAND.fg,
  cursor: BRAND.accent,
  cursorAccent: BRAND.bg,
  selectionBackground: 'rgba(16, 185, 129, 0.28)',
  black: '#181818',
  red: '#E06C6C',
  green: BRAND.accent,
  yellow: '#D8A657',
  blue: '#7DAEA3',
  magenta: '#B78BE0',
  cyan: '#89B4B4',
  white: '#C8C8C8',
  brightBlack: '#5A5A5A',
  brightRed: '#F08A8A',
  brightGreen: '#3DD6A0',
  brightYellow: '#E8C07A',
  brightBlue: '#9BC7BE',
  brightMagenta: '#CDA8EE',
  brightCyan: '#A6CCCC',
  brightWhite: BRAND.fg,
} as const;
