import type { DeleteHouseholdData } from '../../../src/contexts/meal/usecase/DeleteHouseholdData.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 世帯のデータを消す口の代役（B-56a 3周目 / `docs/testing.md` 4章「ユースケースを差し替える」）。
 *
 * 決まった応答を返し、**受け取った世帯を状態として覚える**だけのもの。`vi.fn()` で呼び出しを
 * 数えず、記憶上の実装の状態として観察する（同 2章）。形は先行 `FixedAddCookingRecord` の写しである。
 *
 * **値を返さない口**なので、成功は印だけを置く（`{ succeeds: true }`）。応答は
 * 「成功の印」か「投げる例外」の**どちらか一方**である — 失敗の写像（B-56a 設計書7章）を
 * 確かめるには、ユースケースが投げた先を見る必要があるため。
 *
 * **世帯を覚えるのは投げる前**にする（同 2章）。本物のユースケースの型をそのまま名乗るので、
 * **api 層が期待する形が本物と食い違っていれば型検査で落ちる。**
 */
export type DeleteHouseholdDataResponse = { readonly succeeds: true } | { readonly throws: Error };

export class FixedDeleteHouseholdData {
  readonly #response: DeleteHouseholdDataResponse;
  readonly #receivedHouseholdIds: HouseholdId[] = [];

  constructor(response: DeleteHouseholdDataResponse) {
    this.#response = response;
  }

  /** 最後に渡された世帯。まだ一度も呼ばれていなければ `null`（C-9）。 */
  get receivedHouseholdId(): HouseholdId | null {
    return this.#receivedHouseholdIds.at(-1) ?? null;
  }

  readonly delete: DeleteHouseholdData = async (householdId) => {
    // **記録は投げるより先である**（`docs/testing.md` 2章）。
    this.#receivedHouseholdIds.push(householdId);

    if ('throws' in this.#response) throw this.#response.throws;
  };
}
