import type { Suggestion } from '../../../src/contexts/meal/domain/entity/Suggestion.js';
import type { SuggestionRepository } from '../../../src/contexts/meal/domain/repository/SuggestionRepository.js';
import { MealRuleViolation } from '../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 記憶の上だけで動く提案リポジトリ（B-27 設計書 8章）。先行は `InMemoryStockItemRepository.ts`。
 *
 * **interface では強制できない約束2つを、実装として持つのはここである**（B-27 5章 / 10章）。
 *
 * - `findRecentByHousehold` は生成日時の新しい順に最大 `limit` 件を返す。同じ生成日時は
 *   `SuggestionId` の降順で閉じる（C-11 の除外が同時刻の提案でぶれないため）
 * - `save` は引数の世帯と提案の世帯が食い違えば拒む（C-9 / 先行 `save.householdMismatch`）
 *
 * 同じ識別子の提案でも置き換えない。提案は生成後に不変で（C-3 と同じ筋）、同じ識別子が
 * 2度発行されるのは発行器の誤りである。
 */
export class 記憶上の提案リポジトリ implements SuggestionRepository {
  readonly #保存済み: Suggestion[] = [];
  readonly #直近の取得が投げる例外: Error | null;

  /**
   * `直近の取得が投げる例外` を渡すと、`findRecentByHousehold` は保存済みを返さずに
   * それを投げる。**取得の失敗を握りつぶさず呼び出し側へ伝えること**（B-27 7章2行目）を
   * 確かめるための口である。省略すれば保存済みを返す（既定の振る舞い）。
   */
  constructor(props: { 直近の取得が投げる例外?: Error } = {}) {
    this.#直近の取得が投げる例外 = props.直近の取得が投げる例外 ?? null;
  }

  async findRecentByHousehold(householdId: HouseholdId, limit: number): Promise<Suggestion[]> {
    if (this.#直近の取得が投げる例外 !== null) throw this.#直近の取得が投げる例外;

    // 濾した結果は新しい配列なので、並べ替えても保存済みの並びは動かない。
    return this.#保存済み
      .filter((提案) => 提案.householdId === householdId)
      .sort(新しい順)
      .slice(0, limit);
  }

  async save(householdId: HouseholdId, suggestion: Suggestion): Promise<void> {
    if (suggestion.householdId !== householdId) {
      // 世帯が違えば保存を拒む。ここを緩めると世帯分離が破れる（C-9）。
      throw new MealRuleViolation(
        'save.householdMismatch',
        '引数の世帯と提案の世帯が食い違っている',
      );
    }
    this.#保存済み.push(suggestion);
  }
}

/** 生成日時の新しい順。同じ生成日時は `SuggestionId` の降順で閉じる（B-27 10章）。 */
function 新しい順(左: Suggestion, 右: Suggestion): number {
  // `DateTime` は UTC の正準形なので、文字列の大小がそのまま時刻の順になる。
  const 生成日時の差 = コード単位で比べる(右.generatedAt, 左.generatedAt);
  if (生成日時の差 !== 0) return 生成日時の差;

  return コード単位で比べる(右.id, 左.id);
}

/** コード単位の大小で比べる（照合順序が実行環境の ICU に依らないようにする）。 */
function コード単位で比べる(左: string, 右: string): number {
  if (左 < 右) return -1;
  if (左 > 右) return 1;
  return 0;
}
