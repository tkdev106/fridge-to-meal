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
        // 地の色（global.css の --color-background）。起動の画面とブラウザの帯がアプリの地と揃う。
        background_color: '#f4efe4',
        theme_color: '#f4efe4',
        // public/icons/icon.svg（冷蔵庫タブのアイコンの形を、地の色の地に文字の色の線で描いたもの）を
        // 各寸法の PNG に書き出したもの。線は中心から半径 40% の内側に収まるので、
        // 端末が丸や角丸に切り抜いても欠けない（maskable）。形を変えたら PNG も書き出し直す。
        // 同じ場所の *-dark.* は色を反転したもの（文字の色の地に地の色の線）で、ダークモードの
        // ために置いてある。manifest と index.html はまだ使わない。
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
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
