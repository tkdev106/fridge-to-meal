import type {
  ListStockItemsOutput,
  RegisterStockItemInput,
  StockItemDto,
  UpdateStockItemInput,
} from '@fridge-to-meal/contract';
import type { DeleteStockItem } from '../../../src/contexts/pantry/usecase/DeleteStockItem.js';
import type { ListStockItems } from '../../../src/contexts/pantry/usecase/ListStockItems.js';
import type { ListSavedStockItemNames } from '../../../src/contexts/pantry/usecase/ListSavedStockItemNames.js';
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
 * 応答は **「返す値」か「投げる例外」のどちらか一方**である（先行は `AuthenticatorResponse`）。
 * 失敗の写像（B-08 7章）を確かめるには、ユースケースが規則違反を投げた先を見る必要があるため。
 * **引数を覚えるのは投げる前**にする — 「どこまで届いたか」を状態として観察できるようにする。
 *
 * 本物のユースケースの型をそのまま名乗るので、**api 層が期待する形が本物と食い違って
 * いれば型検査で落ちる。**
 */
export type StockItemResponse = { readonly returns: StockItemDto } | { readonly throws: Error };

export type ListStockItemsResponse =
  { readonly returns: ListStockItemsOutput } | { readonly throws: Error };

export type ListSavedStockItemNamesResponse =
  { readonly returns: readonly string[] } | { readonly throws: Error };

/** 削除は値を返さないので、成功は印だけを置く。 */
export type DeleteStockItemResponse = { readonly succeeds: true } | { readonly throws: Error };

export class FixedRegisterStockItem {
  readonly #response: StockItemResponse;
  readonly #receivedHouseholdIds: HouseholdId[] = [];
  readonly #receivedInputs: RegisterStockItemInput[] = [];

  constructor(response: StockItemResponse) {
    this.#response = response;
  }

  get callCount(): number {
    return this.#receivedHouseholdIds.length;
  }

  /** 最後に渡された第1引数の世帯。まだ一度も呼ばれていなければ `null`（C-9）。 */
  get receivedHouseholdId(): HouseholdId | null {
    return this.#receivedHouseholdIds.at(-1) ?? null;
  }

  /** 最後に渡された第2引数の入力。 */
  get receivedInput(): RegisterStockItemInput | null {
    return this.#receivedInputs.at(-1) ?? null;
  }

  readonly register: RegisterStockItem = async (householdId, input) => {
    this.#receivedHouseholdIds.push(householdId);
    this.#receivedInputs.push(input);
    if ('throws' in this.#response) throw this.#response.throws;
    return this.#response.returns;
  };
}

export class FixedListStockItems {
  readonly #response: ListStockItemsResponse;
  readonly #receivedHouseholdIds: HouseholdId[] = [];

  constructor(response: ListStockItemsResponse) {
    this.#response = response;
  }

  get callCount(): number {
    return this.#receivedHouseholdIds.length;
  }

  get receivedHouseholdId(): HouseholdId | null {
    return this.#receivedHouseholdIds.at(-1) ?? null;
  }

  readonly list: ListStockItems = async (householdId) => {
    this.#receivedHouseholdIds.push(householdId);
    if ('throws' in this.#response) throw this.#response.throws;
    return this.#response.returns;
  };
}

/** 保存したことのある在庫品の名称の代役（B-50d）。献立側の `ListIngredientNames` が引く。 */
export class FixedListSavedStockItemNames {
  readonly #response: ListSavedStockItemNamesResponse;
  readonly #receivedHouseholdIds: HouseholdId[] = [];

  constructor(response: ListSavedStockItemNamesResponse) {
    this.#response = response;
  }

  get receivedHouseholdId(): HouseholdId | null {
    return this.#receivedHouseholdIds.at(-1) ?? null;
  }

  readonly list: ListSavedStockItemNames = async (householdId) => {
    this.#receivedHouseholdIds.push(householdId);
    if ('throws' in this.#response) throw this.#response.throws;
    return this.#response.returns;
  };
}

export class FixedUpdateStockItem {
  readonly #response: StockItemResponse;
  readonly #receivedHouseholdIds: HouseholdId[] = [];
  readonly #receivedStockItemIds: StockItemId[] = [];
  readonly #receivedInputs: UpdateStockItemInput[] = [];

  constructor(response: StockItemResponse) {
    this.#response = response;
  }

  get callCount(): number {
    return this.#receivedHouseholdIds.length;
  }

  get receivedHouseholdId(): HouseholdId | null {
    return this.#receivedHouseholdIds.at(-1) ?? null;
  }

  /** 最後に渡された第2引数の在庫品の識別子。 */
  get receivedStockItemId(): StockItemId | null {
    return this.#receivedStockItemIds.at(-1) ?? null;
  }

  /** 最後に渡された第3引数の入力。 */
  get receivedInput(): UpdateStockItemInput | null {
    return this.#receivedInputs.at(-1) ?? null;
  }

  readonly update: UpdateStockItem = async (householdId, id, input) => {
    this.#receivedHouseholdIds.push(householdId);
    this.#receivedStockItemIds.push(id);
    this.#receivedInputs.push(input);
    if ('throws' in this.#response) throw this.#response.throws;
    return this.#response.returns;
  };
}

/**
 * 削除だけは**呼ばれるたびに応答を順に返す**（可変長引数）。削除が冪等でないこと
 * （B-08 規則13 / ADR-027）は、同じ在庫品を2度削除して1度目と2度目の違いを見るしか
 * 確かめようがないためである。用意した数より多く呼ばれたら投げる —
 * **足りないまま緑にしない**ため（先行は `FixedHouseholdAuthenticator`）。
 */
export class FixedDeleteStockItem {
  readonly #responses: readonly DeleteStockItemResponse[];
  readonly #receivedHouseholdIds: HouseholdId[] = [];
  readonly #receivedStockItemIds: StockItemId[] = [];

  constructor(...responses: readonly DeleteStockItemResponse[]) {
    this.#responses = responses;
  }

  get callCount(): number {
    return this.#receivedHouseholdIds.length;
  }

  get receivedHouseholdId(): HouseholdId | null {
    return this.#receivedHouseholdIds.at(-1) ?? null;
  }

  /** 最後に渡された第2引数の在庫品の識別子。 */
  get receivedStockItemId(): StockItemId | null {
    return this.#receivedStockItemIds.at(-1) ?? null;
  }

  readonly delete: DeleteStockItem = async (householdId, id) => {
    const response = this.#responses[this.#receivedHouseholdIds.length];
    this.#receivedHouseholdIds.push(householdId);
    this.#receivedStockItemIds.push(id);

    if (response === undefined) {
      throw new Error(`用意した応答が尽きた（用意したのは ${this.#responses.length} 件）`);
    }
    if ('throws' in response) throw response.throws;
  };
}
