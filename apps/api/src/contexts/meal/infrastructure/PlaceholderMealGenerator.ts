import { MealRuleViolation } from '../domain/error/MealRuleViolation.js';
import type { MealGenerationInput, MealGenerator } from '../domain/port/MealGenerator.js';
import { cookingStepOf } from '../domain/value/CookingStep.js';
import { createGeneratedMeal } from '../domain/value/GeneratedMeal.js';
import type { GeneratedMeal } from '../domain/value/GeneratedMeal.js';
import { createMealIngredient } from '../domain/value/MealIngredient.js';
import { unexpiredStockItemsOf } from '../domain/value/PantrySnapshot.js';
import type { StockItem } from '../domain/value/StockItem.js';

/**
 * 名称の書式。`{name}` に主材料の名称を埋める（B-47 規則5 / ADR-060 決定4）。
 *
 * 「仮」であることが名称だけで読めるようにする。名称は主材料の名称だけから一意に決まるので、
 * 同じ主材料で2度呼ばれても同じ名称になり、2度目は既存が参照される（C-4）。
 */
const TITLE_TEMPLATE = '仮の献立（{name}）';

/**
 * 手順の文言。`{name}` に主材料の名称を埋める（B-47 規則6）。
 *
 * 中身は仮である。定数に置き、呼ぶたびに変わらないことだけを守る（規則11）。
 */
const STEP_TEMPLATES: readonly string[] = [
  '{name}を食べやすい大きさに切る',
  '{name}に火を通し、味を調えて仕上げる',
];

/**
 * 仮の献立生成器（B-47 / ADR-060）。プロバイダが決まるまで `MealGenerator` の背後を埋める。
 *
 * 引数なしで生成でき、状態を持たない。外へ出ず、時計も乱数も読まない — 同じ入力には
 * 同じ出力を返す（B-47 規則11 / `docs/testing.md` 5章）。
 */
export class PlaceholderMealGenerator implements MealGenerator {
  async generate(input: MealGenerationInput): Promise<readonly GeneratedMeal[]> {
    // 期限の規則は写さず、在庫スナップショットが持つ関数を呼ぶ（B-47 規則1 / ADR-040 決定1）。
    // 基準日時は input.asOf だけを使う（規則11）。
    const usableStockItems = unexpiredStockItemsOf(input.pantrySnapshot, input.asOf);

    const representatives = oneStockItemPerName([...usableStockItems].sort(compareStockItems));
    if (representatives.length === 0) {
      // 空の列を返さない。ポートの約束であり、呼ぶ側が生成を呼ばない判断をしていても
      // 実装として持つ（B-47 7章 / B-15 規則5）。
      throw new MealRuleViolation(
        'mealGenerator.empty',
        '期限内の在庫品が1件も無いため、献立を生成できません',
      );
    }

    // 畳む・期限切れを落とすのは数える前。数えるのは避ける名称で並べ直した後（B-47 規則7・8）。
    const generatedMeals = avoidedTitlesLast(
      representatives.map(generatedMealFrom),
      input.avoidTitles,
    );
    // 先頭から requiredCount 件。名称が足りなければその件数で返す（規則8 / ADR-021）。
    return generatedMeals.slice(0, input.requiredCount);
  }
}

/**
 * 避ける名称に含まれる献立を後ろへ回す。落とさない（B-47 規則7）。
 *
 * 避ける名称は努力目標であって保証ではない（ADR-021）。落とすと、同じ在庫で新しい献立を
 * 求めた回（FR-36）が必ず0件で失敗する。それぞれの内側は受け取った並び（規則3）のまま。
 */
function avoidedTitlesLast(
  generatedMeals: readonly GeneratedMeal[],
  avoidTitles: readonly string[],
): GeneratedMeal[] {
  const avoided = new Set(avoidTitles);
  const fresh = generatedMeals.filter((meal) => !avoided.has(meal.title));
  const repeated = generatedMeals.filter((meal) => avoided.has(meal.title));
  return [...fresh, ...repeated];
}

/**
 * 並べ終えた列を名称で1件に畳む。先に来たもの（期限の近いもの）を残す（B-47 規則2）。
 *
 * 1つの名称から献立は1件。同じ名称が並ぶと同じ名称の献立が2件になる（C-13 / 規則9）。
 */
function oneStockItemPerName(sortedStockItems: readonly StockItem[]): StockItem[] {
  const seenNames = new Set<string>();
  const representatives: StockItem[] = [];
  for (const stockItem of sortedStockItems) {
    if (seenNames.has(stockItem.name)) continue;
    seenNames.add(stockItem.name);
    representatives.push(stockItem);
  }
  return representatives;
}

/**
 * 在庫品の並び（B-47 規則3 / FR-18）。期限の昇順、期限なしは最後、同じ期限は名称、
 * 名称も同じなら分量（`null` は最後）。どの鍵も code unit 順で比べ、照合順序が実行環境に
 * 依る `localeCompare` は使わない（ADR-036 結果8）。受け取った列の並びに依らない順になる。
 */
function compareStockItems(left: StockItem, right: StockItem): number {
  return (
    compareNullableLast(left.expiryDate, right.expiryDate) ||
    compareCodeUnits(left.name, right.name) ||
    compareNullableLast(left.amount, right.amount)
  );
}

/** `null` を最後に回して code unit 順で比べる。 */
function compareNullableLast(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareCodeUnits(left, right);
}

/** 文字列を code unit 順で比べる（ADR-036 結果8）。 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * 在庫品1件から献立1件を作る（B-47 規則4〜6・規則10）。
 *
 * 主材料は在庫品の名称と分量をそのまま使い、材料はこの1件だけ。名称を再加工すると
 * 名称の完全一致で在庫と突き合わなくなる（D-3 / C-5 / C-6 / C-16）。
 */
function generatedMealFrom(stockItem: StockItem): GeneratedMeal {
  return createGeneratedMeal({
    title: fill(TITLE_TEMPLATE, stockItem.name),
    ingredients: [
      createMealIngredient({ name: stockItem.name, kind: 'main', amount: stockItem.amount }),
    ],
    steps: STEP_TEMPLATES.map((template) => cookingStepOf(fill(template, stockItem.name))),
  });
}

/** 書式の `{name}` に名称を埋める。`replace` の置換パターン（`$&` 等）が名称に効かないよう関数で渡す。 */
function fill(template: string, name: string): string {
  return template.replace('{name}', () => name);
}
