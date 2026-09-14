import type { Sql, TransactionSql } from 'postgres';

/**
 * 3点セット(a) のテスト側の写し（ADR-029 決定3(a)・理由(4) / B-07d 設計 規則6）。
 *
 * トランザクションを1つ張り、その中で `set local role authenticated` に切り替える。
 * 世帯 ID を渡したときだけ `request.jwt.claims` を張る。**`local` を落とさない** —
 * 接続プーラは接続を貸し回すため、セッションに残した設定は他人のリクエストに漏れる。
 *
 * クレームは `set local … = $1` ではなく `select set_config(…, true)` で張る
 * （`set local` はパラメータを取れない）。
 *
 * @param householdId `null` なら**クレームを張らない**（張らなければ何が見えるかを確かめるため）。
 */
export function withTransaction<T>(
  connection: Sql,
  householdId: string | null,
  body: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return connection.begin(async (tx) => {
    await tx`set local role authenticated`;

    if (householdId !== null) {
      const claims = JSON.stringify({ sub: householdId });
      await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    }

    return body(tx);
  }) as Promise<T>;
}
