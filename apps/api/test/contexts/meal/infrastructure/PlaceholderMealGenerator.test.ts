import { describe, expect, it } from 'vitest';
import { PlaceholderMealGenerator } from '../../../../src/contexts/meal/infrastructure/PlaceholderMealGenerator.js';
import type { MealGenerationInput } from '../../../../src/contexts/meal/domain/port/MealGenerator.js';
import type { GeneratedMeal } from '../../../../src/contexts/meal/domain/value/GeneratedMeal.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { createPantrySnapshot } from '../../../../src/contexts/meal/domain/value/PantrySnapshot.js';
import { createStockItem } from '../../../../src/contexts/meal/domain/value/StockItem.js';
import type { StockItem } from '../../../../src/contexts/meal/domain/value/StockItem.js';
import { expiryDateOf } from '../../../../src/contexts/meal/domain/value/ExpiryDate.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { mealCoverageOf } from '../../../../src/contexts/meal/domain/service/MealCoverageService.js';

/** 本題でない分量と期限を隠して在庫品を作る。本題だけが overrides に現れる（`docs/testing.md` 6章）。 */
function stockItem(
  name: string,
  overrides: { amount?: string | null; expiryDate?: string | null } = {},
): StockItem {
  return createStockItem({
    name,
    amount: amountOf(overrides.amount === undefined ? '1個' : overrides.amount),
    expiryDate: expiryDateOf(
      overrides.expiryDate === undefined ? '2026-09-20' : overrides.expiryDate,
    ),
  });
}

/**
 * 本題でない値を隠して入力を作る（先行 `test/contexts/meal/domain/MealGenerator.test.ts` の `input()`）。
 * 在庫品の列だけを本題として受け取る。件数は切られないよう十分に大きく置く（切り方は2周目の本題）。
 */
function input(
  stockItems: readonly StockItem[],
  overrides: Partial<Omit<MealGenerationInput, 'pantrySnapshot'>> = {},
): MealGenerationInput {
  return {
    pantrySnapshot: createPantrySnapshot({ stockItems }),
    requiredCount: 10,
    avoidTitles: [],
    // 基準日時は引数で渡す。現在時刻を読むとテストが決定的でなくなる（`docs/testing.md` 5章）。
    asOf: dateTimeOf('2026-09-14T12:00:00Z'),
    ...overrides,
  };
}

function generate(
  stockItems: readonly StockItem[],
  overrides: Partial<Omit<MealGenerationInput, 'pantrySnapshot'>> = {},
): Promise<readonly GeneratedMeal[]> {
  return new PlaceholderMealGenerator().generate(input(stockItems, overrides));
}

/** 献立ごとの主材料の名称。並びを観察するための射影であって、計算ではない。 */
function mainIngredientNamesOf(generatedMeals: readonly GeneratedMeal[]): string[] {
  return generatedMeals.flatMap((generatedMeal) =>
    generatedMeal.ingredients
      .filter((ingredient) => ingredient.kind === 'main')
      .map((ingredient) => ingredient.name),
  );
}

/** 献立ごとの主材料の分量。 */
function mainIngredientAmountsOf(generatedMeals: readonly GeneratedMeal[]): (string | null)[] {
  return generatedMeals.flatMap((generatedMeal) =>
    generatedMeal.ingredients
      .filter((ingredient) => ingredient.kind === 'main')
      .map((ingredient) => ingredient.amount),
  );
}

/** 主材料の名称で献立を1件引く。見つからなければ `undefined`。 */
function mealWithMainIngredient(
  generatedMeals: readonly GeneratedMeal[],
  name: string,
): GeneratedMeal | undefined {
  return generatedMeals.find((generatedMeal) =>
    generatedMeal.ingredients.some(
      (ingredient) => ingredient.kind === 'main' && ingredient.name === name,
    ),
  );
}

