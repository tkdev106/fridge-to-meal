import type { MealIngredient } from './MealIngredient.js';

/**
 * 充足。現在の在庫で主材料をどれだけ賄えるかの算出結果（B-13 5章）。
 *
 * 都度の算出結果であって永続化しないため、生成の経路を絞る印は持たない（B-13 10章の前提5）。
 * 調味料は賄えるものにも不足するものにも現れない（C-16 / ADR-023）。
 */
export type MealCoverage = {
  readonly covered: readonly MealIngredient[];
  readonly missing: readonly MealIngredient[];
};
