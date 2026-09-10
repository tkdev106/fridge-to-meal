import { defineConfig } from 'drizzle-kit';

/**
 * マイグレーションの生成の設定（ADR-029 決定2）。
 *
 * **`schema` はパス文字列で指す。** import すると、この設定ファイルが `apps/api/src` への
 * 辺を1本作ることになる。生成にしか使わないものが依存グラフに現れる必要はない。
 *
 * 接続情報は環境変数から読む。**接続文字列も鍵もここに書かない**（NFR-09）。
 * 生成そのものは DB に繋がずスキーマの差分だけで行われる。
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/contexts/pantry/infrastructure/db/schema.ts',
  out: '../../supabase/migrations',
  migrations: { prefix: 'supabase' },
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
