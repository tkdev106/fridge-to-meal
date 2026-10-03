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
        name: 'fridge to meal',
        short_name: 'fridge to meal',
        lang: 'ja',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0f6b5f',
      },
      workbox: {
        // 在庫や献立の API 応答はキャッシュしない。
        // オフラインでの登録・編集を許さない方針（FR-41）と揃える。
        // 書体（woff2）は precache しない。Zen Kaku Gothic New だけで 242 ファイル（約3MB）あり、
        // 全部を落とすと unicode-range の分割を活かせない。使った分割だけを下で持つ（ADR-075）。
        // fonts.css は css として従来どおり precache される。
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallbackDenylist: [/^\/api\//],
        // 書体は実行時に使った分割だけを端末に残す（ADR-075）。対象は自前で置いた /fonts/ の
        // woff2 に限り、API の応答はここにも入れない（FR-41）。CacheFirst は同じ URL に古い中身を
        // 返すため、書体の差し替えは版を変えたディレクトリで行う。まだ取りに行っていない分割は
        // オフラインでは font-display: swap で手元の書体に落ちる（ADR-016）。
        runtimeCaching: [
          {
            urlPattern: ({ sameOrigin, url }) =>
              sameOrigin && url.pathname.startsWith('/fonts/') && url.pathname.endsWith('.woff2'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
