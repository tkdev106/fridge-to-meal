import type { ListIngredientNamesOutput } from '@fridge-to-meal/contract';
import type { ListIngredientNames } from '../../../src/contexts/meal/usecase/ListIngredientNames.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 食材名を集める口の代役（B-50b / `docs/testing.md` 4章「ユースケースを差し替える」）。
 *
 * 決まった応答を返し、**受け取った世帯を状態として覚える**だけのもの。`vi.fn()` で呼び出しを
 * 数えず、記憶上の実装の状態として観察する（同 2章）。形は `FixedSuggestMeals.ts` の
 * `FixedShowLatestSuggestion` の写しである。
 *
 * 応答は **「返す値」か「投げる例外」のどちらか一方**。失敗の写像（B-50b 7章）を確かめるには
 * ユースケースが投げた先を見る必要があるため。**記録は投げるより先**にする。
 *
 * **基準日時を覚える口が無い。** このユースケースは第2引数を取らない — 時刻に依存する判断を
 * 1つも持たないためであり、**代役の形がそれをそのまま写している。**
 */
export type ListIngredientNamesResponse =
  { readonly returns: ListIngredientNamesOutput } | { readonly throws: Error };

export class FixedListIngredientNames {
  readonly #response: ListIngredientNamesResponse;
  readonly #householdIds: HouseholdId[] = [];

  constructor(response: ListIngredientNamesResponse) {
    this.#response = response;
  }

  /** 何度呼ばれたか。**呼ばれないこと**が要件のときに見る（`docs/testing.md` 2章）。 */
  get callCount(): number {
    return this.#householdIds.length;
  }

  /** 最後に渡された第1引数の世帯。まだ一度も呼ばれていなければ `null`（C-9）。 */
  get receivedHouseholdId(): HouseholdId | null {
    return this.#householdIds.at(-1) ?? null;
  }

  readonly list: ListIngredientNames = async (householdId) => {
    // **記録は投げるより先である**（`docs/testing.md` 2章）。
    this.#householdIds.push(householdId);
    if ('throws' in this.#response) throw this.#response.throws;
    return this.#response.returns;
  };
}
