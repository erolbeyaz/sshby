import type { Config } from 'tailwindcss';

/**
 * Renkler `sshby-images/sshby-brand.html` marka panosundan gelir.
 * Buraya elle yeni bir renk eklemeden önce panoya bakın — paletin dar olması
 * kasıtlı bir tasarım kararı.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#181818',
        surface: '#1E1E1E',
        'surface-2': '#232323',
        line: '#2A2A2A',
        fg: '#F3F3F3',
        'fg-dim': '#8A8A8A',
        accent: {
          DEFAULT: '#10B981',
          fg: '#08201A',
          muted: 'rgba(16,185,129,0.12)',
        },
        /** YALNIZCA denetim / Elasticsearch izi. Yeşille aynı öğede kullanılmaz. */
        trace: {
          DEFAULT: '#6E5AE6',
          muted: 'rgba(110,90,230,0.12)',
          border: 'rgba(110,90,230,0.4)',
        },
        danger: '#E06C6C',
        warn: '#D8A657',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Panodaki eyebrow/etiket ölçüsü — çok sık kullanılıyor, isim verildi.
        label: ['11px', { lineHeight: '1.4', letterSpacing: '0.14em' }],
      },
      borderRadius: {
        DEFAULT: '8px',
        panel: '14px',
      },
      keyframes: {
        blink: {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
      },
      animation: {
        blink: 'blink 1.2s steps(1, end) infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
