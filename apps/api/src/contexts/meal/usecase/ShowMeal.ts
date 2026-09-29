import type { ShowMealOutput } from '@fridge-to-meal/contract';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { ListStockItems } from '../../pantry/usecase/ListStockItems.js';
import type { MealRepository } from '../domain/repository/MealRepository.js';
import { MealRuleViolation } from '../domain/error/MealRuleViolation.js';
import { earliestExpiryDateByName } from '../domain/service/EarliestExpiryDates.js';
import type { MealId } from '../domain/value/MealId.js';
import { mealOutputOf, toMealStockItem } from './MealOutputs.js';

/**
 * 献立1件を、**現在の在庫での充足つき**で返す（B-52 / FR-30 / FR-32 / ADR-009）。
 * 世帯は第1引数で受け取る（C-9）。
 *
 * **基準日時を受け取らない**（B-52 規則11 / 先行 ADR-065 理由(4)）— 時刻に依存する判断が
 * 1つも無く、期限は日付のまま載せる。
 *
 * **在庫を1件も変えない**（C-8 / 規則10）— 依存に在庫の書き込みの口を取らないことで
 * 型から読める。
 *
 * **調理記録の有無 `cooked` を載せる**（B-53b / ADR-070）— 充足と同じく開いた時点の事実である。
 */
export type ShowMeal = (householdId: HouseholdId, mealId: MealId) => Promise<ShowMealOutput>;

/**
 * 献立詳細のユースケースを組み立てる。依存は引数で受け取り、実装の生成は `main.ts` に
 * 任せる（ADR-002）。
 */
export function showMeal(deps: {
  listStockItems: ListStockItems;
  mealRepository: MealRepository;
}): ShowMeal {
  return async (householdId, mealId) => {
    // **最初に引くのが献立である**（規則3 / 先行 `ShowLatestSuggestion` が提案を先に引く）—
    // 引けなければ在庫を1行も読まずに終える。
    const meal = await deps.mealRepository.findById(householdId, mealId);
    if (meal === null) {
      // **他世帯の献立を指した回も同じ規則・同じ文言である**（規則2 / C-9 / NFR-09）—
      // 区別して返すと、識別子を総当たりする者に他世帯の献立の存在が漏れる。
      // **識別子も世帯も文面に出さない**（ADR-045 決定3 / 先行 `addCookingRecord.mealNotFound`）。
      throw new MealRuleViolation('showMeal.mealNotFound', '指定された献立が見つかりません');
    }

    // 埋め合わせない（先行 `ShowLatestSuggestion`）— 在庫が引けなければそのまま投げる。
    // **充足は現在の在庫で都度算出する**（規則4 / FR-32 / ADR-009）。
    const { stockItems } = await deps.listStockItems(householdId);
    const mealStockItems = stockItems.map(toMealStockItem);

    // **組み立ては提案の1件と同じ関数を通る**（規則16 / ADR-067 論点1）— 写しを2つ持つと、
    // 同じ献立が経路によって違う形で出る。足りない（足さない）のは由来だけである（規則8）。
    // **調理記録の有無は真偽1つだけ足す**（B-53b / ADR-070 決定1・2）— 1件以上なら件数に
    // よらず真で、判定は `ListMeals` の振り分けと同じ。件数も日時も載せない（B-48a 規則12）。
    // 提案の1件（`suggestionOutputOf`）には足さないので、提案の JSON は変わらない。
    return {
      ...mealOutputOf(
        meal,
        mealStockItems.map((stockItem) => stockItem.name),
        earliestExpiryDateByName(mealStockItems),
      ),
      cooked: meal.cookingRecords.length > 0,
    };
  };
}
