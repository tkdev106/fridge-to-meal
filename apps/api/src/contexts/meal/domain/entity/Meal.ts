import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';
import { MealRuleViolation } from '../error/MealRuleViolation.js';
import type { CookingRecord } from '../value/CookingRecord.js';
import type { CookingStep } from '../value/CookingStep.js';
import type { DateTime } from '../value/DateTime.js';
import type { MealId } from '../value/MealId.js';
import type { MealIngredient } from '../value/MealIngredient.js';

/**
 * 献立。生成された1つの献立。**集約ルート**（domain-model 4章）。
 *
 * 不変条件（domain-model 4章 / B-14a 6章）:
 * - `title` は空を許さない
 * - `ingredients` は1件以上で、うち `kind: 'main'` が1件以上（C-16）
 * - `steps` は1件以上。順序は配列の並びそのもの
 * - 生成後に編集できない。増えるのは `cookingRecords` だけ（C-3）
 */
export type Meal = {
  /** 生成の経路を1つに絞るための印。素のオブジェクトリテラルを Meal として扱えなくする。 */
  readonly __brand: 'Meal';
  readonly id: MealId;
  /** 所有する世帯。変える経路を置かないことで世帯の所属を固定する（C-9）。 */
  readonly householdId: HouseholdId;
  readonly title: string;
  readonly ingredients: readonly MealIngredient[];
  readonly steps: readonly CookingStep[];
  /** 生成の由来。組み立てる側が渡す（B-14a 規則9）。 */
  readonly provenance: 'llm';
  readonly generatedAt: DateTime;
  /** 調理記録。追加のみ（C-3 / B-14a 規則11）。 */
  readonly cookingRecords: readonly CookingRecord[];
};

/**
 * 献立を作る。
 *
 * @throws {MealRuleViolation} 不変条件に反するとき
 */
export function createMeal(props: {
  id: MealId;
  householdId: HouseholdId;
  title: string;
  ingredients: readonly MealIngredient[];
  steps: readonly CookingStep[];
  provenance: 'llm';
  generatedAt: DateTime;
  cookingRecords: readonly CookingRecord[];
}): Meal {
  // 落とすのは前後の空白だけ。途中を詰めると別の名称になる。長さの上限は見ない —
  // 40字の制限は腐敗防止層の検証の規則であって、不変条件ではない（B-14a 規則14）。
  const title = props.title.trim();
  if (title === '') {
    // 名称の無い献立は画面にも一覧にも出せない（domain-model 4章）。
    throw new MealRuleViolation('meal.title.empty', '献立の名称が空です');
  }

  if (props.ingredients.length === 0) {
    // 材料の無い献立は充足を算出できない（domain-model 4章）。
    throw new MealRuleViolation('meal.ingredients.empty', '献立の材料が1件もありません');
  }

  if (!props.ingredients.some((ingredient) => ingredient.kind === 'main')) {
    // 調味料は充足の突き合わせに載らない（C-16 / ADR-023）ため、主材料が無いと
    // 不足が常に0件になり、在庫に関わらず「作れる」と判定されてしまう。
    throw new MealRuleViolation('meal.ingredients.noMain', '献立の主材料が1件もありません');
  }

  if (props.steps.length === 0) {
    // 手順の無い献立は作れる形になっていない（domain-model 4章）。
    throw new MealRuleViolation('meal.steps.empty', '献立の手順が1件もありません');
  }

  // 集約本体と、持っている3つの列をそれぞれ凍結する。献立は生成後に編集できない
  // （C-3）ため、列が可変だと集約を通さずに材料や記録を足せてしまう。
  // 受け取った配列は複製してから凍結する — 複製しないと、呼ぶ側が持ち続けている
  // 参照から不変条件を通らない変更が入る（B-14a 規則10）。
  return Object.freeze({
    __brand: 'Meal' as const,
    id: props.id,
    householdId: props.householdId,
    title,
    // 並べ替えも番号の付与もしない。順序は配列の並びそのものが持つ（B-14a 規則4）。
    ingredients: Object.freeze([...props.ingredients]),
    steps: Object.freeze([...props.steps]),
    provenance: props.provenance,
    generatedAt: props.generatedAt,
    cookingRecords: Object.freeze([...props.cookingRecords]),
  });
}

/** 調理記録を1件足した献立を作り直す。増やす入口はこれだけ（追加のみ）。 */
export function withCookingRecord(meal: Meal, cookingRecord: CookingRecord): Meal {
  // createMeal を通すことで、作り直したものも同じ不変条件を通る。引き継ぐ7つを
  // 引数に取らないので、世帯の所属を変える経路が型として起こせない（C-9 / B-14a 規則12）。
  return createMeal({
    id: meal.id,
    householdId: meal.householdId,
    title: meal.title,
    ingredients: meal.ingredients,
    steps: meal.steps,
    provenance: meal.provenance,
    generatedAt: meal.generatedAt,
    // 末尾に足すだけで、並べ替えも取り除きもしない。記録された順が事実である
    // （B-14a 規則11）。
    cookingRecords: [...meal.cookingRecords, cookingRecord],
  });
}
