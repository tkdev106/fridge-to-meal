import { describe, expect, it } from 'vitest';
import type { StockItemDto } from '@fridge-to-meal/contract';
import { showLatestSuggestion } from '../../../../src/contexts/meal/usecase/ShowLatestSuggestion.js';
import type { Meal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { createMeal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import type { Suggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import { createSuggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import { createCookingRecord } from '../../../../src/contexts/meal/domain/value/CookingRecord.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { createPantrySnapshot } from '../../../../src/contexts/meal/domain/value/PantrySnapshot.js';
import type { StockItem } from '../../../../src/contexts/meal/domain/value/StockItem.js';
import { createStockItem } from '../../../../src/contexts/meal/domain/value/StockItem.js';
import { createSuggestionEntry } from '../../../../src/contexts/meal/domain/value/SuggestionEntry.js';
import { suggestionIdOf } from '../../../../src/contexts/meal/domain/value/SuggestionId.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { expiryDateOf } from '../../../../src/contexts/meal/domain/value/ExpiryDate.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { FixedListStockItems } from '../../../support/pantry/FixedStockItemUsecases.js';
import { InMemoryMealRepository } from '../../../support/meal/InMemoryMealRepository.js';
import { InMemorySuggestionRepository } from '../../../support/meal/InMemorySuggestionRepository.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** 提案の識別子。本題でないので番号で配る。 */
let suggestionSequence = 0;
function nextSuggestionId() {
  suggestionSequence += 1;
  return `66666666-6666-4666-8666-${String(suggestionSequence).padStart(12, '0')}`;
}

/** 在庫品の識別子。在庫品の識別子は提案には出てこない（ADR-037）。 */
let stockItemSequence = 0;
function stockItem(props: {
  name: string;
  amount?: string | null;
  expiryDate?: string | null;
  useForMeals?: boolean;
}): StockItemDto {
  stockItemSequence += 1;
  return {
    id: `00000000-0000-4000-8000-${String(stockItemSequence).padStart(12, '0')}`,
    name: props.name,
    ingredientId: null,
    amount: props.amount ?? null,
    expiryDate: props.expiryDate ?? null,
    useForMeals: props.useForMeals ?? true,
  };
}

/** 在庫スナップショットに入れる献立側の在庫品。持つのは名称・分量・期限の3項目（ADR-037）。 */
function mealStockItem(props: {
  name: string;
  amount?: string | null;
  expiryDate?: string | null;
}): StockItem {
  return createStockItem({
    name: props.name,
    amount: amountOf(props.amount ?? null),
    expiryDate: expiryDateOf(props.expiryDate ?? null),
  });
}

function mainIngredient(name: string) {
  return createMealIngredient({ name, kind: 'main', amount: null });
}

function meal(overrides: Partial<Parameters<typeof createMeal>[0]> = {}): Meal {
  return createMeal({
    id: mealIdOf(idA),
    householdId: ourHousehold,
    title: '肉じゃが',
    ingredients: [mainIngredient('にんじん')],
    steps: [cookingStepOf('煮る')],
    generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
    cookingRecords: [],
    ...overrides,
  });
}

function storedSuggestion(props: {
  mealIds: readonly string[];
  householdId?: HouseholdId;
  generatedAt?: string;
  pantrySnapshot?: readonly StockItem[];
}): Suggestion {
  return createSuggestion({
    id: suggestionIdOf(nextSuggestionId()),
    householdId: props.householdId ?? ourHousehold,
    entries: props.mealIds.map((mealId) =>
      createSuggestionEntry({ mealId: mealIdOf(mealId), origin: 'reused' }),
    ),
    pantrySnapshot: createPantrySnapshot({ stockItems: props.pantrySnapshot ?? [] }),
    generatedAt: dateTimeOf(props.generatedAt ?? '2026-09-13T12:00:00Z'),
  });
}

/**
 * 本題でない結線を隠す（`docs/testing.md` 6章）。**保存済みの提案は `save` で置く** —
 * リポジトリの代役に別の口を足さず、本物と同じ入口から積む。
 */
async function setUp(props: {
  suggestions?: readonly Suggestion[];
  meals?: readonly Meal[];
  stockItems?: readonly StockItemDto[];
  listStockItemsThrows?: Error;
  findLatestThrows?: Error;
}) {
  const suggestionRepository = new InMemorySuggestionRepository(
    props.findLatestThrows === undefined ? {} : { findLatestThrows: props.findLatestThrows },
  );
  for (const suggestion of props.suggestions ?? []) {
    await suggestionRepository.save(suggestion.householdId, suggestion);
  }

  const mealRepository = new InMemoryMealRepository(...(props.meals ?? []));
  const listStockItems = new FixedListStockItems(
    props.listStockItemsThrows === undefined
      ? { returns: { stockItems: [...(props.stockItems ?? [])] } }
      : { throws: props.listStockItemsThrows },
  );

  return {
    show: showLatestSuggestion({
      listStockItems: listStockItems.list,
      mealRepository,
      suggestionRepository,
    }),
    listStockItems,
    suggestionRepository,
  };
}

describe('保存済みの提案を返す ShowLatestSuggestion', () => {
  describe('提案が1件も無いとき', () => {
    it('提案が無い結末を返す', async () => {
      const { show } = await setUp({});

      await expect(show(ourHousehold)).resolves.toEqual({ outcome: 'none' });
    });

    it('在庫を引かない', async () => {
      // 何も生成していない世帯で、使わない読みを出さない。
      const { show, listStockItems } = await setUp({});

      await show(ourHousehold);

      expect(listStockItems.callCount).toBe(0);
    });

    it('他世帯の提案しか無ければ提案が無い結末を返す', async () => {
      // C-9: 世帯をまたいで提案を見せない。
      const { show } = await setUp({
        suggestions: [storedSuggestion({ mealIds: [idA], householdId: neighborHousehold })],
        meals: [meal()],
      });

      await expect(show(ourHousehold)).resolves.toEqual({ outcome: 'none' });
    });
  });

  describe('保存済みの提案があるとき', () => {
    it('提案の1件を献立の中身つきで返す', async () => {
      const { show } = await setUp({
        suggestions: [storedSuggestion({ mealIds: [idA] })],
        meals: [meal({ title: '肉じゃが', ingredients: [mainIngredient('にんじん')] })],
        stockItems: [stockItem({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' })],
      });

      const output = await show(ourHousehold);

      expect(output.outcome).toBe('suggested');
      if (output.outcome !== 'suggested') return;
      expect(output.suggestion.entries).toEqual([
        {
          mealId: idA,
          origin: 'reused',
          title: '肉じゃが',
          ingredients: [{ name: 'にんじん', kind: 'main', amount: null }],
          steps: ['煮る'],
          coverage: {
            covered: [{ name: 'にんじん', kind: 'main', amount: null, expiryDate: '2026-09-20' }],
            missing: [],
          },
        },
      ]);
    });

    it('生成日時が最も新しい1件を返す', async () => {
      // ADR-038 の並びの先頭。古いほうを返したら、画面が前回でなく前々回を出すことになる。
      const { show } = await setUp({
        suggestions: [
          storedSuggestion({ mealIds: [idA], generatedAt: '2026-09-13T12:00:00Z' }),
          storedSuggestion({ mealIds: [idB], generatedAt: '2026-09-14T12:00:00Z' }),
        ],
        meals: [meal({ id: mealIdOf(idA) }), meal({ id: mealIdOf(idB), title: 'きんぴら' })],
      });

      const output = await show(ourHousehold);

      if (output.outcome !== 'suggested') throw new Error('提案が返らなかった');
      expect(output.suggestion.entries.map((entry) => entry.mealId)).toEqual([idB]);
    });

    it('他世帯の新しい提案があっても自世帯の提案を返す', async () => {
      const { show } = await setUp({
        suggestions: [
          storedSuggestion({ mealIds: [idA], generatedAt: '2026-09-13T12:00:00Z' }),
          storedSuggestion({
            mealIds: [idB],
            householdId: neighborHousehold,
            generatedAt: '2026-09-14T12:00:00Z',
          }),
        ],
        meals: [meal({ id: mealIdOf(idA) })],
      });

      const output = await show(ourHousehold);

      if (output.outcome !== 'suggested') throw new Error('提案が返らなかった');
      expect(output.suggestion.entries.map((entry) => entry.mealId)).toEqual([idA]);
    });

    it('充足は保存時ではなく現在の在庫で算出する', async () => {
      // FR-32 / ADR-009: 保存されているのは提案と献立であって充足ではない。
      // スナップショットには `にんじん` があるが、今の在庫には無い。
      const { show } = await setUp({
        suggestions: [
          storedSuggestion({
            mealIds: [idA],
            pantrySnapshot: [mealStockItem({ name: 'にんじん' })],
          }),
        ],
        meals: [meal({ ingredients: [mainIngredient('にんじん')] })],
        stockItems: [],
      });

      const output = await show(ourHousehold);

      if (output.outcome !== 'suggested') throw new Error('提案が返らなかった');
      expect(output.suggestion.entries[0]?.coverage).toEqual({
        covered: [],
        missing: [{ name: 'にんじん', kind: 'main', amount: null }],
      });
    });

    it('献立に使わない在庫品の名称の主材料も、充足では賄える材料に載る', async () => {
      // FR-32 / FR-43 / 設計書 規則10: 充足は献立に使うかどうかで濾す前の在庫の全件で算出する。
      const { show } = await setUp({
        suggestions: [storedSuggestion({ mealIds: [idA] })],
        meals: [meal({ ingredients: [mainIngredient('にんじん')] })],
        stockItems: [stockItem({ name: 'にんじん', useForMeals: false })],
      });

      const output = await show(ourHousehold);

      if (output.outcome !== 'suggested') throw new Error('提案が返らなかった');
      expect(
        output.suggestion.entries[0]?.coverage.covered.map((ingredient) => ingredient.name),
      ).toEqual(['にんじん']);
    });

    it('提案を1件も足さない', async () => {
      // 読み取り専用の経路である。呼んだだけで提案が増えれば、次に引く最新が入れ替わる。
      const { show, suggestionRepository } = await setUp({
        suggestions: [storedSuggestion({ mealIds: [idA] })],
        meals: [meal()],
      });

      await show(ourHousehold);

      const stored = await suggestionRepository.findRecentByHousehold(ourHousehold, 10);
      expect(stored).toHaveLength(1);
    });

    it('保存済みの提案を読むとき、調理記録のある献立でも提案の1件に cooked を載せない', async () => {
      // B-53b 規則3 / ADR-070 決定1: 調理記録の有無は献立詳細の出力にだけ載る。
      const { show } = await setUp({
        suggestions: [storedSuggestion({ mealIds: [idA] })],
        meals: [
          meal({
            cookingRecords: [createCookingRecord({ cookedAt: dateTimeOf('2026-09-20T10:00:00Z') })],
          }),
        ],
      });

      const output = await show(ourHousehold);

      if (output.outcome !== 'suggested') throw new Error('提案が返らなかった');
      expect('cooked' in (output.suggestion.entries[0] ?? {})).toBe(false);
    });
  });

  describe('在庫が提案のときから変わったか', () => {
    it('在庫がスナップショットと同じなら変わっていないと読む', async () => {
      const { show } = await setUp({
        suggestions: [
          storedSuggestion({
            mealIds: [idA],
            pantrySnapshot: [mealStockItem({ name: 'にんじん', amount: '1本' })],
          }),
        ],
        meals: [meal()],
        stockItems: [stockItem({ name: 'にんじん', amount: '1本' })],
      });

      const output = await show(ourHousehold);

      if (output.outcome !== 'suggested') throw new Error('提案が返らなかった');
      expect(output.pantryChanged).toBe(false);
    });

    it('在庫が1件増えていれば変わったと読む', async () => {
      const { show } = await setUp({
        suggestions: [
          storedSuggestion({
            mealIds: [idA],
            pantrySnapshot: [mealStockItem({ name: 'にんじん', amount: '1本' })],
          }),
        ],
        meals: [meal()],
        stockItems: [
          stockItem({ name: 'にんじん', amount: '1本' }),
          stockItem({ name: 'たまねぎ' }),
        ],
      });

      const output = await show(ourHousehold);

      if (output.outcome !== 'suggested') throw new Error('提案が返らなかった');
      expect(output.pantryChanged).toBe(true);
    });

    it('献立に使わない在庫品が増えただけなら変わっていないと読む', async () => {
      // C-7 / ADR-086 / 設計書 規則10: 比べる現在の在庫は献立に使う在庫品だけである。
      const { show } = await setUp({
        suggestions: [
          storedSuggestion({
            mealIds: [idA],
            pantrySnapshot: [mealStockItem({ name: 'にんじん', amount: '1本' })],
          }),
        ],
        meals: [meal()],
        stockItems: [
          stockItem({ name: 'にんじん', amount: '1本' }),
          stockItem({ name: 'ヨーグルト', useForMeals: false }),
        ],
      });

      const output = await show(ourHousehold);

      if (output.outcome !== 'suggested') throw new Error('提案が返らなかった');
      expect(output.pantryChanged).toBe(false);
    });

    it('提案のときに使っていた在庫品を献立に使わないに切り替えたら変わったと読む', async () => {
      // C-7 / ADR-086 / 設計書 規則10: 切り替えれば献立に使う在庫品が変わる。
      const { show } = await setUp({
        suggestions: [
          storedSuggestion({
            mealIds: [idA],
            pantrySnapshot: [
              mealStockItem({ name: 'にんじん', amount: '1本' }),
              mealStockItem({ name: 'たまねぎ' }),
            ],
          }),
        ],
        meals: [meal()],
        stockItems: [
          stockItem({ name: 'にんじん', amount: '1本' }),
          stockItem({ name: 'たまねぎ', useForMeals: false }),
        ],
      });

      const output = await show(ourHousehold);

      if (output.outcome !== 'suggested') throw new Error('提案が返らなかった');
      expect(output.pantryChanged).toBe(true);
    });

    it('在庫品の識別子だけが違っても変わっていないと読む', async () => {
      // ADR-037 決定2: 比べるのは名称・分量・期限の3つ組であって識別子ではない。
      const { show } = await setUp({
        suggestions: [
          storedSuggestion({
            mealIds: [idA],
            pantrySnapshot: [mealStockItem({ name: 'にんじん', expiryDate: '2026-09-20' })],
          }),
        ],
        meals: [meal()],
        stockItems: [stockItem({ name: 'にんじん', expiryDate: '2026-09-20' })],
      });

      const output = await show(ourHousehold);

      if (output.outcome !== 'suggested') throw new Error('提案が返らなかった');
      expect(output.pantryChanged).toBe(false);
    });
  });

  describe('失敗を握りつぶさない', () => {
    it('提案の取得が失敗したらそのまま伝える', async () => {
      const { show } = await setUp({ findLatestThrows: new Error('接続が切れた') });

      await expect(show(ourHousehold)).rejects.toThrow('接続が切れた');
    });

    it('在庫の取得が失敗したらそのまま伝える', async () => {
      const { show } = await setUp({
        suggestions: [storedSuggestion({ mealIds: [idA] })],
        meals: [meal()],
        listStockItemsThrows: new Error('在庫が引けない'),
      });

      await expect(show(ourHousehold)).rejects.toThrow('在庫が引けない');
    });

    it('提案の指す献立が引けなければ断る', async () => {
      // ADR-061: 指す献立が引けなければ提案を返さず素の Error で断る。
      const { show } = await setUp({
        suggestions: [storedSuggestion({ mealIds: [idB] })],
        meals: [meal({ id: mealIdOf(idA) })],
      });

      await expect(show(ourHousehold)).rejects.toThrow(Error);
    });
  });
});
