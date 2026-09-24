/**
 * 食材名の口（`src/server/IngredientNameRequests.ts`）の**記憶上の実装**（B-50c。
 * 先行 `FixedSuggestionRequests`）。
 *
 * **`vi.fn()` で呼び出し回数を数えない**（`docs/testing.md` 2章）。テストが観るのは
 * **補完に出ている名称**であり、取りに行ったかどうかの検めは画面の側にある。
 *
 * **件数（`listCount`）を観てよいのは「取りに行かないこと」が要件のときだけである**
 * （先行 `FixedStockItemRequests.listCount`）。
 */

import type {
  IngredientNamesOutcome,
  ListIngredientNames,
} from '../../../src/server/IngredientNameRequests.js';
import type { Delivery } from '../HeldDelivery.js';
import { DeliveryLine, PendingReleases } from '../HeldDelivery.js';

export type FixedIngredientNameRequestsOptions = {
  /** 食材名の結末の台本。**渡さなかったら呼ばれた時点で落ちる**（先行 `FixedSuggestionRequests`）。 */
  readonly list?: readonly Delivery<IngredientNamesOutcome>[];
};

export class FixedIngredientNameRequests {
  readonly #pending = new PendingReleases();
  readonly #list: DeliveryLine<IngredientNamesOutcome>;
  #listCount = 0;

  constructor(options: FixedIngredientNameRequestsOptions = {}) {
    this.#list = new DeliveryLine(
      options.list ?? [],
      this.#pending,
      'この観点では食材名を取りに行かない',
    );
  }

  readonly listIngredientNames: ListIngredientNames = () => {
    this.#listCount += 1;

    return this.#list.deliver();
  };

  /** 取りに行った回数。**使いどころは「取りに行かないこと」の観点に限る。** */
  get listCount(): number {
    return this.#listCount;
  }

  /** 保留している結末を解く（先行 `FixedSuggestionRequests.settle`）。 */
  settle(): void {
    this.#pending.settle();
  }
}
