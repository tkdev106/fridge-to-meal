import postgres from 'postgres';
import { migrationSqlFiles } from '../migrations/MigrationFiles.js';
import { OWNER_CONNECTION_STRING } from './ConnectionStrings.js';

/**
 * `pnpm test:db` の `globalSetup`。ローカル Postgres を**毎回作り直してから**
 * `supabase/migrations/*.sql` を流す（B-07d 設計 規則1・2・3 / ADR-029 決定2・結果8）。
 *
 * 所有者（`postgres`）の接続を使ってよいのはここだけである。テスト本体が使うと
 * 行レベルセキュリティを素通りし、**RLS が無くても緑になる**（設計 規則3）。
 *
 * 1ファイル = 1回の**簡易問い合わせ**（`.simple()`）で流す。文ごとに割ると `begin;` が
 * 単独のトランザクションになり、表と RLS が別のトランザクションに割れる（ADR-028）。
 */

/** 公開スキーマごと作り直す。手で作った `public` には既定の権限が付かないので与え直す。 */
const RESET_SCHEMA_SQL = [
  'drop schema if exists public cascade;',
  'create schema public;',
  'grant usage on schema public to authenticated, anon;',
].join('\n');

async function assertConnectable(connection: postgres.Sql): Promise<void> {
  try {
    await connection`select 1`;
  } catch (cause) {
    throw new Error(
      'ローカル Postgres（127.0.0.1:55432）に繋げなかった。`pnpm db:up` を先に実行する。' +
        '初期化 SQL を直した直後は `pnpm db:down` してから `pnpm db:up` する' +
        '（`supabase/local/init.sql` は initdb でしか走らない）。',
      { cause },
    );
  }
}

export default async function applyMigrations(): Promise<void> {
  const connection = postgres(OWNER_CONNECTION_STRING, { max: 1, onnotice: () => {} });

  try {
    await assertConnectable(connection);
    await connection.unsafe(RESET_SCHEMA_SQL).simple();

    for (const [fileName, sql] of migrationSqlFiles) {
      try {
        await connection.unsafe(sql).simple();
      } catch (cause) {
        throw new Error(`マイグレーション ${fileName} の適用に失敗した。`, { cause });
      }
    }
  } finally {
    await connection.end();
  }
}
