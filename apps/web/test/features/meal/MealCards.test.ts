/**
 * 献立カード1件ぶんの組み立て（B-49a / `docs/screen-design.md` D-4）。
 *
 * **判断はここに置き、`.tsx` に置かない**（先行 `PantrySections.ts` / `Tabs.ts`）。
 * カードに何件と書くか・どの在庫を「使う」に出すかは置き場所を誤ると黙って変わるうえ、
 * ここなら仮の文言にも jsdom にも依存せずに確かめられる。
 *
 * **日本語（印の文言・件数の言い回し）はここに無い。** 文言は `.tsx` の側である。
 */

import { describe, expect, it } from 'vitest';
import type {
  CoveredMealIngredientDto,
  MealIngredientDto,
  SuggestionEntryOutput,
} from '@fridge-to-meal/contract';
import { mealCardsOf } from '../../../src/features/meal/MealCards.js';

const TODAY = '2026-09-20';

function covered(name: string, expiryDate: string | null): CoveredMealIngredientDto {
  return { name, kind: 'main', amount: null, expiryDate };
}

function missing(name: string): MealIngredientDto {
  return { name, kind: 'main', amount: null };
}

function entry(overrides: Partial<SuggestionEntryOutput> = {}): SuggestionEntryOutput {
  return {
    mealId: 'meal-1',
    origin: 'generated',
    title: '豚こま肉と白菜の生姜焼き',
    ingredients: [],
    steps: [],
    coverage: { covered: [], missing: [] },
    ...overrides,
  };
}

/** 1件だけ組み、その1件を取り出す。件数の確かめは呼ぶ側の持ち分ではない。 */
function cardOf(one: SuggestionEntryOutput, today = TODAY) {
  const cards = mealCardsOf([one], today);
  const card = cards[0];
  if (card === undefined) throw new Error('カードが1件も組めていない');

  return card;
}

describe('献立カードの組み立て MealCards', () => {
  it('材料の件数を主材料だけで数える', () => {
    // 充足に載るのは主材料だけである（C-16 / ADR-023 / `mealCoverageOf`）。調味料は
    // `ingredients` には居るが、賄えるとも不足とも判定されない。
    // **件数は賄えるものと不足するものの合計**であり、`ingredients` の長さではない
    // （D-4「調味料を含めると献立の規模が伝わらなくなる」）。
    const card = cardOf(
      entry({
        ingredients: [
          { name: '豚こま肉', kind: 'main', amount: '300g' },
          { name: '白菜', kind: 'main', amount: '1/4個' },
          { name: '醤油', kind: 'seasoning', amount: '大さじ2' },
          { name: 'みりん', kind: 'seasoning', amount: '大さじ2' },
        ],
        coverage: { covered: [covered('豚こま肉', null)], missing: [missing('白菜')] },
      }),
    );

    expect(card.ingredientCount).toBe(2);
  });

  it('不足の件数を不足する主材料の数で数える', () => {
    const card = cardOf(
      entry({
        coverage: {
          covered: [covered('豚こま肉', null)],
          missing: [missing('白菜'), missing('しょうが')],
        },
      }),
    );

    expect(card.missingCount).toBe(2);
  });

  it('使う在庫を期限の早い順に並べる', () => {
    // FR-18 の結果を見せる欄である（D-4）。期限が近い在庫を先に出す。
    const card = cardOf(
      entry({
        coverage: {
          covered: [
            covered('白菜', '2026-09-25'),
            covered('豚こま肉', '2026-09-20'),
            covered('にんじん', '2026-09-22'),
          ],
          missing: [],
        },
      }),
    );

    expect(card.usedIngredients.map((used) => used.name)).toEqual(['豚こま肉', 'にんじん', '白菜']);
  });

  it('期限を持たない在庫を、期限を持つ在庫より後ろに置く', () => {
    // 期限が未設定の在庫品は期限による優先の対象外である（FR-13 / 先行 `earliestExpiryDateByName`）。
    const card = cardOf(
      entry({
        coverage: {
          covered: [covered('にんじん', null), covered('豚こま肉', '2026-09-25')],
          missing: [],
        },
      }),
    );

    expect(card.usedIngredients.map((used) => used.name)).toEqual(['豚こま肉', 'にんじん']);
  });

  it('期限が同じ在庫は材料の並びのまま保つ', () => {
    // 並べ替えは決定的でなければならない（C-12）。同じ期限で順序が入れ替わらないこと。
    const card = cardOf(
      entry({
        coverage: {
          covered: [covered('白菜', '2026-09-22'), covered('にんじん', '2026-09-22')],
          missing: [],
        },
      }),
    );

    expect(card.usedIngredients.map((used) => used.name)).toEqual(['白菜', 'にんじん']);
  });

  it('使う在庫を3件までに絞る', () => {
    // カードに材料を全部並べると縦に伸び、3件を見比べられなくなる（D-4）。
    const card = cardOf(
      entry({
        coverage: {
          covered: [
            covered('豚こま肉', '2026-09-20'),
            covered('白菜', '2026-09-21'),
            covered('にんじん', '2026-09-22'),
            covered('玉ねぎ', '2026-09-23'),
          ],
          missing: [],
        },
      }),
    );

    expect(card.usedIngredients.map((used) => used.name)).toEqual(['豚こま肉', '白菜', 'にんじん']);
  });

  it('期限が基準日と同じ在庫にだけ、今日の印を付ける', () => {
    // 色だけに頼らない（NFR-17 / D-4）。**印を付けるのは基準日と同じ期限のものだけ**である。
    const card = cardOf(
      entry({
        coverage: {
          covered: [
            covered('豚こま肉', TODAY),
            covered('白菜', '2026-09-22'),
            covered('にんじん', null),
          ],
          missing: [],
        },
      }),
    );

    expect(card.usedIngredients).toEqual([
      { name: '豚こま肉', expiringToday: true },
      { name: '白菜', expiringToday: false },
      { name: 'にんじん', expiringToday: false },
    ]);
  });

  it('賄える主材料が1件も無ければ、使う在庫を1件も出さない', () => {
    const card = cardOf(entry({ coverage: { covered: [], missing: [missing('白菜')] } }));

    expect(card.usedIngredients).toEqual([]);
  });

  it('再利用にだけ印を付ける', () => {
    // 両方に付けると印が背景になって消える（FR-35 / D-3）。
    expect(cardOf(entry({ origin: 'reused' })).reused).toBe(true);
    expect(cardOf(entry({ origin: 'generated' })).reused).toBe(false);
  });

  it('渡された提案の1件を、渡された順にカードにする', () => {
    // 並びは提案の側が決めたままである。画面で並べ替えない（C-12）。
    const cards = mealCardsOf(
      [
        entry({ mealId: 'meal-1', title: '生姜焼き' }),
        entry({ mealId: 'meal-2', title: '炒めもの' }),
      ],
      TODAY,
    );

    expect(cards.map((card) => card.mealId)).toEqual(['meal-1', 'meal-2']);
    expect(cards.map((card) => card.title)).toEqual(['生姜焼き', '炒めもの']);
  });
});
