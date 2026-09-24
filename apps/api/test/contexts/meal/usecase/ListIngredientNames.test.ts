import { describe, expect, it } from 'vitest';
import type { StockItemDto } from '@fridge-to-meal/contract';
import { listIngredientNames } from '../../../../src/contexts/meal/usecase/ListIngredientNames.js';
import type { Meal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { createMeal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import type { MealRepository } from '../../../../src/contexts/meal/domain/repository/MealRepository.js';
import type { MealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { FixedListStockItems } from '../../../support/pantry/FixedStockItemUsecases.js';
import { InMemoryMealRepository } from '../../../support/meal/InMemoryMealRepository.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

/** 本題が識別子でないときの採番。名称の列に識別子は出てこない。 */
let sequence = 0;
function nextId() {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

/** 在庫の一覧が返す在庫品1件。本題は名称と期限だけである（`docs/testing.md` 6章）。 */
function stockItem(name: string, expiryDate: string | null = null): StockItemDto {
  return { id: nextId(), name, ingredientId: null, amount: null, expiryDate };
}

/** 主材料。補完に出る側（C-16）。 */
function mainIngredient(name: string): MealIngredient {
  return createMealIngredient({ name, kind: 'main', amount: null });
}

/** 調味料。補完に出ない側（prompt-design 論点3 / ADR-063 決定3）。 */
function seasoning(name: string): MealIngredient {
  return createMealIngredient({ name, kind: 'seasoning', amount: null });
}

/**
 * 保存済みの献立1件。本題は材料と世帯だけである。**調味料だけの献立は作れない**（C-16）ので、
 * 調味料を本題にするときも主材料を1件添える。
 */
function meal(props: { ingredients: readonly MealIngredient[]; householdId?: HouseholdId }): Meal {
  return createMeal({
    id: mealIdOf(nextId()),
    householdId: props.householdId ?? ourHousehold,
    title: `献立${sequence}`,
    ingredients: props.ingredients,
    steps: [cookingStepOf('煮る')],
    generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
    cookingRecords: [],
  });
}

/**
 * ユースケースを1つ組む。在庫は `pantry/usecase` の代役から、献立は記憶上のリポジトリから
 * 受け取る（ADR-033 決定2 / ADR-063 決定1）。
 */
function setUp(props: { stockItems?: readonly StockItemDto[]; meals?: readonly Meal[] } = {}) {
  const stockItems = [...(props.stockItems ?? [])];
  const listStockItems = new FixedListStockItems({ returns: { stockItems } });
  const mealRepository = new InMemoryMealRepository(...(props.meals ?? []));
  const list = listIngredientNames({ listStockItems: listStockItems.list, mealRepository });

  return { list, listStockItems, mealRepository, stockItems };
}

describe('listIngredientNames', () => {
  describe('名称の出所（FR-02 / ADR-063）', () => {
    it('在庫品の名称と、保存済みの献立の主材料の名称の両方を返す', async () => {
      const { list } = setUp({
        stockItems: [stockItem('にんじん')],
        meals: [meal({ ingredients: [mainIngredient('豚こま肉')] })],
      });

      const output = await list(ourHousehold);

      expect(output.ingredientNames).toEqual(['にんじん', '豚こま肉']);
    });

    it('在庫品も献立も無い世帯には空の列を返す', async () => {
      const { list } = setUp();

      const output = await list(ourHousehold);

      expect(output.ingredientNames).toEqual([]);
    });

    it('期限切れの在庫品の名称も返す', async () => {
      const { list } = setUp({ stockItems: [stockItem('ほうれん草', '2020-01-01')] });

      const output = await list(ourHousehold);

      expect(output.ingredientNames).toEqual(['ほうれん草']);
    });
  });

  describe('調味料の扱い（prompt-design 論点3 / C-16 / ADR-063 決定3）', () => {
    it('種別が調味料の材料の名称は返さない', async () => {
      const { list } = setUp({
        meals: [meal({ ingredients: [mainIngredient('鶏もも肉'), seasoning('醤油')] })],
      });

      const output = await list(ourHousehold);

      expect(output.ingredientNames).toEqual(['鶏もも肉']);
    });

    it('調味料の材料と同じ名称の在庫品があれば、その名称を返す', async () => {
      const { list } = setUp({
        stockItems: [stockItem('醤油')],
        meals: [meal({ ingredients: [mainIngredient('鶏もも肉'), seasoning('醤油')] })],
      });

      const output = await list(ourHousehold);

      expect(output.ingredientNames).toEqual(['醤油', '鶏もも肉']);
    });

    it('ある献立で調味料、別の献立で主材料の名称は返す', async () => {
      const { list } = setUp({
        meals: [
          meal({ ingredients: [mainIngredient('鶏もも肉'), seasoning('バター')] }),
          meal({ ingredients: [mainIngredient('バター')] }),
        ],
      });

      const output = await list(ourHousehold);

      expect(output.ingredientNames).toEqual(['バター', '鶏もも肉']);
    });
  });

  describe('重複の除き方（C-6 / ADR-063 決定4）', () => {
    it('在庫品と主材料に同じ名称があれば1つにまとめる', async () => {
      const { list } = setUp({
        stockItems: [stockItem('にんじん')],
        meals: [meal({ ingredients: [mainIngredient('にんじん')] })],
      });

      const output = await list(ourHousehold);

      expect(output.ingredientNames).toEqual(['にんじん']);
    });

    it('在庫品どうし・献立どうしで同じ名称も1つにまとめる', async () => {
      const { list } = setUp({
        stockItems: [stockItem('卵'), stockItem('卵')],
        meals: [
          meal({ ingredients: [mainIngredient('豆腐')] }),
          meal({ ingredients: [mainIngredient('豆腐')] }),
        ],
      });

      const output = await list(ourHousehold);

      expect(output.ingredientNames).toEqual(['卵', '豆腐']);
    });

    it('表記の違う名称は畳まず、別々に返す', async () => {
      const { list } = setUp({
        stockItems: [stockItem('豚こま肉'), stockItem('ＡＢＣ'), stockItem('Egg')],
        meals: [
          meal({ ingredients: [mainIngredient('豚こま'), mainIngredient('ABC')] }),
          meal({ ingredients: [mainIngredient('egg')] }),
        ],
      });

      const output = await list(ourHousehold);

      expect(output.ingredientNames).toEqual(['ABC', 'Egg', 'egg', '豚こま', '豚こま肉', 'ＡＢＣ']);
    });
  });

  describe('並び順（ADR-063 決定4）', () => {
    it('名称をコード単位の昇順に並べる', async () => {
      const { list } = setUp({
        stockItems: [stockItem('玉ねぎ'), stockItem('キャベツ'), stockItem('にんじん')],
        meals: [meal({ ingredients: [mainIngredient('いか')] })],
      });

      const output = await list(ourHousehold);

      expect(output.ingredientNames).toEqual(['いか', 'にんじん', 'キャベツ', '玉ねぎ']);
    });

    it('在庫品と献立の並びが違っても、同じ名称の集まりなら同じ列を返す', async () => {
      const first = setUp({
        stockItems: [stockItem('卵'), stockItem('牛乳')],
        meals: [
          meal({ ingredients: [mainIngredient('豆腐')] }),
          meal({ ingredients: [mainIngredient('ねぎ')] }),
        ],
      });
      const second = setUp({
        stockItems: [stockItem('牛乳'), stockItem('卵')],
        meals: [
          meal({ ingredients: [mainIngredient('ねぎ')] }),
          meal({ ingredients: [mainIngredient('豆腐')] }),
        ],
      });

      const firstOutput = await first.list(ourHousehold);
      const secondOutput = await second.list(ourHousehold);

      expect(secondOutput.ingredientNames).toEqual(firstOutput.ingredientNames);
    });

    it('受け取った在庫品の列と献立の列をその場で並べ替えない', async () => {
      const carrot = stockItem('にんじん');
      const egg = stockItem('卵');
      const tofuMeal = meal({ ingredients: [mainIngredient('豆腐')] });
      const leekMeal = meal({ ingredients: [mainIngredient('ねぎ')] });
      const { list, mealRepository, stockItems } = setUp({
        stockItems: [egg, carrot],
        meals: [tofuMeal, leekMeal],
      });

      await list(ourHousehold);

      expect(stockItems).toEqual([egg, carrot]);
      expect(await mealRepository.findByHousehold(ourHousehold)).toEqual([tofuMeal, leekMeal]);
    });
  });

  describe('世帯の分離（C-9）', () => {
    it('在庫の一覧には受け取った世帯を渡す', async () => {
      const { list, listStockItems } = setUp();

      await list(ourHousehold);

      expect(listStockItems.receivedHouseholdId).toBe(ourHousehold);
    });

    it('他の世帯の献立の材料名は返さない', async () => {
      const { list } = setUp({
        meals: [
          meal({ ingredients: [mainIngredient('にんじん')] }),
          meal({ ingredients: [mainIngredient('鮭')], householdId: neighborHousehold }),
        ],
      });

      const output = await list(ourHousehold);

      expect(output.ingredientNames).toEqual(['にんじん']);
    });
  });

  describe('失敗の伝え方', () => {
    it('在庫の一覧が投げた例外をそのまま投げる', async () => {
      const failure = new Error('在庫を読めなかった');
      const listStockItems = new FixedListStockItems({ throws: failure });
      const list = listIngredientNames({
        listStockItems: listStockItems.list,
        mealRepository: new InMemoryMealRepository(),
      });

      await expect(list(ourHousehold)).rejects.toBe(failure);
    });

    it('献立の取得が投げた例外をそのまま投げる', async () => {
      const failure = new Error('献立を読めなかった');
      const failingMealRepository: MealRepository = {
        async findByHousehold() {
          throw failure;
        },
        async findById() {
          throw failure;
        },
        async save() {},
      };
      const list = listIngredientNames({
        listStockItems: new FixedListStockItems({ returns: { stockItems: [] } }).list,
        mealRepository: failingMealRepository,
      });

      await expect(list(ourHousehold)).rejects.toBe(failure);
    });
  });
});
