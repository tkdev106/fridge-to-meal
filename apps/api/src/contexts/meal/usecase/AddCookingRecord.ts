import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import { withCookingRecord } from '../domain/entity/Meal.js';
import { MealRuleViolation } from '../domain/error/MealRuleViolation.js';
import type { MealRepository } from '../domain/repository/MealRepository.js';
import { createCookingRecord } from '../domain/value/CookingRecord.js';
import { dateTimeOf } from '../domain/value/DateTime.js';
import type { MealId } from '../domain/value/MealId.js';
import { mealByIdOf } from './MealOutputs.js';

/**
 * 献立1件に調理記録を1件足す（FR-22 / FR-31 / B-51 設計書 5章）。世帯は第1引数で
 * 受け取る（C-9）。
 *
 * 記録の日時は**引数で受け取り、本体では時計を読まない**（B-51 規則4 /
 * `docs/testing.md` 5章）。受け取るのは先行 `SuggestMeals` の `asOf` と同じ素の文字列で、
 * UTC の正準形に正すのは本体である。
 *
 * **在庫を1行も読まず1件も消さない**（C-8 / 規則9）— 依存に在庫の何も取らないことで
 * 型から読める。
 */
export type AddCookingRecord = (
  householdId: HouseholdId,
  mealId: MealId,
  cookedAt: string,
) => Promise<void>;

/**
 * 調理記録を足すユースケースを組み立てる。依存は引数で受け取り、実装の生成は `main.ts` に
 * 任せる（ADR-002）。
 */
export function addCookingRecord(deps: { mealRepository: MealRepository }): AddCookingRecord {
  return async (householdId, mealId, cookedAt) => {
    // 日時を正すのを保存より先に済ませる。断った回に1行も書かれないのはこの順序による
    // （B-51 規則4 / NFR-09 / 先行 `registerStockItem`）。書式の規則は値オブジェクトの
    // 1か所に残し、ここでは持たない。
    const cookedAtDateTime = dateTimeOf(cookedAt);

    // 世帯で引いてから識別子で選ぶ（C-9 / 規則2）。リポジトリの口は足さない。
    const meals = await deps.mealRepository.findByHousehold(householdId);
    const meal = mealByIdOf(meals).get(mealId);
    if (meal === undefined) {
      // 他世帯の献立を指した要求も、同じ規則・同じ文言で断る。識別子や世帯を文面に
      // 書けば「他の世帯には在る」が漏れる（C-9 / NFR-09 / 規則3）。
      throw new MealRuleViolation(
        'addCookingRecord.mealNotFound',
        '指定された献立が見つかりません',
      );
    }

    // 追加は `withCookingRecord` だけを通す（C-3 / 規則5）。名称・材料・手順・生成日時は
    // そのまま引き継がれ、増えるのは末尾の記録1件だけである（規則6・7）。
    await deps.mealRepository.save(
      householdId,
      withCookingRecord(meal, createCookingRecord({ cookedAt: cookedAtDateTime })),
    );
  };
}
