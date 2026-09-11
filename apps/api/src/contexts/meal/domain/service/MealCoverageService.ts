import type { MealCoverage } from '../value/MealCoverage.js';
import type { MealIngredient } from '../value/MealIngredient.js';

/**
 * 突き合わせに使える在庫品の名称を集める（B-13 規則2・規則5・規則7）。
 *
 * 前後空白を落とし、落とした結果が空になるものは対象にしない。同じ名称が何度現れても
 * 結果は変わらない（在庫品は同じ食材でも統合されない。ADR-007）。
 */
function stockedNames(stockItemNames: readonly string[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const stockItemName of stockItemNames) {
    const name = stockItemName.trim();
    if (name !== '') names.add(name);
  }
  return names;
}

/**
 * 材料の主材料だけを在庫品の名称と突き合わせ、賄えるものと不足するものに分ける（B-13 5章）。
 *
 * 在庫は名称の文字列の列で受け取る。突き合わせは名称の完全一致で行う（C-6）。
 *
 * - 調味料は常備の前提なので、賄えるものにも不足するものにも現れない（C-16 / ADR-023）
 * - 一致の前に**両側**の前後空白を落とす。それ以外の正規化はせず、表記ゆれは吸収しない（C-6）
 * - 分量は見ない。不足かどうかは食材の有無だけで決まるため、同じ名称の主材料が
 *   複数あっても按分せず、まとめて同じ側に入る（ADR-010）
 * - 並びは渡された材料のものをそのまま保ち、在庫側の並びに引きずられない（C-12 の決定性）
 * - 受け取った配列と要素を書き換えず、返す値は凍結する（B-13 規則10 / ADR-009）
 */
export function mealCoverageOf(
  ingredients: readonly MealIngredient[],
  stockItemNames: readonly string[],
): MealCoverage {
  const stocked = stockedNames(stockItemNames);

  const covered: MealIngredient[] = [];
  const missing: MealIngredient[] = [];
  for (const ingredient of ingredients) {
    if (ingredient.kind !== 'main') continue;

    if (stocked.has(ingredient.name.trim())) {
      covered.push(ingredient);
    } else {
      missing.push(ingredient);
    }
  }

  return Object.freeze({
    covered: Object.freeze(covered),
    missing: Object.freeze(missing),
  });
}
