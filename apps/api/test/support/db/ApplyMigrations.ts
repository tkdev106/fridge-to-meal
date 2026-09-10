import postgres from 'postgres';
import { マイグレーションのSQL } from '../migrations/MigrationFiles.js';
import { 所有者の接続文字列 } from './ConnectionStrings.js';

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
const 作り直すSQL = [
  'drop schema if exists public cascade;',
  'create schema public;',
  'grant usage on schema public to authenticated, anon;',
].join('\n');

async function 繋がることを確かめる(接続: postgres.Sql): Promise<void> {
  try {
    await 接続`select 1`;
  } catch (原因) {
    throw new Error(
      'ローカル Postgres（127.0.0.1:55432）に繋げなかった。`pnpm db:up` を先に実行する。' +
        '初期化 SQL を直した直後は `pnpm db:down` してから `pnpm db:up` する' +
        '（`supabase/local/init.sql` は initdb でしか走らない）。',
      { cause: 原因 },
    );
  }
}

export default async function 適用する(): Promise<void> {
  const 接続 = postgres(所有者の接続文字列, { max: 1, onnotice: () => {} });

  try {
    await 繋がることを確かめる(接続);
    await 接続.unsafe(作り直すSQL).simple();

    for (const [名前, sql] of マイグレーションのSQL) {
      try {
        await 接続.unsafe(sql).simple();
      } catch (原因) {
        throw new Error(`マイグレーション ${名前} の適用に失敗した。`, { cause: 原因 });
      }
    }
  } finally {
    await 接続.end();
  }
}
