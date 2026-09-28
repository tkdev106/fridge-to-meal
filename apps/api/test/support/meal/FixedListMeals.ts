import type { ListMealsOutput } from '@fridge-to-meal/contract';
import type { ListMeals } from '../../../src/contexts/meal/usecase/ListMeals.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 献立の一覧を返す口の代役（B-54a / `docs/testing.md` 4章「ユースケースを差し替える」）。
 *
 * 決まった応答を返し、**受け取った引数を状態として覚える**だけのもの。`vi.fn()` で呼び出しを
 * 数えず、記憶上の実装の状態として観察する（同 2章）。形は先行
 * `support/meal/FixedShowMeal.ts` の写しである。
 *
 * 応答は「返す値」か「投げる例外」の**どちらか一方**である — 失敗の写像（B-54 設計書7章）を
 * 確かめるには、ユースケースが投げた先を見る必要があるため。
 *
 * **引数を覚えるのは投げる前**にする（同 2章）。本物のユースケースの型をそのまま名乗るので、
 * **api 層が期待する形が本物と食い違っていれば型検査で落ちる。**
 */
export type ListMealsResponse = { readonly returns: ListMealsOutput } | { readonly throws: Error };

export class FixedListMeals {
  readonly #response: ListMealsResponse;
  readonly #receivedHouseholdIds: HouseholdId[] = [];

  constructor(response: ListMealsResponse) {
    this.#response = response;
  }

  /** 何度呼ばれたか。**呼ばれないこと**が要件のときに見る（`docs/testing.md` 2章）。 */
  get callCount(): number {
    return this.#receivedHouseholdIds.length;
  }

  /** 最後に渡された世帯。まだ一度も呼ばれていなければ `null`（C-9）。 */
  get receivedHouseholdId(): HouseholdId | null {
    return this.#receivedHouseholdIds.at(-1) ?? null;
  }

  readonly list: ListMeals = async (householdId) => {
    // **記録は投げるより先である**（`docs/testing.md` 2章）。
    this.#receivedHouseholdIds.push(householdId);

    if ('throws' in this.#response) throw this.#response.throws;
    return this.#response.returns;
  };
}
