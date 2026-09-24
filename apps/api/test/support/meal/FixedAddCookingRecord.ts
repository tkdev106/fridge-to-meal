import type { AddCookingRecord } from '../../../src/contexts/meal/usecase/AddCookingRecord.js';
import type { MealId } from '../../../src/contexts/meal/domain/value/MealId.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 調理記録を足す口の代役（B-51 2周目 / `docs/testing.md` 4章「ユースケースを差し替える」）。
 *
 * 決まった応答を返し、**受け取った引数を状態として覚える**だけのもの。`vi.fn()` で呼び出しを
 * 数えず、記憶上の実装の状態として観察する（同 2章）。形は先行
 * `support/pantry/FixedStockItemUsecases.ts` の `FixedDeleteStockItem` の写しである。
 *
 * **値を返さない口**なので、成功は印だけを置く（`{ succeeds: true }`）。応答は
 * 「成功の印」か「投げる例外」の**どちらか一方**である — 失敗の写像（B-51 設計書7章）を
 * 確かめるには、ユースケースが投げた先を見る必要があるため。
 *
 * **引数を覚えるのは投げる前**にする（同 2章）— 「どこまで届いたか」を状態として観察できる
 * ようにする。本物のユースケースの型をそのまま名乗るので、**api 層が期待する形が本物と
 * 食い違っていれば型検査で落ちる。**
 */
export type AddCookingRecordResponse = { readonly succeeds: true } | { readonly throws: Error };

export class FixedAddCookingRecord {
  readonly #response: AddCookingRecordResponse;
  readonly #receivedHouseholdIds: HouseholdId[] = [];
  readonly #receivedMealIds: MealId[] = [];
  readonly #receivedCookedAts: string[] = [];

  constructor(response: AddCookingRecordResponse) {
    this.#response = response;
  }

  /** 何度呼ばれたか。**呼ばれないこと**が要件のときに見る（`docs/testing.md` 2章）。 */
  get callCount(): number {
    return this.#receivedHouseholdIds.length;
  }

  /** 最後に渡された第1引数の世帯。まだ一度も呼ばれていなければ `null`（C-9）。 */
  get receivedHouseholdId(): HouseholdId | null {
    return this.#receivedHouseholdIds.at(-1) ?? null;
  }

  /** 最後に渡された第2引数の献立の識別子。 */
  get receivedMealId(): MealId | null {
    return this.#receivedMealIds.at(-1) ?? null;
  }

  /** 最後に渡された第3引数の日時。要求ごとに時計を読むことを2度目の値で観察する。 */
  get receivedCookedAt(): string | null {
    return this.#receivedCookedAts.at(-1) ?? null;
  }

  readonly add: AddCookingRecord = async (householdId, mealId, cookedAt) => {
    // **記録は投げるより先である**（`docs/testing.md` 2章）。
    this.#receivedHouseholdIds.push(householdId);
    this.#receivedMealIds.push(mealId);
    this.#receivedCookedAts.push(cookedAt);

    if ('throws' in this.#response) throw this.#response.throws;
  };
}
