import type { ShowLatestSuggestionOutput, SuggestMealsOutput } from '@fridge-to-meal/contract';
import type {
  SuggestMeals,
  SuggestNewMeals,
} from '../../../src/contexts/meal/usecase/SuggestMeals.js';
import type { ShowLatestSuggestion } from '../../../src/contexts/meal/usecase/ShowLatestSuggestion.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 提案の2つの入口の代役（B-48b 設計書 4章 / `docs/testing.md` 4章「ユースケースを差し替える」）。
 *
 * 決まった応答を返し、**受け取った世帯と基準日時を状態として覚える**だけのもの。`vi.fn()` で
 * 呼び出しを数えず、記憶上の実装の状態として観察する（同 2章）。形は
 * `test/support/pantry/FixedStockItemUsecases.ts` の写しである。
 *
 * 応答は **「返す値」か「投げる例外」のどちらか一方**。失敗の写像（B-48b 7章）を確かめるには、
 * ユースケースが投げた先を見る必要があるため。**引数を覚えるのは投げる前**にする。
 *
 * 2つの入口は型として同じ形だが、**別のクラスに分ける** — 経路が取り違えていないこと
 * （ADR-051 決定2）を、どちらの代役が呼ばれたかとして観察するため。
 */
export type SuggestMealsResponse =
  { readonly returns: SuggestMealsOutput } | { readonly throws: Error };

/** 2つの代役が共有する記憶。受け取った引数を呼ばれた順に持つ。 */
class ReceivedArguments {
  readonly #householdIds: HouseholdId[] = [];
  readonly #asOfs: string[] = [];

  record(householdId: HouseholdId, asOf: string): void {
    this.#householdIds.push(householdId);
    this.#asOfs.push(asOf);
  }

  get callCount(): number {
    return this.#householdIds.length;
  }

  get lastHouseholdId(): HouseholdId | null {
    return this.#householdIds.at(-1) ?? null;
  }

  get lastAsOf(): string | null {
    return this.#asOfs.at(-1) ?? null;
  }
}

export class FixedSuggestMeals {
  readonly #response: SuggestMealsResponse;
  readonly #received = new ReceivedArguments();

  constructor(response: SuggestMealsResponse) {
    this.#response = response;
  }

  /** 何度呼ばれたか。**呼ばれないこと**が要件のときに見る（`docs/testing.md` 2章）。 */
  get callCount(): number {
    return this.#received.callCount;
  }

  /** 最後に渡された第1引数の世帯。まだ一度も呼ばれていなければ `null`（C-9）。 */
  get receivedHouseholdId(): HouseholdId | null {
    return this.#received.lastHouseholdId;
  }

  /** 最後に渡された第2引数の基準日時。まだ一度も呼ばれていなければ `null`。 */
  get receivedAsOf(): string | null {
    return this.#received.lastAsOf;
  }

  readonly suggest: SuggestMeals = async (householdId, asOf) => {
    this.#received.record(householdId, asOf);
    if ('throws' in this.#response) throw this.#response.throws;
    return this.#response.returns;
  };
}

export class FixedSuggestNewMeals {
  readonly #response: SuggestMealsResponse;
  readonly #received = new ReceivedArguments();

  constructor(response: SuggestMealsResponse) {
    this.#response = response;
  }

  get callCount(): number {
    return this.#received.callCount;
  }

  get receivedHouseholdId(): HouseholdId | null {
    return this.#received.lastHouseholdId;
  }

  get receivedAsOf(): string | null {
    return this.#received.lastAsOf;
  }

  readonly suggest: SuggestNewMeals = async (householdId, asOf) => {
    this.#received.record(householdId, asOf);
    if ('throws' in this.#response) throw this.#response.throws;
    return this.#response.returns;
  };
}

/**
 * 保存済みの提案を読み取り専用で返す口の代役（B-58）。
 *
 * **上の2つと別のクラスに分ける** — 経路が取り違えていないことを、どちらの代役が呼ばれたかと
 * して観察するためである（同じ理由で `FixedSuggestMeals` と `FixedSuggestNewMeals` も分かれている）。
 *
 * **基準日時を覚える口が無い。** このユースケースは第2引数を取らない — 時刻に依存する判断を
 * 1つも持たないためであり、**代役の形がそれをそのまま写している。**
 */
export type ShowLatestSuggestionResponse =
  { readonly returns: ShowLatestSuggestionOutput } | { readonly throws: Error };

export class FixedShowLatestSuggestion {
  readonly #response: ShowLatestSuggestionResponse;
  readonly #householdIds: HouseholdId[] = [];

  constructor(response: ShowLatestSuggestionResponse) {
    this.#response = response;
  }

  /** 何度呼ばれたか。**呼ばれないこと**が要件のときに見る（`docs/testing.md` 2章）。 */
  get callCount(): number {
    return this.#householdIds.length;
  }

  /** 最後に渡された第1引数の世帯。まだ一度も呼ばれていなければ `null`（C-9）。 */
  get receivedHouseholdId(): HouseholdId | null {
    return this.#householdIds.at(-1) ?? null;
  }

  readonly show: ShowLatestSuggestion = async (householdId) => {
    // **記録は投げるより先である**（`docs/testing.md` 2章）。
    this.#householdIds.push(householdId);
    if ('throws' in this.#response) throw this.#response.throws;
    return this.#response.returns;
  };
}
