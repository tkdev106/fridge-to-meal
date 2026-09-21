/**
 * 在庫の3つの口（`src/server/StockItemRequests.ts`）の**記憶上の実装**（B-40 設計 4章 / 5章 /
 * 6章 規則5）。
 *
 * **`vi.fn()` で呼び出し回数を数えない**（`docs/testing.md` 2章）。送られた入力と識別子は
 * 自分の状態として持ち、テストが観るのは**画面に出ている在庫品の名称**である（設計 6章 規則6）
 * — 取り直したかどうかの検めは画面の側にある。
 *
 * **件数（`listCount`）を観てよいのは「取りに行かないこと」が要件の1件だけである**（同 規則6）。
 */

import type { RegisterStockItemInput } from '@fridge-to-meal/contract';
import type {
  DeleteStockItem,
  DeleteStockItemOutcome,
  ListStockItems,
  RegisterStockItem,
  RegisterStockItemOutcome,
  StockItemsOutcome,
} from '../../../src/server/StockItemRequests.js';
import type { Delivery } from '../HeldDelivery.js';
import { DeliveryLine, PendingReleases } from '../HeldDelivery.js';

export type FixedStockItemRequestsOptions = {
  /** 読み込みの結末の台本。**渡さなかった口は呼ばれたら落ちる**（設計 7章 行1）。 */
  readonly list?: readonly Delivery<StockItemsOutcome>[];
  /** 登録の結末の台本。同上。 */
  readonly register?: readonly Delivery<RegisterStockItemOutcome>[];
  /** 削除の結末の台本。同上。 */
  readonly remove?: readonly Delivery<DeleteStockItemOutcome>[];
};

export class FixedStockItemRequests {
  readonly #pending = new PendingReleases();
  readonly #list: DeliveryLine<StockItemsOutcome>;
  readonly #register: DeliveryLine<RegisterStockItemOutcome>;
  readonly #remove: DeliveryLine<DeleteStockItemOutcome>;
  readonly #registeredInputs: RegisterStockItemInput[] = [];
  readonly #deletedIds: string[] = [];
  #listCount = 0;

  constructor(options: FixedStockItemRequestsOptions = {}) {
    this.#list = new DeliveryLine(
      options.list ?? [],
      this.#pending,
      'この観点では在庫一覧を取りに行かない',
    );
    this.#register = new DeliveryLine(
      options.register ?? [],
      this.#pending,
      'この観点では登録を呼ばない',
    );
    this.#remove = new DeliveryLine(
      options.remove ?? [],
      this.#pending,
      'この観点では削除を呼ばない',
    );
  }

  readonly listStockItems: ListStockItems = () => {
    this.#listCount += 1;

    return this.#list.deliver();
  };

  readonly registerStockItem: RegisterStockItem = (input) => {
    this.#registeredInputs.push(input);

    return this.#register.deliver();
  };

  readonly deleteStockItem: DeleteStockItem = (id) => {
    this.#deletedIds.push(id);

    return this.#remove.deliver();
  };

  /** 取りに行った回数。**使いどころは設計 6章 規則6 の1件に限る。** */
  get listCount(): number {
    return this.#listCount;
  }

  /** 登録の口へ届いた入力を、届いた順に。**詰め替えずそのまま持つ。** */
  get registeredInputs(): readonly RegisterStockItemInput[] {
    return this.#registeredInputs;
  }

  /** 削除の口へ届いた識別子を、届いた順に。 */
  get deletedIds(): readonly string[] {
    return this.#deletedIds;
  }

  /** 保留している結末を解く（設計 6章 規則7）。 */
  settle(): void {
    this.#pending.settle();
  }
}
