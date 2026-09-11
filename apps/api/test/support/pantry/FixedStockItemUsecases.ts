import type {
  ListStockItemsOutput,
  RegisterStockItemInput,
  StockItemDto,
  UpdateStockItemInput,
} from '@fridge-to-meal/contract';
import type { DeleteStockItem } from '../../../src/contexts/pantry/usecase/DeleteStockItem.js';
import type { ListStockItems } from '../../../src/contexts/pantry/usecase/ListStockItems.js';
import type { RegisterStockItem } from '../../../src/contexts/pantry/usecase/RegisterStockItem.js';
import type { UpdateStockItem } from '../../../src/contexts/pantry/usecase/UpdateStockItem.js';
import type { StockItemId } from '../../../src/contexts/pantry/domain/value/StockItemId.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 在庫品の4つのユースケースの代役（B-08 設計書 4章 / `docs/testing.md` 4章「ユースケースを差し替える」）。
 *
 * 決まった値を返し、**受け取った引数を状態として覚える**だけのもの。`vi.fn()` で
 * 呼び出しを数えず、記憶上の実装の状態として観察する（同 2章）。先行は
 * `FixedStockItemIdGenerator.ts` と `FixedHouseholdAuthenticator.ts`。
 *
 * 本物のユースケースの型をそのまま名乗るので、**api 層が期待する形が本物と食い違って
 * いれば型検査で落ちる。**
 */
export class 記憶上の在庫品の登録 {
  readonly #返す在庫品: StockItemDto;
  readonly #受け取った世帯たち: HouseholdId[] = [];
  readonly #受け取った入力たち: RegisterStockItemInput[] = [];

  constructor(返す在庫品: StockItemDto) {
    this.#返す在庫品 = 返す在庫品;
  }

  get 呼ばれた回数(): number {
    return this.#受け取った世帯たち.length;
  }

  /** 最後に渡された第1引数の世帯。まだ一度も呼ばれていなければ `null`（C-9）。 */
  get 受け取った世帯(): HouseholdId | null {
    return this.#受け取った世帯たち.at(-1) ?? null;
  }

  /** 最後に渡された第2引数の入力。 */
  get 受け取った入力(): RegisterStockItemInput | null {
    return this.#受け取った入力たち.at(-1) ?? null;
  }

  readonly 登録する: RegisterStockItem = async (householdId, input) => {
    this.#受け取った世帯たち.push(householdId);
    this.#受け取った入力たち.push(input);
    return this.#返す在庫品;
  };
}

export class 記憶上の在庫品の一覧 {
  readonly #返す出力: ListStockItemsOutput;
  readonly #受け取った世帯たち: HouseholdId[] = [];

  constructor(返す出力: ListStockItemsOutput) {
    this.#返す出力 = 返す出力;
  }

  get 呼ばれた回数(): number {
    return this.#受け取った世帯たち.length;
  }

  get 受け取った世帯(): HouseholdId | null {
    return this.#受け取った世帯たち.at(-1) ?? null;
  }

  readonly 一覧する: ListStockItems = async (householdId) => {
    this.#受け取った世帯たち.push(householdId);
    return this.#返す出力;
  };
}

export class 記憶上の在庫品の更新 {
  readonly #返す在庫品: StockItemDto;
  readonly #受け取った世帯たち: HouseholdId[] = [];
  readonly #受け取った識別子たち: StockItemId[] = [];
  readonly #受け取った入力たち: UpdateStockItemInput[] = [];

  constructor(返す在庫品: StockItemDto) {
    this.#返す在庫品 = 返す在庫品;
  }

  get 呼ばれた回数(): number {
    return this.#受け取った世帯たち.length;
  }

  get 受け取った世帯(): HouseholdId | null {
    return this.#受け取った世帯たち.at(-1) ?? null;
  }

  /** 最後に渡された第2引数の在庫品の識別子。 */
  get 受け取った識別子(): StockItemId | null {
    return this.#受け取った識別子たち.at(-1) ?? null;
  }

  /** 最後に渡された第3引数の入力。 */
  get 受け取った入力(): UpdateStockItemInput | null {
    return this.#受け取った入力たち.at(-1) ?? null;
  }

  readonly 更新する: UpdateStockItem = async (householdId, id, input) => {
    this.#受け取った世帯たち.push(householdId);
    this.#受け取った識別子たち.push(id);
    this.#受け取った入力たち.push(input);
    return this.#返す在庫品;
  };
}

export class 記憶上の在庫品の削除 {
  readonly #受け取った世帯たち: HouseholdId[] = [];
  readonly #受け取った識別子たち: StockItemId[] = [];

  get 呼ばれた回数(): number {
    return this.#受け取った世帯たち.length;
  }

  get 受け取った世帯(): HouseholdId | null {
    return this.#受け取った世帯たち.at(-1) ?? null;
  }

  /** 最後に渡された第2引数の在庫品の識別子。 */
  get 受け取った識別子(): StockItemId | null {
    return this.#受け取った識別子たち.at(-1) ?? null;
  }

  readonly 削除する: DeleteStockItem = async (householdId, id) => {
    this.#受け取った世帯たち.push(householdId);
    this.#受け取った識別子たち.push(id);
  };
}
