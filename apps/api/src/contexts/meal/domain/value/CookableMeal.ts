import type { Meal } from '../entity/Meal.js';

/**
 * 作れる献立。現在の在庫で不足0件の既存献立（C-10 / 用語表）。
 *
 * 抱えるのは献立1つだけで、充足 `MealCoverage` は持たない（ADR-036 決定5）。
 * 不足0件のものしか通らない以上、`missing` は定義上つねに空、`covered` は献立の
 * 主材料そのもので、**値が1つしか取りえない項目は何も区別しない**（ADR-035 の論法）。
 *
 * 包みそのものは残す。`Meal` は「手持ちの献立」としか言えないが、`CookableMeal` は
 * **判定を通ったことを型で言う**。都度の算出結果であって永続化しない（ADR-009）。
 */
export type CookableMeal = {
  /** 不足0件の判定を通ったことの印。素のオブジェクトリテラルを CookableMeal として扱えなくする。 */
  readonly __brand: 'CookableMeal';
  readonly meal: Meal;
};

/**
 * 作れる献立を作る。**判定はしない**（在庫を受け取らないので判定できない）。
 * 不足0件を確かめるのは `cookableMealsOf` であり、印はその判定を通った証である。
 */
export function createCookableMeal(props: { meal: Meal }): CookableMeal {
  // 凍結する。抱えている献立を差し替えられると、印が指している中身が変わり、
  // 「判定を通った」という印が意味を失う。
  return Object.freeze({
    __brand: 'CookableMeal' as const,
    meal: props.meal,
  });
}
