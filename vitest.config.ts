import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ドメイン層とユースケース層のテストが主。実 DB・実 API を使わない（ADR-002）。
    include: ['apps/**/test/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    // Docker のローカル Postgres に繋ぐテストは `pnpm test:db`（vitest.db.config.ts）だけが
    // 走らせる。分け方は置き場で決める（B-07d 設計 規則8 / ADR-029 決定4）。
    // **configDefaults.exclude を残す** — 上書きすると node_modules まで走査してしまう。
    exclude: [...configDefaults.exclude, 'apps/api/test/db/**'],
    environment: 'node',
    coverage: {
      include: ['apps/api/src/contexts/*/domain/**', 'apps/api/src/contexts/*/usecase/**'],
    },
  },
});
