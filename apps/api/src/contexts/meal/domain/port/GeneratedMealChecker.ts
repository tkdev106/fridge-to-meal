import type { GeneratedMeal } from '../value/GeneratedMeal.js';

/**
 * 確かめに渡すもの（B-78 5章）。
 *
 * **世帯を取らない。** 確かめに世帯は要らず、外へ出すものを最小にする（NFR-11 / B-78 規則15）。
 */
export type GeneratedMealCheckInput = {
  /** 生成結果の列。並びは生成側の並びのまま。 */
  readonly generatedMeals: readonly GeneratedMeal[];
  /** 避けるべき献立の名称（FR-42）。 */
  readonly avoidTitles: readonly string[];
};

/**
 * 生成結果を保存の前に確かめ、残すものだけを返す出口（ADR-089 決定1）。
 *
 * 確かめの手段は実装（腐敗防止層）に閉じる（ADR-005）。
 */
export interface GeneratedMealChecker {
  /** 残す生成結果を、受け取った並びのまま返す。投げない。0件も返しうる */
  check(input: GeneratedMealCheckInput): Promise<readonly GeneratedMeal[]>;
}
