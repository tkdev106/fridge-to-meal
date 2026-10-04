import type { Sql } from 'postgres';

/**
 * ローカルの `household_members` に参加の行（利用者 → 世帯）を置く道具（B-73 設計 4章 /
 * ADR-087 決定1）。先行は `AuthUsers.ts`。
 *
 * **役を切り替える前の `authenticator` で呼ぶ。** `anon` / `authenticated` には2表の権限が無い
 * （ADR-087 決定3）。`authenticator` への `insert` はテストだけの権限で、`ApplyMigrations.ts` が
 * 与える。所有者（`postgres`）では繋がない（B-07d 規則3）。
 *
 * `user_id` は `auth.users` を指すので、**先に `insertUser` で利用者を置く。**
 * 置いた行は消さない — 後片付けはせず、識別子をケースごとに固有にする。
 */

export type HouseholdMemberProps = {
  readonly userId: string;
  readonly householdId: string;
};

/** 参加の行を1行置く。 */
export async function insertHouseholdMember(
  connection: Sql,
  member: HouseholdMemberProps,
): Promise<void> {
  await connection`
    insert into household_members (user_id, household_id)
    values (${member.userId}, ${member.householdId})
  `;
}