describe('仮の献立生成器 PlaceholderMealGenerator', () => {
  describe('在庫品から献立を組む', () => {
    it('在庫品1件から献立を1件返す', async () => {
      // B-47 規則4: 在庫品1件（名称1つ）から献立1件を作る。
      const generatedMeals = await generate([
        stockItem('にんじん', { amount: '1本', expiryDate: '2026-09-20' }),
      ]);

      expect(generatedMeals.length).toBe(1);
    });

    it('主材料は在庫品の名称と分量をそのまま持つ1件だけである', async () => {
      // B-47 規則4 / D-3 / C-16: 主材料は在庫の名称をそのまま使い、材料はこの1件だけ。
      const generatedMeals = await generate([
        stockItem('豚こま肉', { amount: '200g', expiryDate: '2026-09-20' }),
      ]);

      expect(generatedMeals[0]?.ingredients).toEqual([
        createMealIngredient({ name: '豚こま肉', kind: 'main', amount: amountOf('200g') }),
      ]);
    });

    it('分量のない在庫品からは分量のない主材料を作る', async () => {
      // B-47 規則4: 分量は在庫品のものをそのまま運ぶ。null なら null。
      const generatedMeals = await generate([
        stockItem('卵', { amount: null, expiryDate: '2026-09-20' }),
      ]);

      expect(generatedMeals[0]?.ingredients[0]?.amount).toBeNull();
    });

    it('名称の途中の空白や表記は書き換えずに主材料の名称にする', async () => {
      // B-47 規則4 / C-6: 充足判定は名称の完全一致。再加工すると在庫と一致しなくなる。
      const generatedMeals = await generate([stockItem('キャベツ 1/4')]);

      expect(generatedMeals[0]?.ingredients[0]?.name).toBe('キャベツ 1/4');
    });

    it('返した献立は同じ在庫と突き合わせると不足材料が0件になる', async () => {
      // D-3 / C-6: 仮物でも主材料が在庫の名称そのものなので、充足判定で不足が出ない。
      const generatedMeals = await generate([
        stockItem('にんじん'),
        stockItem('牛肉'),
        stockItem('キャベツ 1/4'),
      ]);

      expect(
        generatedMeals.map(
          (generatedMeal) =>
            mealCoverageOf(generatedMeal.ingredients, ['にんじん', '牛肉', 'キャベツ 1/4']).missing,
        ),
      ).toEqual([[], [], []]);
    });

    it('手順を1件以上持つ', async () => {
      // B-47 規則6 / domain-model 4章: 献立の手順は1件以上。
      const generatedMeals = await generate([stockItem('にんじん')]);

      expect(generatedMeals[0]?.steps.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('期限切れの在庫品', () => {
    it('期限が基準日の前日の在庫品は使わない', async () => {
      // B-47 規則1 / D-5: 期限切れの在庫品を主材料にしない。
      const generatedMeals = await generate([
        stockItem('にんじん', { expiryDate: '2026-09-13' }),
        stockItem('牛肉', { expiryDate: '2026-09-20' }),
      ]);

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['牛肉']);
    });

    it('期限が基準日当日の在庫品は使う', async () => {
      // B-47 規則1 / ADR-040: 当日は期限切れではない。
      const generatedMeals = await generate([stockItem('にんじん', { expiryDate: '2026-09-14' })]);

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['にんじん']);
    });

    it('期限のない在庫品は使う', async () => {
      // B-47 規則1 / FR-13: 期限は任意入力であり、未設定は落とさない。
      const generatedMeals = await generate([stockItem('塩昆布', { expiryDate: null })]);

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['塩昆布']);
    });

    it('期限切れは現在時刻ではなく渡された基準日時で決まる', async () => {
      // B-47 規則11: 時計を読まない。基準日時は input.asOf だけを使う。
      const generatedMeals = await generate([stockItem('にんじん', { expiryDate: '2020-01-01' })], {
        asOf: dateTimeOf('2020-01-01T12:00:00Z'),
      });

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['にんじん']);
    });
  });

  describe('同じ名称の在庫品', () => {
    it('同じ名称の在庫品が複数あっても献立は1件にする', async () => {
      // B-47 規則2 / C-13: 1つの名称から献立は1件。同じ名称が並ぶと提案が1件ぶん無駄になる。
      const generatedMeals = await generate([
        stockItem('卵', { expiryDate: '2026-09-20' }),
        stockItem('卵', { expiryDate: '2026-09-18' }),
      ]);

      expect(generatedMeals.length).toBe(1);
    });

    it('同じ名称の在庫品は期限の近いほうの分量を使う', async () => {
      // B-47 規則2・規則3: 畳むときは並びで先に来る（期限の近い）ほうを残す。
      const generatedMeals = await generate([
        stockItem('卵', { amount: '6個', expiryDate: '2026-09-20' }),
        stockItem('卵', { amount: '10個', expiryDate: '2026-09-16' }),
      ]);

      expect(mainIngredientAmountsOf(generatedMeals)).toEqual(['10個']);
    });

    it('同じ名称の在庫品のうち期限切れのものは畳む相手にしない', async () => {
      // B-47 規則1→規則2: 期限切れを落としてから名称で畳む。
      const generatedMeals = await generate([
        stockItem('卵', { amount: '10個', expiryDate: '2026-09-10' }),
        stockItem('卵', { amount: '6個', expiryDate: '2026-09-20' }),
      ]);

      expect(mainIngredientAmountsOf(generatedMeals)).toEqual(['6個']);
    });

    it('同じ名称・同じ期限の在庫品は並びを入れ替えても同じ分量を使う', async () => {
      // B-47 規則3（第3鍵）: 名称も期限も同じなら分量の code unit 順（'1' < '6'）、分量 null は最後。
      const tenFirst = await generate([
        stockItem('卵', { amount: '10個', expiryDate: '2026-09-20' }),
        stockItem('卵', { amount: '6個', expiryDate: '2026-09-20' }),
      ]);
      const sixFirst = await generate([
        stockItem('卵', { amount: '6個', expiryDate: '2026-09-20' }),
        stockItem('卵', { amount: '10個', expiryDate: '2026-09-20' }),
      ]);
      const nullFirst = await generate([
        stockItem('卵', { amount: null, expiryDate: '2026-09-20' }),
        stockItem('卵', { amount: '6個', expiryDate: '2026-09-20' }),
      ]);
      const nullLast = await generate([
        stockItem('卵', { amount: '6個', expiryDate: '2026-09-20' }),
        stockItem('卵', { amount: null, expiryDate: '2026-09-20' }),
      ]);

      expect([
        mainIngredientAmountsOf(tenFirst),
        mainIngredientAmountsOf(sixFirst),
        mainIngredientAmountsOf(nullFirst),
        mainIngredientAmountsOf(nullLast),
      ]).toEqual([['10個'], ['10個'], ['6個'], ['6個']]);
    });
  });

  describe('献立の並び', () => {
    it('期限の近い在庫品から順に献立を並べる', async () => {
      // B-47 規則3 / FR-18: 期限の近いものを先に使う。
      const generatedMeals = await generate([
        stockItem('牛肉', { expiryDate: '2026-09-20' }),
        stockItem('にんじん', { expiryDate: '2026-09-15' }),
        stockItem('豆腐', { expiryDate: '2026-09-17' }),
      ]);

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['にんじん', '豆腐', '牛肉']);
    });

    it('期限のない在庫品は期限のあるものより後ろに並べる', async () => {
      // B-47 規則3: 期限なしは最後。
      const generatedMeals = await generate([
        stockItem('塩昆布', { expiryDate: null }),
        stockItem('牛肉', { expiryDate: '2026-09-30' }),
      ]);

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['牛肉', '塩昆布']);
    });

    it('期限が同じ在庫品は名称の code unit 順に並べる', async () => {
      // B-47 規則3 / ADR-036 結果8: localeCompare は使わない。'Z'(0x5A) < 'a'(0x61)。
      const generatedMeals = await generate([
        stockItem('apple', { expiryDate: '2026-09-20' }),
        stockItem('Zucchini', { expiryDate: '2026-09-20' }),
      ]);

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['Zucchini', 'apple']);
    });

    it('期限のない在庫品どうしも名称の code unit 順に並べる', async () => {
      // B-47 規則3: 期限なし同士も同順位として名称で並べる。
      const generatedMeals = await generate([
        stockItem('apple', { expiryDate: null }),
        stockItem('Zucchini', { expiryDate: null }),
      ]);

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['Zucchini', 'apple']);
    });

    it('在庫品の並びを入れ替えても同じ結果を返す', async () => {
      // B-47 規則3 / C-12: 同じ在庫の多重集合なら、受け取った列の並びに依らず同じ結果になる。
      const stockItems = [
        stockItem('塩昆布', { amount: '1袋', expiryDate: null }),
        stockItem('梅干し', { amount: null, expiryDate: null }),
        stockItem('apple', { amount: '1個', expiryDate: '2026-09-18' }),
        stockItem('Zucchini', { amount: '2本', expiryDate: '2026-09-18' }),
        stockItem('卵', { amount: '6個', expiryDate: '2026-09-20' }),
        stockItem('卵', { amount: '10個', expiryDate: '2026-09-20' }),
        stockItem('卵', { amount: '3個', expiryDate: '2026-09-25' }),
      ];

      const forward = await generate(stockItems);
      const reversed = await generate([...stockItems].reverse());

      expect(reversed).toEqual(forward);
    });
  });

  describe('決定的であること', () => {
    it('同じ入力には何度呼んでも同じ献立を返す', async () => {
      // B-47 規則5・規則6・規則11 / C-4: 同じ主材料なら同じ名称になり、2度目は既存が参照される。
      const mealGenerator = new PlaceholderMealGenerator();
      const sameInput = input([stockItem('にんじん'), stockItem('牛肉')]);

      const first = await mealGenerator.generate(sameInput);
      const second = await mealGenerator.generate(sameInput);

      expect(second).toEqual(first);
    });

    it('間に別の在庫で呼んでも同じ入力には同じ献立を返す', async () => {
      // B-47 規則11: 状態を持たない。前の呼び出しが次の結果に響かない。
      const mealGenerator = new PlaceholderMealGenerator();
      const inputA = input([stockItem('にんじん'), stockItem('牛肉')]);
      const inputB = input([stockItem('豆腐'), stockItem('キャベツ 1/4')]);

      const first = await mealGenerator.generate(inputA);
      await mealGenerator.generate(inputB);
      const third = await mealGenerator.generate(inputA);

      expect(third).toEqual(first);
    });
  });

  describe('献立の名称', () => {
    it('名称は主材料が同じなら分量・期限・ほかの在庫に依らず同じになる', async () => {
      // B-47 規則5 / C-4: 名称は主材料の名称だけから一意に決まる。
      const fromA = await generate([
        stockItem('にんじん', { amount: '1本', expiryDate: '2026-09-20' }),
      ]);
      const fromB = await generate([
        stockItem('にんじん', { amount: '3本', expiryDate: '2026-09-15' }),
        stockItem('牛肉'),
      ]);

      const titleFromA = mealWithMainIngredient(fromA, 'にんじん')?.title;
      expect(titleFromA).toEqual(expect.any(String));
      expect(mealWithMainIngredient(fromB, 'にんじん')?.title).toBe(titleFromA);
    });

    it('主材料の名称が違えば献立の名称も違う', async () => {
      // B-47 規則5・規則9 / C-13: 同じ名称の献立を2件以上返さない。
      const generatedMeals = await generate([stockItem('にんじん'), stockItem('牛肉')]);

      expect(new Set(generatedMeals.map((generatedMeal) => generatedMeal.title)).size).toBe(2);
    });

    it('名称は仮であることが読める決まった書式に主材料の名称を埋めたものである', async () => {
      // B-47 規則5 / ADR-060 決定4: 書式は「仮の献立（{名称}）」でこの周に確定した。
      const generatedMeals = await generate([stockItem('にんじん')]);

      expect(generatedMeals[0]?.title).toBe('仮の献立（にんじん）');
    });
  });

  describe('使える在庫品が無いとき', () => {
    it('在庫が0件なら mealGenerator.empty で断る', async () => {
      // B-47 7章 / B-15 規則5: 空の列を返さず、規則違反で断る。
      await expect(generate([])).rejects.toThrow(MealRuleViolation);
      await expect(generate([])).rejects.toMatchObject({ rule: 'mealGenerator.empty' });
    });

    it('在庫が全件期限切れなら mealGenerator.empty で断る', async () => {
      // B-47 7章 / D-5: 期限切れを落とした結果が0件なら、在庫0件と同じく断る。
      const stockItems = [
        stockItem('にんじん', { expiryDate: '2026-09-13' }),
        stockItem('牛肉', { expiryDate: '2026-09-01' }),
      ];

      await expect(generate(stockItems)).rejects.toThrow(MealRuleViolation);
      await expect(generate(stockItems)).rejects.toMatchObject({ rule: 'mealGenerator.empty' });
    });
  });

  describe('件数の切り方', () => {
    it('使える在庫の名称が requiredCount より多ければ、期限の近い順の先頭から requiredCount 件を返す', async () => {
      // B-47 規則8 / prompt-design 6.4: 並びの先頭から requiredCount 件で切る。
      const generatedMeals = await generate(
        [
          stockItem('d', { expiryDate: '2026-09-18' }),
          stockItem('c', { expiryDate: '2026-09-17' }),
          stockItem('b', { expiryDate: '2026-09-16' }),
          stockItem('a', { expiryDate: '2026-09-15' }),
        ],
        { requiredCount: 2 },
      );

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['a', 'b']);
    });

    it('requiredCount が1なら期限の最も近い献立を1件だけ返す', async () => {
      // B-47 規則8: 1件だけを求められたら先頭の1件。
      const generatedMeals = await generate(
        [
          stockItem('にんじん', { expiryDate: '2026-09-15' }),
          stockItem('牛肉', { expiryDate: '2026-09-20' }),
        ],
        { requiredCount: 1 },
      );

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['にんじん']);
    });

    it('同じ名称の在庫品を1件に畳んでから requiredCount 件を数える', async () => {
      // B-47 規則2→規則8: 畳む前に数えると同じ名称で枠が埋まる。
      const generatedMeals = await generate(
        [
          stockItem('卵', { expiryDate: '2026-09-15' }),
          stockItem('卵', { expiryDate: '2026-09-16' }),
          stockItem('にんじん', { expiryDate: '2026-09-17' }),
          stockItem('牛肉', { expiryDate: '2026-09-18' }),
        ],
        { requiredCount: 3 },
      );

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['卵', 'にんじん', '牛肉']);
    });

    it('期限切れの在庫品は requiredCount の件数に数えない', async () => {
      // B-47 規則1→規則8: 期限切れを落としてから数える。
      const generatedMeals = await generate(
        [
          stockItem('にんじん', { expiryDate: '2026-09-13' }),
          stockItem('牛肉', { expiryDate: '2026-09-15' }),
          stockItem('豆腐', { expiryDate: '2026-09-16' }),
        ],
        { requiredCount: 2 },
      );

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['牛肉', '豆腐']);
    });
  });

  describe('避ける名称', () => {
    it('避ける名称の献立は、避けない献立より後ろに回す', async () => {
      // B-47 規則7 / ADR-021: 避ける名称は落とさず後ろへ回す。
      const generatedMeals = await generate(
        [
          stockItem('にんじん', { expiryDate: '2026-09-15' }),
          stockItem('牛肉', { expiryDate: '2026-09-20' }),
        ],
        { avoidTitles: ['仮の献立（にんじん）'] },
      );

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['牛肉', 'にんじん']);
    });

    it('全件が避ける名称でも献立を落とさず、期限の近い順に返す', async () => {
      // B-47 規則7 / FR-36: 全件が避ける名称でも0件にしない。avoidTitles の並びは効かない。
      const generatedMeals = await generate(
        [
          stockItem('にんじん', { expiryDate: '2026-09-15' }),
          stockItem('牛肉', { expiryDate: '2026-09-20' }),
        ],
        { avoidTitles: ['仮の献立（牛肉）', '仮の献立（にんじん）'] },
      );

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['にんじん', '牛肉']);
    });

    it('避けない献立どうしと避ける献立どうしは、それぞれの内側で期限の近い順に並べる', async () => {
      // B-47 規則7・規則3: 2つの群の内側は規則3の並びのまま。avoidTitles の並びは効かない。
      const generatedMeals = await generate(
        [
          stockItem('d', { expiryDate: '2026-09-18' }),
          stockItem('c', { expiryDate: '2026-09-17' }),
          stockItem('b', { expiryDate: '2026-09-16' }),
          stockItem('a', { expiryDate: '2026-09-15' }),
        ],
        { avoidTitles: ['仮の献立（c）', '仮の献立（a）'] },
      );

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['b', 'd', 'a', 'c']);
    });

    it('避ける名称は献立の名称と完全に一致するものにだけ効く', async () => {
      // B-47 規則7・規則5: 避けるのは献立の名称であって、主材料の名称ではない。
      const generatedMeals = await generate(
        [
          stockItem('にんじん', { expiryDate: '2026-09-15' }),
          stockItem('牛肉', { expiryDate: '2026-09-20' }),
        ],
        { avoidTitles: ['にんじん'] },
      );

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['にんじん', '牛肉']);
    });

    it('避けない献立が requiredCount 件以上あれば、避ける名称の献立は返さない', async () => {
      // B-47 規則7→規則8: 後ろへ回してから切るので、避ける名称は枠からこぼれる。
      const generatedMeals = await generate(
        [
          stockItem('a', { expiryDate: '2026-09-15' }),
          stockItem('b', { expiryDate: '2026-09-16' }),
          stockItem('c', { expiryDate: '2026-09-17' }),
        ],
        { avoidTitles: ['仮の献立（a）'], requiredCount: 2 },
      );

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['b', 'c']);
    });

    it('避けない献立が requiredCount に満たなければ、足りない分だけ避ける名称の献立で埋める', async () => {
      // B-47 規則7→規則8 / prompt-design 6.4: 避ける名称で枠を埋め、件数を減らさない。
      const generatedMeals = await generate(
        [
          stockItem('a', { expiryDate: '2026-09-15' }),
          stockItem('b', { expiryDate: '2026-09-16' }),
          stockItem('c', { expiryDate: '2026-09-17' }),
        ],
        { avoidTitles: ['仮の献立（a）', '仮の献立（b）'], requiredCount: 2 },
      );

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['c', 'a']);
    });

    it('全件が避ける名称で requiredCount が1なら、期限の最も近い献立を1件返す', async () => {
      // B-47 規則7・規則8: 全件が避ける名称でも0件にせず、先頭の1件を返す。
      const generatedMeals = await generate(
        [
          stockItem('にんじん', { expiryDate: '2026-09-15' }),
          stockItem('牛肉', { expiryDate: '2026-09-20' }),
        ],
        { avoidTitles: ['仮の献立（にんじん）', '仮の献立（牛肉）'], requiredCount: 1 },
      );

      expect(mainIngredientNamesOf(generatedMeals)).toEqual(['にんじん']);
    });
  });
});
