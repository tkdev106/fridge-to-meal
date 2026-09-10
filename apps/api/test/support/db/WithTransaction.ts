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
 * @param 世帯id `null` なら**クレームを張らない**（張らなければ何が見えるかを確かめるため）。
 */
export function トランザクションを張る<T>(
  接続: Sql,
  世帯id: string | null,
  本体: (問い合わせ: TransactionSql) => Promise<T>,
): Promise<T> {
  return 接続.begin(async (問い合わせ) => {
    await 問い合わせ`set local role authenticated`;

    if (世帯id !== null) {
      const クレーム = JSON.stringify({ sub: 世帯id });
      await 問い合わせ`select set_config('request.jwt.claims', ${クレーム}, true)`;
    }

    return 本体(問い合わせ);
  }) as Promise<T>;
}
