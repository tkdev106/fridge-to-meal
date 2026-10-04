import { describe, expect, it } from 'vitest';
import type { DeleteUser } from '../../../../src/contexts/identity/usecase/DeleteUser.js';
import { deleteUser } from '../../../../src/contexts/identity/usecase/DeleteUser.js';
import { deleteHouseholdData } from '../../../../src/contexts/meal/usecase/DeleteHouseholdData.js';
import type { Meal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { createMeal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import type { Suggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import { createSuggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import type { MealRepository } from '../../../../src/contexts/meal/domain/repository/MealRepository.js';
import type { SuggestionRepository } from '../../../../src/contexts/meal/domain/repository/SuggestionRepository.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import { createPantrySnapshot } from '../../../../src/contexts/meal/domain/value/PantrySnapshot.js';
import { createSuggestionEntry } from '../../../../src/contexts/meal/domain/value/SuggestionEntry.js';
import { suggestionIdOf } from '../../../../src/contexts/meal/domain/value/SuggestionId.js';
import type { StockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { createStockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { expiryDateOf } from '../../../../src/contexts/pantry/domain/value/ExpiryDate.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import { deleteHouseholdStockItems } from '../../../../src/contexts/pantry/usecase/DeleteHouseholdStockItems.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryUserDeleter } from '../../../support/identity/InMemoryUserDeleter.js';
import { InMemoryMealRepository } from '../../../support/meal/InMemoryMealRepository.js';
import { InMemorySuggestionRepository } from '../../../support/meal/InMemorySuggestionRepository.js';
import { InMemoryStockItemRepository } from '../../../support/pantry/InMemoryStockItemRepository.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

const ourMealId = '22222222-2222-4222-8222-222222222222';
const neighborMealId = '33333333-3333-4333-8333-333333333333';
const ourSuggestionId = '44444444-4444-4444-8444-444444444444';
const neighborSuggestionId = '55555555-5555-4555-8555-555555555555';
const ourStockItemId = '66666666-6666-4666-8666-666666666666';
const neighborStockItemId = '77777777-7777-4777-8777-777777777777';

/** 保存済みの献立1件。本題は識別子と世帯だけである（`docs/testing.md` 6章）。 */
function meal(props: { id: string; householdId: HouseholdId }): Meal {
  return createMeal({
    id: mealIdOf(props.id),
    householdId: props.householdId,
    title: '肉じゃが',
    ingredients: [createMealIngredient({ name: 'じゃがいも', kind: 'main', amount: null })],
    steps: [cookingStepOf('煮る')],
    generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
    cookingRecords: [],
  });
}

/** 保存済みの提案1件。本題は識別子と世帯だけである。 */
function suggestion(props: { id: string; householdId: HouseholdId; mealId: string }): Suggestion {
  return createSuggestion({
    id: suggestionIdOf(props.id),
    householdId: props.householdId,
    entries: [createSuggestionEntry({ mealId: mealIdOf(props.mealId), origin: 'generated' })],
    pantrySnapshot: createPantrySnapshot({ stockItems: [] }),
    generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
  });
}

/** 在庫品1件。本題は識別子と世帯だけである。 */
function stockItem(props: { id: string; householdId: HouseholdId; name: string }): StockItem {
  return createStockItem({
    id: stockItemIdOf(props.id),
    householdId: props.householdId,
    name: props.name,
    ingredientId: null,
    amount: null,
    expiryDate: expiryDateOf(null),
    useForMeals: true,
  });
}

/**
 * 2世帯ぶんの献立・提案・在庫品を1件ずつと利用者を置き、ユースケースを1つ組む。在庫の口と
 * 利用者の口は、それぞれ `pantry/usecase` と `identity/usecase` の本物を記憶上の実装で組んで
 * 関数として渡す（ADR-033 決定2 / ADR-072 決定1 / B-56d 設計書 5章）。`empty` なら利用者も置かない。
 */
async function setUp(props: { empty?: boolean } = {}) {
  const mealRepository = new InMemoryMealRepository();
  const suggestionRepository = new InMemorySuggestionRepository();
  const stockItemRepository = new InMemoryStockItemRepository();
  const userDeleter =
    props.empty === true
      ? new InMemoryUserDeleter()
      : new InMemoryUserDeleter(ourHousehold, neighborHousehold);

  if (props.empty !== true) {
    for (const [householdId, mealId, suggestionId, stockItemId, name] of [
      [ourHousehold, ourMealId, ourSuggestionId, ourStockItemId, 'にんじん'],
      [neighborHousehold, neighborMealId, neighborSuggestionId, neighborStockItemId, 'れんこん'],
    ] as const) {
      await mealRepository.save(householdId, meal({ id: mealId, householdId }));
      await suggestionRepository.save(
        householdId,
        suggestion({ id: suggestionId, householdId, mealId }),
      );
      await stockItemRepository.save(
        householdId,
        stockItem({ id: stockItemId, householdId, name }),
      );
    }
  }

  const runDelete = deleteHouseholdData({
    deleteHouseholdStockItems: deleteHouseholdStockItems({ stockItemRepository }),
    deleteUser: deleteUser({ userDeleter }),
    mealRepository,
    suggestionRepository,
  });

  return { runDelete, mealRepository, suggestionRepository, stockItemRepository, userDeleter };
}

/** 本題の口だけを差し替え、残りは空の記憶上の実装で組む。失敗の伝え方を見るときに使う。 */
function runDeleteWith(overrides: {
  deleteHouseholdStockItems?: (householdId: HouseholdId) => Promise<void>;
  deleteUser?: DeleteUser;
  mealRepository?: MealRepository;
  suggestionRepository?: SuggestionRepository;
}) {
  return deleteHouseholdData({
    deleteHouseholdStockItems:
      overrides.deleteHouseholdStockItems ??
      deleteHouseholdStockItems({ stockItemRepository: new InMemoryStockItemRepository() }),
    deleteUser: overrides.deleteUser ?? deleteUser({ userDeleter: new InMemoryUserDeleter() }),
    mealRepository: overrides.mealRepository ?? new InMemoryMealRepository(),
    suggestionRepository: overrides.suggestionRepository ?? new InMemorySuggestionRepository(),
  });
}

/** deps の形。基準日時・生成器・採番の口を取らないことを型として主張するために取り出す。 */
type DeleteHouseholdDataDeps = Parameters<typeof deleteHouseholdData>[0];

/**
 * deps のキーが4つだけなら `true`、1つでも他のキーがあれば `never`。
 * `never` になると下の代入が型検査で落ちる（先行 `MealListRoutes.test.ts`）。
 */
type DepsTakeNeitherClockNorGeneratorNorIdPort = keyof DeleteHouseholdDataDeps extends
  'deleteHouseholdStockItems' | 'deleteUser' | 'mealRepository' | 'suggestionRepository'
  ? true
  : never;

describe('deleteHouseholdData', () => {
  describe('消えるもの（FR-27 / NFR-13）', () => {
    it('世帯のデータを消すと、その世帯の献立は1件も引けなくなる', async () => {
      // B-56a 規則2 / ADR-072 決定3: 世帯の全献立をまとめて消すことは C-3 に当たらない。
      const { runDelete, mealRepository } = await setUp();

      await runDelete(ourHousehold);

      await expect(mealRepository.findByHousehold(ourHousehold)).resolves.toEqual([]);
    });

    it('世帯のデータを消すと、その世帯の最新の提案は無くなる', async () => {
      // B-56a 規則2: 提案と在庫スナップショットも NFR-13 の「生成結果」に当たる。
      const { runDelete, suggestionRepository } = await setUp();

      await runDelete(ourHousehold);

      await expect(suggestionRepository.findLatestByHousehold(ourHousehold)).resolves.toBeNull();
    });

    it('世帯のデータを消すと、その世帯の在庫品も消える', async () => {
      // B-56a 規則2 / ADR-072 決定1: 在庫の側は pantry の口を通して消す。
      const { runDelete, stockItemRepository } = await setUp();

      await runDelete(ourHousehold);

      await expect(stockItemRepository.findByHousehold(ourHousehold)).resolves.toEqual([]);
    });
  });

  describe('世帯の分離（C-9 / NFR-09）', () => {
    it('他の世帯の献立は消えずに残る', async () => {
      // B-56a 規則3・4: 引数の世帯の行だけを消す。
      const { runDelete, mealRepository } = await setUp();

      await runDelete(ourHousehold);

      const neighborMeals = await mealRepository.findByHousehold(neighborHousehold);
      expect(neighborMeals.map((stored) => stored.id)).toEqual([neighborMealId]);
    });

    it('他の世帯の提案は消えずに残る', async () => {
      // B-56a 規則3・4。
      const { runDelete, suggestionRepository } = await setUp();

      await runDelete(ourHousehold);

      const neighborLatest = await suggestionRepository.findLatestByHousehold(neighborHousehold);
      expect(neighborLatest?.id).toBe(neighborSuggestionId);
    });

    it('他の世帯の在庫品は消えずに残る', async () => {
      // B-56a 規則3・4。
      const { runDelete, stockItemRepository } = await setUp();

      await runDelete(ourHousehold);

      const neighborStockItems = await stockItemRepository.findByHousehold(neighborHousehold);
      expect(neighborStockItems.map((stored) => stored.id)).toEqual([neighborStockItemId]);
    });
  });

  describe('利用者も消す（B-56d / FR-27 / ADR-071 決定2）', () => {
    it('世帯のデータを消すと、その世帯の利用者も居なくなる', async () => {
      // B-56d 設計書 規則5 / ADR-071 決定2: データと同じ要求で利用者まで消す。
      const { runDelete, userDeleter } = await setUp();

      await runDelete(ourHousehold);

      expect(userDeleter.has(ourHousehold)).toBe(false);
    });

    it('利用者を消す時点で、その世帯の献立・提案・在庫品はすでに消えている', async () => {
      // B-56d 設計書 規則5: 提案 → 献立 → 在庫 → 利用者の順で、利用者は必ず最後。
      const { mealRepository, suggestionRepository, stockItemRepository } = await setUp();
      let observedAtUserDeletion: unknown = 'まだ呼ばれていない';
      const runDelete = deleteHouseholdData({
        deleteHouseholdStockItems: deleteHouseholdStockItems({ stockItemRepository }),
        deleteUser: async (householdId) => {
          observedAtUserDeletion = {
            meals: await mealRepository.findByHousehold(householdId),
            latestSuggestion: await suggestionRepository.findLatestByHousehold(householdId),
            stockItems: await stockItemRepository.findByHousehold(householdId),
          };
        },
        mealRepository,
        suggestionRepository,
      });

      await runDelete(ourHousehold);

      expect(observedAtUserDeletion).toEqual({ meals: [], latestSuggestion: null, stockItems: [] });
    });
  });

  describe('消す物が無いとき（B-56a 規則7）', () => {
    it('在庫品も献立も提案も無い世帯でも、断らずに何も返さずに終わる', async () => {
      // 規則7: 存在を確かめない。「消えている」状態を求める操作である。
      // 規則7（B-56d）: 利用者が居なくても断らない。
      const { runDelete } = await setUp({ empty: true });

      await expect(runDelete(ourHousehold)).resolves.toBeUndefined();
    });

    it('同じ世帯を続けて2度消しても、2度目も断らずに終わる', async () => {
      // 規則7: 2度目の呼び出しも同じ結末。
      // 規則7（B-56d）: 利用者が居なくても断らない。
      const { runDelete } = await setUp();
      await runDelete(ourHousehold);

      await expect(runDelete(ourHousehold)).resolves.toBeUndefined();
    });
  });

  describe('失敗の伝え方（B-56a 規則8）', () => {
    it('提案の削除が投げた例外を包まずにそのまま伝える', async () => {
      // 規則8 / ADR-029 決定3(a): 包まずに伝え、巻き戻しはトランザクションに任せる。
      const failure = new Error('提案を消せなかった');
      const failingSuggestionRepository: SuggestionRepository = {
        async findRecentByHousehold() {
          return [];
        },
        async findLatestByHousehold() {
          return null;
        },
        async save() {},
        async countGeneratedByHouseholdSince() {
          return 0;
        },
        async deleteByHousehold() {
          throw failure;
        },
      };
      const runDelete = runDeleteWith({ suggestionRepository: failingSuggestionRepository });

      await expect(runDelete(ourHousehold)).rejects.toBe(failure);
    });

    it('献立の削除が投げた例外を包まずにそのまま伝える', async () => {
      // 規則8。
      const failure = new Error('献立を消せなかった');
      const failingMealRepository: MealRepository = {
        async findByHousehold() {
          return [];
        },
        async findById() {
          return null;
        },
        async save() {},
        async deleteByHousehold() {
          throw failure;
        },
      };
      const runDelete = runDeleteWith({ mealRepository: failingMealRepository });

      await expect(runDelete(ourHousehold)).rejects.toBe(failure);
    });

    it('在庫の口が投げた例外を包まずにそのまま伝える', async () => {
      // 規則8。
      const failure = new Error('在庫を消せなかった');
      const runDelete = runDeleteWith({
        deleteHouseholdStockItems: async () => {
          throw failure;
        },
      });

      await expect(runDelete(ourHousehold)).rejects.toBe(failure);
    });

    it('在庫の口が投げたら、利用者は消えずに残る', async () => {
      // B-56d 設計書 規則6 / ADR-071 決定2: 前の口が投げたら後続を呼ばない。データが残ったまま
      // 利用者だけ消える状態を作らない。
      const failure = new Error('在庫を消せなかった');
      const userDeleter = new InMemoryUserDeleter(ourHousehold);
      const runDelete = runDeleteWith({
        deleteHouseholdStockItems: async () => {
          throw failure;
        },
        deleteUser: deleteUser({ userDeleter }),
      });

      await expect(runDelete(ourHousehold)).rejects.toBe(failure);

      expect(userDeleter.has(ourHousehold)).toBe(true);
    });

    it('利用者を消す口が投げた例外を包まずにそのまま伝える', async () => {
      // B-56d 設計書 規則6・7章1行目 / ADR-045: 包まずに伝え、巻き戻しはトランザクションに任せる。
      const failure = new Error('利用者を消せなかった');
      const runDelete = runDeleteWith({
        deleteUser: async () => {
          throw failure;
        },
      });

      await expect(runDelete(ourHousehold)).rejects.toBe(failure);
    });
  });

  describe('依存の形', () => {
    it('依存に基準日時・生成器・採番の口を取らない', () => {
      // B-56a 規則9・13: 消すだけで時刻にも生成にも依らない。口を依存に足した時点で、
      // この行が typecheck で落ちる。実行時には何も確かめていない — 確かめているのは型検査のほうである。
      const assertion: DepsTakeNeitherClockNorGeneratorNorIdPort = true;

      expect(assertion).toBe(true);
    });
  });
});
