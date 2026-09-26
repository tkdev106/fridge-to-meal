/**
 * 献立1件の口と調理記録の口（`src/server/MealRequests.ts`）の**記憶上の実装**（B-53。
 * 先行 `FixedSuggestionRequests`）。
 *
 * **`vi.fn()` で呼び出し回数を数えない**（`docs/testing.md` 2章）。テストが観るのは
 * **画面に出ている献立の名称**であり、取りに行ったかどうかの検めは画面の側にある。
 *
 * **受け取った識別子は自分の状態として持つ** — 門が「開かれた献立」をそのまま運ぶことは
 * 画面からは読めないので、ここに記録して観る。
 */

import type {
  AddCookingRecord,
  AddCookingRecordOutcome,
  MealOutcome,
  ShowMeal,
} from '../../../src/server/MealRequests.js';
import type { Delivery } from '../HeldDelivery.js';
import { DeliveryLine, PendingReleases } from '../HeldDelivery.js';

export type FixedMealRequestsOptions = {
  /** 献立1件の結末の台本。**渡さなかったら呼ばれた時点で落ちる**（先行 `FixedSuggestionRequests`）。 */
  readonly show?: readonly Delivery<MealOutcome>[];
  /** 調理記録の結末の台本。同じく渡さなかったら呼ばれた時点で落ちる。 */
  readonly addCookingRecord?: readonly Delivery<AddCookingRecordOutcome>[];
};

export class FixedMealRequests {
  readonly #pending = new PendingReleases();
  readonly #show: DeliveryLine<MealOutcome>;
  readonly #addCookingRecord: DeliveryLine<AddCookingRecordOutcome>;
  readonly #shownMealIds: string[] = [];
  readonly #recordedMealIds: string[] = [];

  constructor(options: FixedMealRequestsOptions = {}) {
    this.#show = new DeliveryLine(
      options.show ?? [],
      this.#pending,
      'この観点では献立1件を取りに行かない',
    );
    this.#addCookingRecord = new DeliveryLine(
      options.addCookingRecord ?? [],
      this.#pending,
      'この観点では調理記録を足さない',
    );
  }

  readonly showMeal: ShowMeal = (mealId) => {
    this.#shownMealIds.push(mealId);

    return this.#show.deliver();
  };

  readonly addCookingRecord: AddCookingRecord = (mealId) => {
    this.#recordedMealIds.push(mealId);

    return this.#addCookingRecord.deliver();
  };

  /** 取りに行った献立の識別子を、取りに行った順に。 */
  get shownMealIds(): readonly string[] {
    return this.#shownMealIds;
  }

  /** 記録を足した献立の識別子を、足した順に。 */
  get recordedMealIds(): readonly string[] {
    return this.#recordedMealIds;
  }

  /** 保留している結末を解く（先行 `FixedSuggestionRequests.settle`）。 */
  settle(): void {
    this.#pending.settle();
  }
}
