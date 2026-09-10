import { defineConfig } from 'vitest/config';

/**
 * `pnpm test:db`（Docker のローカル Postgres に対して走る側）の設定。
 * **`pnpm verify` はこちらを走らせない** — 手元の速い経路を Docker 無しで残す（ADR-029 結果5）。
 *
 * 走らせるのは `apps/api/test/db/**` だけ。`apps/api/test/migrations/` は
 * ファイルの中身を読むだけで Docker を要さないため、`pnpm test` 側に残る（B-07d 設計 規則8）。
 */
export default defineConfig({
  test: {
    include: ['apps/api/test/db/**/*.test.ts'],
    environment: 'node',
    // 適用は globalSetup が毎回作り直す（設計 規則1・2）。
    globalSetup: ['apps/api/test/support/db/ApplyMigrations.ts'],
    // データベースは共有資源で、globalSetup が公開スキーマごと作り直す（設計 規則8）。
    fileParallelism: false,
  },
});
