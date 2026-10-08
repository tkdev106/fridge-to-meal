import type { DateTime } from '../value/DateTime.js';
import type { GeneratedMeal } from '../value/GeneratedMeal.js';
import type { PantrySnapshot } from '../value/PantrySnapshot.js';

/**
 * 生成に渡すもの（B-15 5章 / prompt-design 2.1）。
 *
 * 4つの項目を**1つのオブジェクト**で受け取る。位置引数に散らすと、`requiredCount` と
 * 他の値の取り違えを型が止められない（B-15 前提1）。
 *
 * **`householdId` は取らない。** 世帯の識別は生成の関心事ではなく、外へ出すものを最小に
 * する（NFR-11 / prompt-design 2.3）。C-9 が世帯を必須引数にするのは**リポジトリの
 * 全メソッド**であり、永続化を持たないこの出口は対象外である（B-15 規則2）。
 */
export type MealGenerationInput = {
  /** 生成時点の在庫の複製。在庫0件も通る — 呼ぶかどうかを決めるのは呼ぶ側（B-15 規則10）。 */
  readonly pantrySnapshot: PantrySnapshot;
  /**
   * 生成する件数。**`3` に狭めない** — 件数は呼ぶ側の判断として残す（ADR-021 / ADR-022）。
   * 契約は `requiredCount >= 1` を前提とし、値の妥当性はここで検査しない（B-15 規則8）。
   */
  readonly requiredCount: number;
  /**
   * 避けるべき献立の名称。**上限50件をここで検査しない** — 切るのは呼ぶ側である
   * （ADR-021 の結果2 / B-15 規則9）。重複の回避は保証ではなく努力目標。
   */
  readonly avoidTitles: readonly string[];
  /** 期限の残日数を算出する基準日時。現在時刻を読まず、引数で受け取る（docs/testing.md 5章）。 */
  readonly asOf: DateTime;
};

/**
 * 献立を生成する出口（B-15 5章）。
 *
 * 生成の手段は実装（腐敗防止層）に閉じる。ドメイン層はここで「在庫と件数を渡すと
 * 生成結果が1件以上返る、1件も返せなければ投げる」という約束だけを持つ（ADR-002 / ADR-005）。
 *
 * **interface では強制できない約束が4つある。実装ごとにテストで確かめる**
 * （B-15 6章 規則4〜7 / 7章。先行 `StockItemRepository.save` の `save.householdMismatch` と同じ扱い）。
 *
 * - 返す件数は1件以上 `requiredCount` 件以下。多く得られたら先頭から切る
 * - **0件を返さない。** 1件も返せないときは投げる。件数を埋める再生成は契約に入れない
 * - 返す列の並びは**生成側の並びのまま**。並べ替えも優先順位づけも約束しない
 * - 返す列に**同じ `title` を2件以上含めない**（C-13 / prompt-design 6.2）
 *
 * 返すのは `GeneratedMeal` の列であって `Meal` ではない。識別子・世帯・生成日時・由来の
 * 項目を持たず、永続化は呼ぶ側の仕事である（C-1 / ADR-035 / B-15 規則3）。
 */
export interface MealGenerator {
  /**
   * @throws {MealRuleViolation} 在庫に食材が無いと答えたとき（`rule` は `mealGenerator.noIngredient`。ADR-091）
   * @throws {MealRuleViolation} それ以外で1件も返せないとき（`rule` は `mealGenerator.empty`）
   */
  generate(input: MealGenerationInput): Promise<readonly GeneratedMeal[]>;
}
