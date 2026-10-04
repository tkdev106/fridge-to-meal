import type { Sql, TransactionSql } from 'postgres';

/**
 * ローカルの `household_invitations` に招待の行を置き、その期限を読む道具（B-74 設計 4章 /
 * ADR-087 決定3・4）。先行は `HouseholdMembers.ts`。
 *
 * **役を切り替える前の `authenticator` で呼ぶ。** `anon` / `authenticated` には招待の表の権限が無い
 * （ADR-087 決定3）。`authenticator` への `insert` と `select` はテストだけの権限で、
 * `ApplyMigrations.ts` が与える。所有者（`postgres`）では繋がない（B-07d 規則3）。
 *
 * 期限はデータベースの `now()` からの間隔で渡す — テストが現在時刻を読まないため
 * （`docs/testing.md` 5章）。トランザクションの中で呼べば、`now()` はその開始の時刻である。
 * 置いた行は消さない — 後片付けはせず、トークンをケースごとに固有にする。
 */

export type HouseholdInvitationProps = {
  readonly token: string;
  readonly householdId: string;
  /** 期限の `now()` からの間隔（`'1 hour'` / `'-1 minute'` / `'0'`）。 */
  readonly expiresIn: string;
};

/** 招待の行を1行置く。 */
export async function insertHouseholdInvitation(
  connection: Sql | TransactionSql,
  invitation: HouseholdInvitationProps,
): Promise<void> {
  await connection`
    insert into household_invitations (token, household_id, expires_at)
    values (
      ${invitation.token},
      ${invitation.householdId},
      now() + ${invitation.expiresIn}::interval
    )
  `;
}

/**
 * そのトークンの招待の、`now()` から期限までの間隔を秒数で返す。
 * 行が無ければ null。
 */
export async function selectExpiresIn(
  connection: Sql | TransactionSql,
  token: string,
): Promise<number | null> {
  const [row] = await connection<{ expires_in: number }[]>`
    select extract(epoch from expires_at - now())::integer as expires_in
    from household_invitations
    where token = ${token}
  `;
  return row?.expires_in ?? null;
}
