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
 */
export function withHouseholdTransaction<T>(
  _db: HouseholdDatabase,
  _householdId: HouseholdId,
  _body: (tx: HouseholdTransaction) => Promise<T>,
): Promise<T> {
  throw new Error('未実装');
}
