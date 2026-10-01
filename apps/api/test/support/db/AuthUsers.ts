import type { Sql } from 'postgres';

/**
 * ローカルの `auth.users` に利用者の行を置き、数える道具（B-56d 設計書 規則11）。
 *
 * **役を切り替える前の `authenticator` で呼ぶ。** `anon` / `authenticated` には `auth.users` の
 * 権限を与えない（ADR-071 決定3）ので、トランザクションの中で役を切り替えたあとには使えない。
 * 所有者（`postgres`）では繋がない（B-07d 規則3）。
 *
 * 置いた行は消さない — 後片付けはせず、識別子をケースごとに固有にする（先行 `MealRows.ts`）。
 */

/** 利用者を1行置く。列は `id` の1つだけ（設計書 2章）。 */
export async function insertUser(connection: Sql, userId: string): Promise<void> {
  await connection`insert into auth.users (id) values (${userId})`;
}

/** その識別子の利用者の行数を返す。表全体を数える主張はしない。 */
export async function countUser(connection: Sql, userId: string): Promise<number> {
  const [row] = await connection<{ count: number }[]>`
    select count(*)::int as count from auth.users where id = ${userId}
  `;
  return row?.count ?? 0;
}
