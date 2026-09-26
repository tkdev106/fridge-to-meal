/**
 * 献立詳細の材料1件ぶんの組み立て（B-53 / `docs/screen-design.md` 4章）。
 *
 * **判断はここに置き、`.tsx` に置かない**（先行 `MealCards.ts`）。並びと印は置き場所を誤ると
 * 黙って変わるうえ、ここなら仮の文言にも jsdom にも依存せずに確かめられる。
 *
 * **日本語（印の記号と文言）はここに無い。** 返すのは識別子3値だけで、記号と文字の両方で
 * 出すこと（NFR-17）は `MealDetail.tsx` の側である。
 */

import type { MealOutput } from '@fridge-to-meal/contract';

/**
 * 材料1件に付く印（NFR-17 / C-16）。
 *
 * **`'none'` は「印を出さない」ことそのものである** — 調味料は充足判定の対象外であり
 * （C-16 / ADR-023）、**印が無いこと自体が「在庫と照合していない」という意味になる**
 * （画面設計 4章）。賄えるとも不足とも読ませない。
 */
export type MealDetailIngredientMark = 'covered' | 'missing' | 'none';

/** 画面が1行として描くもの。**期限は載せない**（画面設計 4章のワイヤーに無い）。 */
export type MealDetailIngredient = {
  readonly name: string;
  readonly amount: string | null;
  readonly mark: MealDetailIngredientMark;
};

/**
 * 材料を画面の並びに直し、印を決める。
 *
 * **並びは主材料が先、調味料が後**（画面設計 4章）。それぞれの中では `ingredients` の並びを
 * そのまま保つ — 生成後の献立は不変であり（C-3）、同じ献立を描き直して順序が変わっては
 * ならない（C-12）。**渡された配列を並べ替えない**（`filter` で2本に分ける）。
 *
 * **印は種別だけで枝が決まる。** 調味料は `coverage` を1つも見ずに `'none'` になる —
 * サーバは調味料を充足に載せないが（C-16 / ADR-023）、載った日に印が付くと
 * 「調味料も在庫と照合している」と読めてしまう。
 *
 * **主材料が不足かどうかは名称の完全一致で読む**（C-6）。表記ゆれは吸収しない。
 * **分量は写すだけである**（ADR-010 / C-5）— `null` も空文字も前後の空白もそのまま運び、
 * 欄を出すかどうかは `.tsx` が決める。
 */
export function mealDetailIngredientsOf(meal: MealOutput): readonly MealDetailIngredient[] {
  // 不足の名称。**主材料の判定にだけ使う。**
  const missingNames = new Set(meal.coverage.missing.map((ingredient) => ingredient.name));

  const mains = meal.ingredients.filter((ingredient) => ingredient.kind === 'main');
  const seasonings = meal.ingredients.filter((ingredient) => ingredient.kind !== 'main');

  return [
    ...mains.map((ingredient) => ({
      name: ingredient.name,
      amount: ingredient.amount,
      mark: missingNames.has(ingredient.name) ? ('missing' as const) : ('covered' as const),
    })),
    ...seasonings.map((ingredient) => ({
      name: ingredient.name,
      amount: ingredient.amount,
      mark: 'none' as const,
    })),
  ];
}
