/**
 * `/household/*` の口（`src/server/HouseholdRequests.ts`）— 人数・招待の作成・抜ける — の
 * **記憶上の実装**（B-76 設計 4章。先行 `FixedHouseholdDataRequests`）。
 *
 * **`vi.fn()` で呼び出し回数を数えない**（`docs/testing.md` 2章）。送られた回数は自分の状態と
 * して持つ — 招待は押した回に1往復だけ（設計 規則5）、抜けるは確認を経なければ送られず
 * 自分では送り直さない（規則8・9）、人数は設定を開いた回にだけ取りに行く（規則12）ことが
 * 要件そのものであり、それを観るにはこの数が要る。
 */

import type {
  CreateHouseholdInvitation,
  CreateHouseholdInvitationOutcome,
  LeaveHousehold,
  LeaveHouseholdOutcome,
  ShowHouseholdMemberCount,
  ShowHouseholdMemberCountOutcome,
} from '../../../src/server/HouseholdRequests.js';
import type { Delivery } from '../HeldDelivery.js';
import { DeliveryLine, PendingReleases } from '../HeldDelivery.js';

export type FixedHouseholdRequestsOptions = {
  /** 人数の結末の台本。**渡さなかったら呼ばれた時点で落ちる**（先行 `FixedMealRequests`）。 */
  readonly memberCount?: readonly Delivery<ShowHouseholdMemberCountOutcome>[];
  /** 招待の結末の台本。**渡さなかったら呼ばれた時点で落ちる**（先行 `FixedMealRequests`）。 */
  readonly create?: readonly Delivery<CreateHouseholdInvitationOutcome>[];
  /** 抜けるの結末の台本。渡さなかったら呼ばれた時点で落ちる。 */
  readonly leave?: readonly Delivery<LeaveHouseholdOutcome>[];
};

export class FixedHouseholdRequests {
  readonly #pending = new PendingReleases();
  readonly #memberCount: DeliveryLine<ShowHouseholdMemberCountOutcome>;
  readonly #create: DeliveryLine<CreateHouseholdInvitationOutcome>;
  readonly #leave: DeliveryLine<LeaveHouseholdOutcome>;
  #memberCountRequests = 0;
  #createCount = 0;
  #leaveCount = 0;

  constructor(options: FixedHouseholdRequestsOptions = {}) {
    this.#memberCount = new DeliveryLine(
      options.memberCount ?? [],
      this.#pending,
      'この観点では人数を取りに行かない',
    );
    this.#create = new DeliveryLine(
      options.create ?? [],
      this.#pending,
      'この観点では招待を作らない',
    );
    this.#leave = new DeliveryLine(
      options.leave ?? [],
      this.#pending,
      'この観点では冷蔵庫から抜けない',
    );
  }

  readonly showHouseholdMemberCount: ShowHouseholdMemberCount = () => {
    // **数えるのは配るより先である**（`docs/testing.md` 2章）。
    this.#memberCountRequests += 1;

    return this.#memberCount.deliver();
  };

  readonly createHouseholdInvitation: CreateHouseholdInvitation = () => {
    // **数えるのは配るより先である**（`docs/testing.md` 2章）。
    this.#createCount += 1;

    return this.#create.deliver();
  };

  readonly leaveHousehold: LeaveHousehold = () => {
    this.#leaveCount += 1;

    return this.#leave.deliver();
  };

  /** 人数を取りに行った回数。 */
  get memberCountRequests(): number {
    return this.#memberCountRequests;
  }

  /** 招待の作成が送られた回数。 */
  get createCount(): number {
    return this.#createCount;
  }

  /** 抜けるが送られた回数。 */
  get leaveCount(): number {
    return this.#leaveCount;
  }

  /** 保留している結末を解く（先行 `FixedHouseholdDataRequests.settle`）。 */
  settle(): void {
    this.#pending.settle();
  }
}
