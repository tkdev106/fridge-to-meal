/**
 * 保存済みの提案の口（`src/server/SuggestionRequests.ts`）の**記憶上の実装**（B-49a / B-58。
 * 先行 `FixedStockItemRequests`）。
 *
 * **`vi.fn()` で呼び出し回数を数えない**（`docs/testing.md` 2章）。テストが観るのは
 * **画面に出ている献立の名称**であり、取りに行ったかどうかの検めは画面の側にある。
 *
 * **件数（`showCount`）を観てよいのは「取りに行かないこと」が要件のときだけである**
 * （先行 `FixedStockItemRequests.listCount`）。
 */

import type {
  LatestSuggestionOutcome,
  ShowLatestSuggestion,
} from '../../../src/server/SuggestionRequests.js';
import type { Delivery } from '../HeldDelivery.js';
import { DeliveryLine, PendingReleases } from '../HeldDelivery.js';

export type FixedSuggestionRequestsOptions = {
  /** 提案の結末の台本。**渡さなかったら呼ばれた時点で落ちる**（先行 `FixedStockItemRequests`）。 */
  readonly show?: readonly Delivery<LatestSuggestionOutcome>[];
};

export class FixedSuggestionRequests {
  readonly #pending = new PendingReleases();
  readonly #show: DeliveryLine<LatestSuggestionOutcome>;
  #showCount = 0;

  constructor(options: FixedSuggestionRequestsOptions = {}) {
    this.#show = new DeliveryLine(
      options.show ?? [],
      this.#pending,
      'この観点では提案を取りに行かない',
    );
  }

  readonly showLatestSuggestion: ShowLatestSuggestion = () => {
    this.#showCount += 1;

    return this.#show.deliver();
  };

  /** 取りに行った回数。**使いどころは「取りに行かないこと」の観点に限る。** */
  get showCount(): number {
    return this.#showCount;
  }

  /** 保留している結末を解く（先行 `FixedStockItemRequests.settle`）。 */
  settle(): void {
    this.#pending.settle();
  }
}
