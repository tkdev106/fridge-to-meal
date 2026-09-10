import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';

/**
 * 接続そのものではなく、**問い合わせを受け付ける口**（B-07 設計 5章）。
 * 接続を作るのはここではない（B-09）。
 */
export type HouseholdDatabase = PostgresJsDatabase;

/**
 * 1つのトランザクションの handle。drizzle の内部型を名指ししないための書き方で、
 * `transaction` の本体が受け取る引数そのものを指す（B-07 設計 5章）。
 */
export type HouseholdTransaction = Parameters<Parameters<HouseholdDatabase['transaction']>[0]>[0];

/**
 * トランザクションを1つ開き、その中で `set local role authenticated` と
 * `request.jwt.claims` を張ってから本体を呼ぶ（B-07 設計 規則2 / ADR-029 決定3(a)・理由(4)）。
 *
 * **`local` を落とさない。** 接続プーラは接続を貸し回すため、セッションに残した設定は
 * 他人のリクエストに漏れる。
 *
 * クレームは `set local … = $1` では張れない（`set local` はパラメータを取れない）ため
 * `select set_config(…, true)` を使う。第3引数の `true` が `local` にあたる。
 * テスト側の写しは `apps/api/test/support/db/WithTransaction.ts`。
 *
 * **クレームは常に張る。** 張らない経路を作らないのは、張り忘れた問い合わせが例外では
 * なく**0行**になるためである（ADR-029 理由(1)）。世帯 ID を `sub` に置くのは ADR-028。
 *
 * 本体が投げた例外は**そのまま伝える**（包み直さない。B-07 設計 7章）。トランザクションは
 * 巻き戻り、その中で書いたものは残らない。
 */
export function withHouseholdTransaction<T>(
  db: HouseholdDatabase,
  householdId: HouseholdId,
  body: (tx: HouseholdTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role authenticated`);

    const クレーム = JSON.stringify({ sub: householdId });
    await tx.execute(sql`select set_config('request.jwt.claims', ${クレーム}, true)`);

    return body(tx);
  });
}
