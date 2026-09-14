import { MealRuleViolation } from '../error/MealRuleViolation.js';
import type { CookingStep } from './CookingStep.js';
import type { MealIngredient } from './MealIngredient.js';

/**
 * 検証を通った生成結果1件。`Meal` になる前の形（B-15 5章）。
 *
 * 識別子・世帯・生成日時・由来の項目を持たない — 永続化は呼ぶ側の仕事であり、
 * 由来は `SuggestionEntry.origin` が表す（B-15 規則3 / C-1 / ADR-035）。
 *
 * 不変条件は先行の `Meal` と同じ3つ（domain-model 4章 / B-15 規則11〜12）:
 * - `title` は空を許さない
 * - `ingredients` は1件以上で、うち `kind: 'main'` が1件以上（C-16）
 * - `steps` は1件以上。順序は配列の並びそのもの
 */
export type GeneratedMeal = {
  /** 生成の経路を1つに絞るための印。素のオブジェクトリテラルを GeneratedMeal として扱えなくする。 */
  readonly __brand: 'GeneratedMeal';
  readonly title: string;
  readonly ingredients: readonly MealIngredient[];
  readonly steps: readonly CookingStep[];
};

/**
 * 生成結果1件を作る（B-15 規則11〜14）。
 *
 * @throws {MealRuleViolation} 不変条件に反するとき
 */
export function createGeneratedMeal(props: {
  title: string;
  ingredients: readonly MealIngredient[];
  steps: readonly CookingStep[];
}): GeneratedMeal {
  // 落とすのは前後の空白だけ。途中を詰めると別の名称になる。先行の createMeal と
  // 同じ正規化を通す — 片側だけ別の正規化にすると、名称の完全一致が静かにずれる
  // （C-6 / B-15 規則11）。長さの上限は見ない。40字の制限は腐敗防止層の検証の
  // 規則であって、不変条件ではない（B-15 規則14）。
  const title = props.title.trim();
  if (title === '') {
    // 名称の無いものは画面にも一覧にも出せない（domain-model 4章）。
    throw new MealRuleViolation('generatedMeal.title.empty', '生成結果の名称が空です');
  }

  if (props.ingredients.length === 0) {
    // 材料が無いと充足を算出できない（domain-model 4章）。
    throw new MealRuleViolation(
      'generatedMeal.ingredients.empty',
      '生成結果の材料が1件もありません',
    );
  }

  if (!props.ingredients.some((ingredient) => ingredient.kind === 'main')) {
    // 調味料は充足の突き合わせに載らない（C-16 / ADR-023）ため、主材料が無いと
    // 不足が常に0件になり、在庫に関わらず「作れる」と判定されてしまう。
    // 材料が空の違反とは直し方が違うので、rule を分けて呼ぶ側が見分けられるようにする。
    throw new MealRuleViolation(
      'generatedMeal.ingredients.noMain',
      '生成結果の主材料が1件もありません',
    );
  }

  if (props.steps.length === 0) {
    // 手順の無いものは作れる形になっていない（domain-model 4章）。
    throw new MealRuleViolation('generatedMeal.steps.empty', '生成結果の手順が1件もありません');
  }

  // 本体と、持っている2つの列をそれぞれ凍結する。生成後に編集できない（C-3）ため、
  // 列が可変だと生成関数を通さずに材料や手順を足せてしまう。
  // 受け取った配列は複製してから凍結する — 複製しないと、呼ぶ側が持ち続けている
  // 参照から不変条件を通らない変更が入る（B-15 規則13）。
  return Object.freeze({
    __brand: 'GeneratedMeal' as const,
    title,
    // 並べ替えも番号の付与もしない。主材料を先頭へ寄せもしない — 順序は配列の
    // 並びそのものが持ち、生成側が書いた並びをそのまま渡す（B-15 規則13）。
    ingredients: Object.freeze([...props.ingredients]),
    steps: Object.freeze([...props.steps]),
  });
}
