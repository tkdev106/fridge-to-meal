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
 * 単独のトランザクションになり、表と RLS が別のトランザクションに割れる（ADR-029 決定2）。
 */

/**
 * 公開スキーマごと作り直す。手で作った `public` には既定の権限が付かないので与え直す。
 *
 * 移行が作る `private`（利用者を消す関数の置き場。ADR-071 決定1）も消す — 残すと2回目の
 * `create schema private` が落ちる。`auth.users` の行も消す — 前回の実行の利用者が残ると、
 * 識別子をケースごとに固有にしても次の実行で衝突する（B-56d 設計 規則12）。表そのものは
 * `supabase/local/init.sql` が持つので消さない。
 */
const RESET_SCHEMA_SQL = [
  'drop schema if exists private cascade;',
  'delete from auth.users;',
  'drop schema if exists public cascade;',
  'create schema public;',
  'grant usage on schema public to authenticated, anon;',
].join('\n');

/**
 * 移行のあとに与える、テストだけの権限（B-73 設計 2章・4章 / B-74 設計 4章 / ADR-087 決定3）。
 *
 * テストが参加の行（`household_members`）を役を切り替える前の `authenticator` で置くため
 * （`HouseholdMembers.ts`）。参加の表には `insert` だけを与え、`select` は与えない。
 * 招待の表（`household_invitations`）には `insert` と `select` を与える — 切れた招待を置き、
 * 作った招待の期限を読むため（`HouseholdInvitations.ts`）。`anon` / `authenticated` には
 * 与えない — 2表は関数だけを通す表である。先行は `supabase/local/init.sql` の `auth.users`。
 * 本番のログインロールには与えない。
 *
 * 表は RLS が有効でポリシーが無いので、`authenticator` にだけ効くポリシーもここで置く。
 * 移行ファイルではないので、表の移行の守り（ポリシー0本）には掛からない。
 */
const TEST_ONLY_GRANTS_SQL = [
  'grant usage on schema public to authenticator;',
  'grant insert on public.household_members to authenticator;',
  'create policy "household_members_test_insert" on public.household_members',
  '  for insert to authenticator with check (true);',
  'grant insert, select on public.household_invitations to authenticator;',
  'create policy "household_invitations_test_insert" on public.household_invitations',
  '  for insert to authenticator with check (true);',
  'create policy "household_invitations_test_select" on public.household_invitations',
  '  for select to authenticator using (true);',
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

async function resetSchemas(connection: postgres.Sql): Promise<void> {
  try {
    await connection.unsafe(RESET_SCHEMA_SQL).simple();
  } catch (cause) {
    throw new Error(
      'ローカル Postgres の作り直しに失敗した。`auth.users` が無いなら、クラスタが' +
        '`supabase/local/init.sql` の変更より古い（initdb でしか走らない）。' +
        '`pnpm db:down` してから `pnpm db:up` する（`db:up:native` ならデータ置き場を消して立て直す）。',
      { cause },
    );
  }
}

export default async function applyMigrations(): Promise<void> {
  const connection = postgres(OWNER_CONNECTION_STRING, { max: 1, onnotice: () => {} });

  try {
    await assertConnectable(connection);
    await resetSchemas(connection);

    for (const [fileName, sql] of migrationSqlFiles) {
      try {
        await connection.unsafe(sql).simple();
      } catch (cause) {
        throw new Error(`マイグレーション ${fileName} の適用に失敗した。`, { cause });
      }
    }

    try {
      await connection.unsafe(TEST_ONLY_GRANTS_SQL).simple();
    } catch (cause) {
      throw new Error(
        '移行のあとのテストだけの権限の付与に失敗した。移行が household_members と household_invitations を作っているかを見る。',
        { cause },
      );
    }
  } finally {
    await connection.end();
  }
}
