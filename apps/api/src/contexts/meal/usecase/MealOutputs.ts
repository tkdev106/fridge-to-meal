// 献立と提案を DTO に写す組み立て（B-52 / ADR-065 結果4 / ADR-067 論点1）。
//
// **`SuggestMeals.ts` から移したものであり、振る舞いは1つも変えていない。** 提案の経路
// （`SuggestMeals` / `ShowLatestSuggestion`）と献立詳細の経路（`ShowMeal`）が同じ写し方を
// 通るようにするための置き場である — 写しを2つ持つと、同じ献立が経路によって違う形で出る。

import type {
  MealIngredientDto,
  MealOutput,
  StockItemDto,
  SuggestionEntryOutput,
  SuggestionOutput,
} from '@fridge-to-meal/contract';
import type { Meal } from '../domain/entity/Meal.js';
import type { Suggestion } from '../domain/entity/Suggestion.js';
import { earliestExpiryDateByName } from '../domain/service/EarliestExpiryDates.js';
import { mealCoverageOf } from '../domain/service/MealCoverageService.js';
import { amountOf } from '../domain/value/Amount.js';
import { expiryDateOf } from '../domain/value/ExpiryDate.js';
import type { ExpiryDate } from '../domain/value/ExpiryDate.js';
import type { MealId } from '../domain/value/MealId.js';
import type { MealIngredient } from '../domain/value/MealIngredient.js';
import { createStockItem } from '../domain/value/StockItem.js';
import type { StockItem } from '../domain/value/StockItem.js';
import type { SuggestionEntry } from '../domain/value/SuggestionEntry.js';

/**
 * 献立1件を、**現在の在庫での充足つき**の DTO に写す（B-52 規則4〜9 / FR-30 / FR-32）。
 *
 * 提案の1件（`SuggestionEntryOutput`）から**由来だけを除いた部分**であり、両方の経路が
 * これを通る（規則16 / ADR-067 論点1）。世帯・調理記録・生成日時は載せない（NFR-09）。
 */
export function mealOutputOf(
  meal: Meal,
  stockItemNames: readonly string[],
  earliestExpiryDates: ReadonlyMap<string, ExpiryDate>,
): MealOutput {
  // 充足は現在の在庫の名称で算出する（FR-17 / ADR-009 / C-6 / C-16）。
  const coverage = mealCoverageOf(meal.ingredients, stockItemNames);

  return {
    mealId: meal.id,
    title: meal.title,
    // 材料も手順も保存された並びのまま写す。並べ替えも補完もしない（B-48a 規則3 / C-5）。
    ingredients: meal.ingredients.map(toIngredientDto),
    steps: [...meal.steps],
    coverage: {
      // 賄える材料には、同じ名称の在庫品のうち最も早い期限を日付のまま載せる（B-48a 規則8 /
      // ADR-036 決定1(ii)(iii)）。名称の前後空白は畳む側と同じく落として引く（C-6）。
      // 残日数や「今日」かどうかは基準時刻に依存するため載せない — それは画面が持つ。
      covered: coverage.covered.map((ingredient) => ({
        ...toIngredientDto(ingredient),
        expiryDate: earliestExpiryDates.get(ingredient.name.trim()) ?? null,
      })),
      missing: coverage.missing.map(toIngredientDto),
    },
  };
}

/**
 * 在庫の一覧が返した在庫品を献立側の在庫品に写す（B-27 規則2・3）。持つのは**名称・分量・
 * 期限の3項目**だけで、識別子と食材の指定は落とす — 献立側のどの規則も見ないためである
 * （ADR-033 決定3 / ADR-037 決定1）。
 *
 * **ここで trim も既定値の補完もしない。** 正規化はドメインが持つものであり、写す側が
 * 2つ目の正規化の規則を持つと、片方だけ変わったときに突き合わせが静かにずれる
 * （先行 `registerStockItem` / ADR-037 理由(3)）。
 */
export function toMealStockItem(stockItem: StockItemDto): StockItem {
  return createStockItem({
    name: stockItem.name,
    amount: amountOf(stockItem.amount),
    expiryDate: expiryDateOf(stockItem.expiryDate),
  });
}
/**
 * 在庫の一覧が返した在庫品のうち、**献立に使う在庫品だけ**を残す（FR-43 / ADR-086 決定3）。
 * 並びは受け取ったまま保つ。
 *
 * 提案の在庫スナップショット・作れる献立の選定・在庫の下限・生成への入力・C-7 の比較は
 * この列から組む。**充足の表示には使わない** — 充足は献立に使わない在庫品も含めた全件で算出する
 * （FR-21 / FR-32）。受け取るのは DTO の真偽値だけで、献立側の在庫品と在庫スナップショットには
 * 項目を持ち込まない（ADR-033）。
 */
