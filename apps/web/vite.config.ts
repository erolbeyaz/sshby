import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Dev'de de tarayıcı tek origin görsün: üretimdeki nginx yerleşimiyle
      // birebir aynı, böylece cookie/CORS davranışı ortamlar arasında değişmiyor.
      '/api': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // xterm ve grafik kütüphaneleri giriş ekranında gereksiz; ayrı chunk'a al.
          xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-search', '@xterm/addon-web-links'],
          charts: ['recharts'],
        },
      },
    },
  },
});
