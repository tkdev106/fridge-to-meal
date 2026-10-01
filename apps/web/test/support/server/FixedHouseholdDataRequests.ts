/**
 * 世帯のデータを消す口（`src/server/HouseholdDataRequests.ts`）の**記憶上の実装**（B-56f。
 * 先行 `FixedMealRequests`）。
 *
 * **`vi.fn()` で呼び出し回数を数えない**（`docs/testing.md` 2章）。送られた回数は自分の状態と
 * して持つ — **削除は確認を経なければ送られない**（設計 規則4・5）ことが要件そのものであり、
 * 「送られないこと」を観るにはこの数が要る。
 */

import type {
  DeleteHouseholdData,
  DeleteHouseholdDataOutcome,
} from '../../../src/server/HouseholdDataRequests.js';
import type { Delivery } from '../HeldDelivery.js';
import { DeliveryLine, PendingReleases } from '../HeldDelivery.js';

export type FixedHouseholdDataRequestsOptions = {
  /** 削除の結末の台本。**渡さなかったら呼ばれた時点で落ちる**（先行 `FixedMealRequests`）。 */
  readonly delete?: readonly Delivery<DeleteHouseholdDataOutcome>[];
};

export class FixedHouseholdDataRequests {
  readonly #pending = new PendingReleases();
  readonly #delete: DeliveryLine<DeleteHouseholdDataOutcome>;
  #deleteCount = 0;

  constructor(options: FixedHouseholdDataRequestsOptions = {}) {
    this.#delete = new DeliveryLine(
      options.delete ?? [],
      this.#pending,
      'この観点では世帯のデータを消さない',
    );
  }

  readonly deleteHouseholdData: DeleteHouseholdData = () => {
    // **数えるのは配るより先である**（`docs/testing.md` 2章）。
    this.#deleteCount += 1;

    return this.#delete.deliver();
  };

  /** 削除が送られた回数。 */
  get deleteCount(): number {
    return this.#deleteCount;
  }

  /** 保留している結末を解く（先行 `FixedMealRequests.settle`）。 */
  settle(): void {
    this.#pending.settle();
  }
}