export function stockItemsUsedForMealsOf(stockItems: readonly StockItemDto[]): StockItemDto[] {
  return stockItems.filter((stockItem) => stockItem.useForMeals);
}

/**
 * 献立を識別子で引けるようにする（B-48a 規則5・11）。受け取った列は読むだけである（ADR-009）。
 * 渡すのは世帯で引いた献立だけであり、他世帯の献立を指す識別子は引けない（C-9）。
 */
export function mealByIdOf(meals: readonly Meal[]): ReadonlyMap<MealId, Meal> {
  const mealById = new Map<MealId, Meal>();
  for (const meal of meals) {
    if (!mealById.has(meal.id)) mealById.set(meal.id, meal);
  }
  return mealById;
}
/**
 * 提案そのものを DTO に写す（B-48a 規則2〜6）。**結末の名乗りを付けない部分だけ**を切り出して
 * あり、`toOutput` と **B-58 の `ShowLatestSuggestion`** が同じものを使う。
 *
 * **写しを2つ持たない。** 保存済みの提案を読み取り専用で返す経路は、C-7 で短絡した回と
 * まったく同じものを返さなければならない（FR-21「再訪時に同じものが表示される」）— 別の写し方を
 * 置くと、同じ提案が経路によって違う形で出る。
 *
 * @throws {Error} 提案の1件が指す献立が引けないとき（B-48a 決定1）
 */
export function suggestionOutputOf(
  suggestion: Suggestion,
  mealById: ReadonlyMap<MealId, Meal>,
  mealStockItems: readonly StockItem[],
): SuggestionOutput {
  const stockItemNames = mealStockItems.map((stockItem) => stockItem.name);
  // 賄える材料の期限は、名称の突き合わせと同じ在庫の列から引く（B-48a 規則6・8）。
  // 期限切れの在庫品も落とさない — 期限は賄えるかに関わらず、日付として見せるだけである。
  const earliestExpiryDates = earliestExpiryDateByName(mealStockItems);

  return {
    id: suggestion.id,
    entries: suggestion.entries.map((entry) =>
      toEntryOutput(entry, mealById, stockItemNames, earliestExpiryDates),
    ),
    generatedAt: suggestion.generatedAt,
  };
}

/**
 * 提案の1件を、指す献立の中身とともに写す（B-48a 規則2〜7・11）。
 *
 * **指す献立が引けなければ提案を返さずに断る**（決定1 / ADR-058 結果2）。献立は無期限に保持され
 * 消す口も無い（Q-2）ので、引けないのはデータの不整合である。1件だけ落とすと FR-21 の
 * 「同じものが表示される」が黙って崩れ、全件落ちれば C-15 を割る。利用者が入力を直しても
 * 解消しないため **`MealRuleViolation` に包まない** — 包むと api 層の写像が 4xx に化けさせる
 * （ADR-045 決定1）。**message に世帯の識別子を含めない**（ADR-045 決定3）。
 */
function toEntryOutput(
  entry: SuggestionEntry,
  mealById: ReadonlyMap<MealId, Meal>,
  stockItemNames: readonly string[],
  earliestExpiryDates: ReadonlyMap<string, ExpiryDate>,
): SuggestionEntryOutput {
  const meal = mealById.get(entry.mealId);
  if (meal === undefined) {
    throw new Error(`提案の1件が指す献立が見つからない（mealId: ${entry.mealId}）`);
  }

  // 献立の中身と充足は `mealOutputOf` が組む。提案の1件が足すのは**由来だけ**である
  // （ADR-067 論点1 / B-52 規則16）— 写しを2つ持つと、同じ献立が経路によって違う形で出る。
  return { ...mealOutputOf(meal, stockItemNames, earliestExpiryDates), origin: entry.origin };
}

/** 材料を DTO に写す。分量の未設定は `null` のまま（ADR-010）。 */
function toIngredientDto(ingredient: MealIngredient): MealIngredientDto {
  return { name: ingredient.name, kind: ingredient.kind, amount: ingredient.amount };
}
