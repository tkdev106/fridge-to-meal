/**
 * 献立詳細の材料の組み立て（B-53 2周目 / `docs/screen-design.md` 4章）。
 *
 * **判断はここに置き、`.tsx` に置かない**（先行 `MealCards.ts`）。並びと印は置き場所を誤ると
 * 黙って変わるうえ、ここなら仮の文言にも jsdom にも依存せずに確かめられる。
 *
 * **仮の記号（`✓` / `✗ 不足`）を期待値に1つも書かない** — 返るのは識別子3値だけであり、
 * 記号と文字の両方で出すこと（NFR-17）は `MealDetail.test.tsx` の持ち分である。
 */

import { describe, expect, it } from 'vitest';
import type { MealIngredientDto, MealOutput } from '@fridge-to-meal/contract';
import { mealDetailIngredientsOf } from '../../../src/features/meal/MealDetailIngredients.js';

function main(name: string, amount: string | null = null): MealIngredientDto {
  return { name, kind: 'main', amount };
}

function seasoning(name: string, amount: string | null = null): MealIngredientDto {
  return { name, kind: 'seasoning', amount };
}

function meal(overrides: Partial<MealOutput> = {}): MealOutput {
  return {
    mealId: 'meal-1',
    title: '豚こま肉と白菜の生姜焼き',
    ingredients: [],
    steps: [],
    coverage: { covered: [], missing: [] },
    ...overrides,
  };
}

/** 1件だけ組み、その1件を取り出す。 */
function oneOf(input: MealOutput) {
  const ingredient = mealDetailIngredientsOf(input)[0];
  if (ingredient === undefined) throw new Error('材料が1件も組めていない');

  return ingredient;
}

describe('献立詳細の材料の組み立て MealDetailIngredients', () => {
  it('献立の材料を1件も落とさずに返す', () => {
    // 表示は生成時のまま不変である（FR-30 / C-3）。調味料も落とさない（C-16）。
    const ingredients = mealDetailIngredientsOf(
      meal({
        ingredients: [main('豚こま肉'), main('白菜'), seasoning('醤油'), seasoning('みりん')],
        coverage: { covered: [{ ...main('豚こま肉'), expiryDate: null }], missing: [main('白菜')] },
      }),
    );

    expect(ingredients.map((ingredient) => ingredient.name)).toEqual([
      '豚こま肉',
      '白菜',
      '醤油',
      'みりん',
    ]);
  });

  it('主材料を調味料より先に並べる', () => {
    // 何がその献立の中身かが、上から読んで分かる（画面設計 4章）。
    const ingredients = mealDetailIngredientsOf(
      meal({
        ingredients: [seasoning('醤油'), main('豚こま肉'), seasoning('みりん'), main('白菜')],
      }),
    );

    expect(ingredients.map((ingredient) => ingredient.name)).toEqual([
      '豚こま肉',
      '白菜',
      '醤油',
      'みりん',
    ]);
  });

  it('主材料どうしは材料の並びのまま保つ', () => {
    // 同じ献立を描き直しても順序が変わらない（C-3 / C-12）。
    const ingredients = mealDetailIngredientsOf(
      meal({ ingredients: [main('白菜'), main('豚こま肉'), main('にんじん')] }),
    );

    expect(ingredients.map((ingredient) => ingredient.name)).toEqual([
      '白菜',
      '豚こま肉',
      'にんじん',
    ]);
  });

  it('調味料どうしも材料の並びのまま保つ', () => {
    const ingredients = mealDetailIngredientsOf(
      meal({ ingredients: [seasoning('みりん'), seasoning('醤油'), seasoning('塩')] }),
    );

    expect(ingredients.map((ingredient) => ingredient.name)).toEqual(['みりん', '醤油', '塩']);
  });

  it('不足する主材料に不足の印を付ける', () => {
    // 充足は開いた時点の在庫で算出されたものである（FR-32 / ADR-009）。
    const ingredient = oneOf(
      meal({
        ingredients: [main('しょうが', '1かけ')],
        coverage: { covered: [], missing: [main('しょうが', '1かけ')] },
      }),
    );

    expect(ingredient.mark).toBe('missing');
  });

  it('不足に載っていない主材料に賄えるの印を付ける', () => {
    const ingredient = oneOf(
      meal({
        ingredients: [main('豚こま肉', '300g')],
        coverage: {
          covered: [{ ...main('豚こま肉', '300g'), expiryDate: '2026-09-20' }],
          missing: [main('しょうが', '1かけ')],
        },
      }),
    );

    expect(ingredient.mark).toBe('covered');
  });

  it('調味料には印を付けない', () => {
    // C-16 / ADR-023: 調味料は充足判定の対象外であり、**印が無いこと自体が
    // 「在庫と照合していない」という意味になる**（画面設計 4章）。
    const ingredients = mealDetailIngredientsOf(
      meal({
        ingredients: [main('豚こま肉'), seasoning('醤油')],
        coverage: { covered: [{ ...main('豚こま肉'), expiryDate: null }], missing: [] },
      }),
    );

    expect(ingredients[1]).toEqual({ name: '醤油', amount: null, mark: 'none' });
  });

  it('不足に名前のある調味料にも不足の印を付けない', () => {
    // **印は種別だけで決まる。** C-16 / ADR-023 によりサーバは調味料を充足に載せないが、
    // 載った日に印が付くと「調味料も在庫と照合している」と読めてしまう。
    const ingredient = oneOf(
      meal({
        ingredients: [seasoning('醤油')],
        coverage: { covered: [], missing: [seasoning('醤油')] },
      }),
    );

    expect(ingredient.mark).toBe('none');
  });

  it('名称が完全一致しない主材料を不足と読まない', () => {
    // C-6: 充足判定は食材名の完全一致である（表記ゆれは吸収しない）。
    const ingredient = oneOf(
      meal({
        ingredients: [main('豚こま肉')],
        coverage: { covered: [], missing: [main('豚こま')] },
      }),
    );

    expect(ingredient.mark).toBe('covered');
  });

  it('分量を持たない材料は分量を持たないまま返す', () => {
    // ADR-010: 分量は自由文字列で、未設定は `null`。欄を出さない判断は `.tsx` が行う。
    const ingredient = oneOf(meal({ ingredients: [main('豚こま肉', null)] }));

    expect(ingredient).toEqual({ name: '豚こま肉', amount: null, mark: 'covered' });
  });

  it('空文字の分量を空のまま返す', () => {
    // `null` に倒さない（ADR-010 / C-5）— 空であることは生成時の事実である。
    const ingredient = oneOf(meal({ ingredients: [main('豚こま肉', '')] }));

    expect(ingredient.amount).toBe('');
  });

  it('分量の前後の空白を落とさない', () => {
    // 分量は自由文字列であり、web で整形しない（ADR-010 / C-3）。
    const ingredient = oneOf(meal({ ingredients: [main('豚こま肉', '  300g  ')] }));

    expect(ingredient.amount).toBe('  300g  ');
  });

  it('渡された献立の材料の並びを書き換えない', () => {
    // C-3 / C-12: 生成後の献立は不変であり、描き直しても並びが変わらない。
    const input = meal({ ingredients: [seasoning('醤油'), main('豚こま肉')] });

    mealDetailIngredientsOf(input);

    expect(input.ingredients.map((ingredient) => ingredient.name)).toEqual(['醤油', '豚こま肉']);
  });
});
