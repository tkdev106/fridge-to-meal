import type { ListMealsOutput, MealSummaryOutput } from '@fridge-to-meal/contract';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { Meal } from '../domain/entity/Meal.js';
import type { MealRepository } from '../domain/repository/MealRepository.js';

/**
 * 世帯の献立を、調理記録の有無で `seen` / `cooked` の2列に振り分けて返す
 * （B-54a / FR-28 / FR-29 / ADR-068）。世帯は唯一の引数で受け取る（C-9）。
 *
 * **基準日時を受け取らない**（B-54a 規則9 / 先行 ADR-065 理由(4)）— 時刻に依存する判断が
 * 1つも無い。**在庫も提案も読まない**（規則1 / C-8）— 依存が献立のリポジトリだけであることで
 * 型から読める。
 */
export type ListMeals = (householdId: HouseholdId) => Promise<ListMealsOutput>;

/**
 * 献立の一覧のユースケースを組み立てる。依存は献立のリポジトリだけである。
 * 実装の生成は `main.ts` に任せる（ADR-002）。
 */
export function listMeals(deps: { mealRepository: MealRepository }): ListMeals {
  return async (householdId) => {
    // 埋め合わせない（先行 `ShowMeal`）— 取得が落ちたらそのまま投げる（ADR-045）。
    // **全件返す口は並びを約束しない**ので、並べ替えはここで行う（`StockItemRepository` と同じ）。
    const meals = await deps.mealRepository.findByHousehold(householdId);

    // 受け取った配列は読むだけで、並べ替えるのは写しである — リポジトリの実装が持ち続けている
    // 配列を返してくる場合に、その並びを変えない（先行 `CookableMealFinder`）。
    const ordered = [...meals].sort(byGeneratedAtDescending);

    // **調理記録の有無は、どちらの列に入るかでだけ表れる**（規則2 / ADR-068 決定3）—
    // 1件以上なら件数によらず `cooked` に1度だけ入る（FR-29）。
    const seen: MealSummaryOutput[] = [];
    const cooked: MealSummaryOutput[] = [];
    for (const meal of ordered) {
      (meal.cookingRecords.length > 0 ? cooked : seen).push(summaryOf(meal));
    }

    // 0件の世帯も 404 や `null` にせず、両方の列を空で返す（規則8）。
    return { seen, cooked };
  };
}

/**
 * 1件に載せるのは識別子・名称・**主材料の件数**の3つだけ（規則4・6 / ADR-068 決定4）。
 * 世帯・調理記録・生成日時・充足は載せない（B-48a 規則12 / NFR-09）。
 * 件数に調味料を数えない — 常備の前提である（C-16 / `docs/screen-design.md` D-4）。
 */
function summaryOf(meal: Meal): MealSummaryOutput {
  return {
    mealId: meal.id,
    title: meal.title,
    ingredientCount: meal.ingredients.filter((ingredient) => ingredient.kind === 'main').length,
  };
}

/**
 * 並び（規則3 / ADR-068 決定2）。**生成日時の新しい順**で、調理記録の日時は見ない
 * （`docs/screen-design.md` 7章）。同時刻は **`MealId` の昇順**で全順序を閉じる（C-12 の最終段）。
 */
function byGeneratedAtDescending(left: Meal, right: Meal): number {
  // `DateTime` は UTC の正準形に正規化済みなので、文字列の大小がそのまま時刻の順になる。
  const generatedAtDifference = compareCodeUnits(right.generatedAt, left.generatedAt);
  if (generatedAtDifference !== 0) return generatedAtDifference;

  return compareCodeUnits(left.id, right.id);
}

/**
 * コード単位での比較。`localeCompare` は実行環境のロケールで順序が変わりうるため使わない
 * （C-12 / 先行 `CookableMealFinder`）。
 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
