import { MealRuleViolation } from '../error/MealRuleViolation.js';

/**
 * 手順1件。
 *
 * 順序は配列の並びそのものが持ち、番号の項目を置かない（prompt-design 2.2）。
 * 素の `string` ではなく branded 型にするのは、材料名の列と取り違えないため（ADR-033 の結果4）。
 */
export type CookingStep = string & { readonly __brand: 'CookingStep' };

/**
 * 文字列を手順として扱う。前後の空白は落とす。
 *
 * @throws {MealRuleViolation} 前後の空白を落とした結果が空のとき
 */
export function cookingStepOf(raw: string): CookingStep {
  // 落とすのは前後の空白だけ。長さの上限は見ない — 150字の制限は腐敗防止層の
  // 検証の規則であって、domain-model 4章の不変条件ではない（B-14a 規則14）。
  const trimmed = raw.trim();
  if (trimmed === '') {
    // 順序を持つ手順が空では成り立たない（B-14a 規則5）。
    throw new MealRuleViolation('step.empty', '手順が空です');
  }

  return trimmed as CookingStep;
}
