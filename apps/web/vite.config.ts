import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // ADR-016: PWA 化の目的はホーム画面への設置と起動の速さであって、
    // オフライン動作ではない。キャッシュするのはアプリの外枠だけにする（FR-39）。
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '冷蔵庫から献立',
        short_name: '献立',
        lang: 'ja',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0f6b5f',
      },
      workbox: {
        // 在庫や献立の API 応答はキャッシュしない。
        // オフラインでの登録・編集を許さない方針（FR-41）と揃える。
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
