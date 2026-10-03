import type {
  CookedMealSummaryOutput,
  ListMealsOutput,
  MealSummaryOutput,
  SeenMealSummaryOutput,
} from '@fridge-to-meal/contract';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { Meal } from '../domain/entity/Meal.js';
import type { MealRepository } from '../domain/repository/MealRepository.js';

/**
 * 世帯の献立を、調理記録の有無で `seen` / `cooked` の2列に振り分けて返す
 * （B-54a / FR-28 / FR-29 / ADR-068 / ADR-083）。世帯は唯一の引数で受け取る（C-9）。
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

    // **調理記録の有無は、どちらの列に入るかでだけ表れる**（ADR-068 決定3）—
    // 1件以上なら件数によらず `cooked` に1度だけ入る（FR-29）。
    const seen: SeenMealSummaryOutput[] = [];
    const cooked: CookedMealSummaryOutput[] = [];
    for (const meal of meals) {
      const latestCookedAt = latestCookedAtOf(meal);
      if (latestCookedAt === null) {
        seen.push({ ...summaryOf(meal), generatedAt: meal.generatedAt });
      } else {
        cooked.push({ ...summaryOf(meal), cookedAt: latestCookedAt });
      }
    }

    // **列ごとに、その列の日時の降順**（ADR-083 決定1）。以前見た献立は生成日時、作った献立は
    // 直近の調理記録の日時で並べる。同時刻は `MealId` の昇順で全順序を閉じる（C-12 の最終段）。
    seen.sort((left, right) =>
      byDateTimeDescending(left.generatedAt, right.generatedAt, left, right),
    );
    cooked.sort((left, right) => byDateTimeDescending(left.cookedAt, right.cookedAt, left, right));

    // 0件の世帯も 404 や `null` にせず、両方の列を空で返す（規則8）。
    return { seen, cooked };
  };
}

/**
 * 1件に共通して載せるのは識別子・名称・**主材料の件数**の3つ（規則4・6 / ADR-083 決定2）。
 * 世帯・調理記録の件数と全件の日時・充足は載せない（B-48a 規則12 / NFR-09）。
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
 * 直近の調理記録の日時（ADR-083 決定1）。記録が無ければ `null`。**最大値を取る** —
 * リポジトリが返す記録の並びは時刻の順を約束していないので、末尾の要素とは読まない。
 */
function latestCookedAtOf(meal: Meal): string | null {
  let latest: string | null = null;
  for (const record of meal.cookingRecords) {
    // `DateTime` は UTC の正準形に正規化済みなので、文字列の大小がそのまま時刻の順になる。
    if (latest === null || record.cookedAt > latest) latest = record.cookedAt;
  }
  return latest;
}

/** 日時の降順。同時刻は `MealId` の昇順（コード単位）で閉じる（ADR-083 決定1 / C-12）。 */
function byDateTimeDescending(
  leftDateTime: string,
  rightDateTime: string,
  left: MealSummaryOutput,
  right: MealSummaryOutput,
): number {
  const dateTimeDifference = compareCodeUnits(rightDateTime, leftDateTime);
  if (dateTimeDifference !== 0) return dateTimeDifference;

  return compareCodeUnits(left.mealId, right.mealId);
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
