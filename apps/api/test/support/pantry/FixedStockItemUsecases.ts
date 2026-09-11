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
 * 決まった応答を返し、**受け取った引数を状態として覚える**だけのもの。`vi.fn()` で
 * 呼び出しを数えず、記憶上の実装の状態として観察する（同 2章）。先行は
 * `FixedStockItemIdGenerator.ts` と `FixedHouseholdAuthenticator.ts`。
 *
 * 応答は **「返す値」か「投げる例外」のどちらか一方**である（先行は `認証器の応答`）。
 * 失敗の写像（B-08 7章）を確かめるには、ユースケースが規則違反を投げた先を見る必要があるため。
 * **引数を覚えるのは投げる前**にする — 「どこまで届いたか」を状態として観察できるようにする。
 *
 * 本物のユースケースの型をそのまま名乗るので、**api 層が期待する形が本物と食い違って
 * いれば型検査で落ちる。**
 */
export type 在庫品の応答 = { readonly 返す在庫品: StockItemDto } | { readonly 投げる例外: Error };

export type 一覧の応答 =
  { readonly 返す出力: ListStockItemsOutput } | { readonly 投げる例外: Error };

/** 削除は値を返さないので、成功は印だけを置く。 */
export type 削除の応答 = { readonly 成功: true } | { readonly 投げる例外: Error };

export class 記憶上の在庫品の登録 {
  readonly #応答: 在庫品の応答;
  readonly #受け取った世帯たち: HouseholdId[] = [];
  readonly #受け取った入力たち: RegisterStockItemInput[] = [];

  constructor(応答: 在庫品の応答) {
    this.#応答 = 応答;
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
    if ('投げる例外' in this.#応答) throw this.#応答.投げる例外;
    return this.#応答.返す在庫品;
  };
}

export class 記憶上の在庫品の一覧 {
  readonly #応答: 一覧の応答;
  readonly #受け取った世帯たち: HouseholdId[] = [];

  constructor(応答: 一覧の応答) {
    this.#応答 = 応答;
  }

  get 呼ばれた回数(): number {
    return this.#受け取った世帯たち.length;
  }

  get 受け取った世帯(): HouseholdId | null {
    return this.#受け取った世帯たち.at(-1) ?? null;
  }

  readonly 一覧する: ListStockItems = async (householdId) => {
    this.#受け取った世帯たち.push(householdId);
    if ('投げる例外' in this.#応答) throw this.#応答.投げる例外;
    return this.#応答.返す出力;
  };
}

export class 記憶上の在庫品の更新 {
  readonly #応答: 在庫品の応答;
  readonly #受け取った世帯たち: HouseholdId[] = [];
  readonly #受け取った識別子たち: StockItemId[] = [];
  readonly #受け取った入力たち: UpdateStockItemInput[] = [];

  constructor(応答: 在庫品の応答) {
    this.#応答 = 応答;
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
    if ('投げる例外' in this.#応答) throw this.#応答.投げる例外;
    return this.#応答.返す在庫品;
  };
}

/**
 * 削除だけは**呼ばれるたびに応答を順に返す**（可変長引数）。削除が冪等でないこと
 * （B-08 規則13 / ADR-027）は、同じ在庫品を2度削除して1度目と2度目の違いを見るしか
 * 確かめようがないためである。用意した数より多く呼ばれたら投げる —
 * **足りないまま緑にしない**ため（先行は `記憶上の世帯認証器`）。
 */
export class 記憶上の在庫品の削除 {
  readonly #応答たち: readonly 削除の応答[];
  readonly #受け取った世帯たち: HouseholdId[] = [];
  readonly #受け取った識別子たち: StockItemId[] = [];

  constructor(...応答たち: readonly 削除の応答[]) {
    this.#応答たち = 応答たち;
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

  readonly 削除する: DeleteStockItem = async (householdId, id) => {
    const 応答 = this.#応答たち[this.#受け取った世帯たち.length];
    this.#受け取った世帯たち.push(householdId);
    this.#受け取った識別子たち.push(id);

    if (応答 === undefined) {
      throw new Error(`用意した応答が尽きた（用意したのは ${this.#応答たち.length} 件）`);
    }
    if ('投げる例外' in 応答) throw 応答.投げる例外;
  };
}
