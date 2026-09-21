import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * 接続そのものではなく、**問い合わせを受け付ける口**（B-44 設計 5章）。
 * 接続を作るのはここではない。
 *
 * **型2つだけを置く**（B-44 設計 9章）。`withHouseholdTransaction` の本体
 * （`set local role` とクレームの規則）は**写さない** — 1つの規則を2つに割らないためで、
 * 本体は `contexts/pantry/infrastructure/db/HouseholdTransaction.ts` にある。
 * B-17 で `shared/` に寄ったら、この写しは消える。
 */
export type HouseholdDatabase = PostgresJsDatabase;

/**
 * 1つのトランザクションの handle。drizzle の内部型を名指ししないための書き方で、
 * `transaction` の本体が受け取る引数そのものを指す（B-44 設計 5章）。
 */
export type HouseholdTransaction = Parameters<Parameters<HouseholdDatabase['transaction']>[0]>[0];
