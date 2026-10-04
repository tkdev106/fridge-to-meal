import { describe, expect, it } from 'vitest';
import { IdentityRuleViolation } from '../../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';
import { countHouseholdMembers } from '../../../../src/contexts/identity/usecase/CountHouseholdMembers.js';
import type { JoinHousehold } from '../../../../src/contexts/identity/usecase/JoinHousehold.js';
import { joinHousehold } from '../../../../src/contexts/identity/usecase/JoinHousehold.js';
import type { Meal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { createMeal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import type { Suggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import { createSuggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import { createPantrySnapshot } from '../../../../src/contexts/meal/domain/value/PantrySnapshot.js';
import { createSuggestionEntry } from '../../../../src/contexts/meal/domain/value/SuggestionEntry.js';
import { suggestionIdOf } from '../../../../src/contexts/meal/domain/value/SuggestionId.js';
import { acceptHouseholdInvitation } from '../../../../src/contexts/meal/usecase/AcceptHouseholdInvitation.js';
import type { StockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { createStockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { expiryDateOf } from '../../../../src/contexts/pantry/domain/value/ExpiryDate.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import { deleteHouseholdStockItems } from '../../../../src/contexts/pantry/usecase/DeleteHouseholdStockItems.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryHouseholdMembers } from '../../../support/identity/InMemoryHouseholdMembers.js';
import { InMemoryMealRepository } from '../../../support/meal/InMemoryMealRepository.js';
import { InMemorySuggestionRepository } from '../../../support/meal/InMemorySuggestionRepository.js';
import { InMemoryStockItemRepository } from '../../../support/pantry/InMemoryStockItemRepository.js';

/** 参加する利用者の今の世帯。 */
const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
/** 招待の世帯（参加先）。 */
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
 * 2世帯ぶんの献立・提案・在庫品を1件ずつ置き、招待の世帯の招待を1件作って、ユースケースを1つ組む
 * （先行 `DeleteHouseholdData.test.ts`）。人数・在庫・参加の口は、それぞれ `identity/usecase` と
 * `pantry/usecase` の本物を記憶上の実装で組んで関数として渡す（ADR-033 決定2）。
 *
 * `ourMemberCount` を渡さなければ、こちらの世帯は1人の世帯である。招待の世帯は常に1人。
 * 参加の口を差し替えるときは `joinHouseholdOf` に本物を受け取る関数を渡す — 差し替えた口から
 * 本物へ委ねられるように。
 */
async function setUp(
  props: {
    ourMemberCount?: number;
    joinHouseholdOf?: (realJoin: JoinHousehold) => JoinHousehold;
  } = {},
) {
  const mealRepository = new InMemoryMealRepository();
  const suggestionRepository = new InMemorySuggestionRepository();
  const stockItemRepository = new InMemoryStockItemRepository();

  for (const [householdId, mealId, suggestionId, stockItemId, name] of [
    [ourHousehold, ourMealId, ourSuggestionId, ourStockItemId, 'にんじん'],
    [neighborHousehold, neighborMealId, neighborSuggestionId, neighborStockItemId, 'れんこん'],
  ] as const) {
    await mealRepository.save(householdId, meal({ id: mealId, householdId }));
    await suggestionRepository.save(
      householdId,
      suggestion({ id: suggestionId, householdId, mealId }),
    );
    await stockItemRepository.save(householdId, stockItem({ id: stockItemId, householdId, name }));
  }

  const householdMembers = new InMemoryHouseholdMembers([
    [ourHousehold, props.ourMemberCount ?? 1],
    [neighborHousehold, 1],
  ]);
  const token = await householdMembers.create(neighborHousehold);

  const realJoin = joinHousehold({ householdJoiner: householdMembers });
  const runAccept = acceptHouseholdInvitation({
    countHouseholdMembers: countHouseholdMembers({ householdMemberCounter: householdMembers }),
    deleteHouseholdStockItems: deleteHouseholdStockItems({ stockItemRepository }),
    joinHousehold: props.joinHouseholdOf === undefined ? realJoin : props.joinHouseholdOf(realJoin),
    mealRepository,
    suggestionRepository,
  });

  return {
    runAccept,
    token,
    householdMembers,
    mealRepository,
    suggestionRepository,
    stockItemRepository,
  };
}

describe('招待で参加する AcceptHouseholdInvitation', () => {
  describe('自分しか居ない世帯からの参加（設計書 規則9・10 / ADR-087 決定5）', () => {
    it('1人の世帯から使える招待で参加でき、招待の世帯の人数が1増える', async () => {
      // 設計書 規則9 / FR-45: データを消したあと参加する。
      const { runAccept, token, householdMembers } = await setUp();

      await runAccept(ourHousehold, token);

      await expect(householdMembers.count(neighborHousehold)).resolves.toBe(2);
    });

    it('1人の世帯から参加すると、元の世帯の献立は1件も引けなくなる', async () => {
      // 設計書 規則9 / ADR-087 決定5: `DELETE /household-data` と同じ手段で消す。
      const { runAccept, token, mealRepository } = await setUp();

      await runAccept(ourHousehold, token);

      await expect(mealRepository.findByHousehold(ourHousehold)).resolves.toEqual([]);
    });

    it('1人の世帯から参加すると、元の世帯の最新の提案は無くなる', async () => {
      // 設計書 規則9。
      const { runAccept, token, suggestionRepository } = await setUp();

      await runAccept(ourHousehold, token);

      await expect(suggestionRepository.findLatestByHousehold(ourHousehold)).resolves.toBeNull();
    });

    it('1人の世帯から参加すると、元の世帯の在庫品も消える', async () => {
      // 設計書 規則9 / ADR-072 決定1: 在庫の側は pantry の口を通して消す。
      const { runAccept, token, stockItemRepository } = await setUp();

      await runAccept(ourHousehold, token);

      await expect(stockItemRepository.findByHousehold(ourHousehold)).resolves.toEqual([]);
    });

    it('参加の口を呼ぶ時点で、元の世帯の献立・提案・在庫品はすでに消えている', async () => {
      // 設計書 規則10: 参加のあとは世帯が参加先を指すので、消すのは参加より必ず先。
      let observedAtJoin: unknown = 'まだ呼ばれていない';
      const { runAccept, token, mealRepository, suggestionRepository, stockItemRepository } =
        await setUp({
          joinHouseholdOf: (realJoin) => async (householdId, joiningToken) => {
            observedAtJoin = {
              meals: await mealRepository.findByHousehold(householdId),
              latestSuggestion: await suggestionRepository.findLatestByHousehold(householdId),
              stockItems: await stockItemRepository.findByHousehold(householdId),
            };
            await realJoin(householdId, joiningToken);
          },
        });

      await runAccept(ourHousehold, token);

      expect(observedAtJoin).toEqual({ meals: [], latestSuggestion: null, stockItems: [] });
    });

    it('人数が 0 と返っても、元の世帯のデータを消してから参加する', async () => {
      // 設計書 規則9: 1 以下なら消す。0 は「利用者の行が無い世帯」で起こりうる（先行 B-75）。
      const {
        runAccept,
        token,
        householdMembers,
        mealRepository,
        suggestionRepository,
        stockItemRepository,
      } = await setUp({ ourMemberCount: 0 });

      await runAccept(ourHousehold, token);

      const outcome = {
        meals: await mealRepository.findByHousehold(ourHousehold),
        latestSuggestion: await suggestionRepository.findLatestByHousehold(ourHousehold),
        stockItems: await stockItemRepository.findByHousehold(ourHousehold),
        invitedMemberCount: await householdMembers.count(neighborHousehold),
      };
      expect(outcome).toEqual({
        meals: [],
        latestSuggestion: null,
        stockItems: [],
        invitedMemberCount: 2,
      });
    });

    it('1人の世帯から参加しても、招待の世帯の献立・提案・在庫品は消えない', async () => {
      // 設計書 規則10 / C-9: 消すのは参加する前の世帯だけである。
      const { runAccept, token, mealRepository, suggestionRepository, stockItemRepository } =
        await setUp();

      await runAccept(ourHousehold, token);

      const neighbor = {
        mealIds: (await mealRepository.findByHousehold(neighborHousehold)).map(
          (stored) => stored.id,
        ),
        latestSuggestionId: (await suggestionRepository.findLatestByHousehold(neighborHousehold))
          ?.id,
        stockItemIds: (await stockItemRepository.findByHousehold(neighborHousehold)).map(
          (stored) => stored.id,
        ),
      };
      expect(neighbor).toEqual({
        mealIds: [neighborMealId],
        latestSuggestionId: neighborSuggestionId,
        stockItemIds: [neighborStockItemId],
      });
    });
  });

  describe('他のメンバーが居る世帯からの参加（設計書 規則9 / ADR-087 決定5）', () => {
    it('世帯に他のメンバーが居れば、元の世帯の献立・提案・在庫品を消さない', async () => {
      // 設計書 規則9: 2人以上ならデータは残ったメンバーのものとして残る。
      const { runAccept, token, mealRepository, suggestionRepository, stockItemRepository } =
        await setUp({ ourMemberCount: 2 });

      await runAccept(ourHousehold, token);

      const ours = {
        mealIds: (await mealRepository.findByHousehold(ourHousehold)).map((stored) => stored.id),
        latestSuggestionId: (await suggestionRepository.findLatestByHousehold(ourHousehold))?.id,
        stockItemIds: (await stockItemRepository.findByHousehold(ourHousehold)).map(
          (stored) => stored.id,
        ),
      };
      expect(ours).toEqual({
        mealIds: [ourMealId],
        latestSuggestionId: ourSuggestionId,
        stockItemIds: [ourStockItemId],
      });
    });

    it('世帯に他のメンバーが居ても参加し、招待の世帯の人数が1増える', async () => {
      // 設計書 規則9 / FR-45: 2人以上なら参加だけを行う。
      const { runAccept, token, householdMembers } = await setUp({ ourMemberCount: 2 });

      await runAccept(ourHousehold, token);

      await expect(householdMembers.count(neighborHousehold)).resolves.toBe(2);
    });
  });

  describe('参加の断り（設計書 規則11 / 7章）', () => {
    it('参加の口の断りを包まずにそのまま伝える', async () => {
      // 設計書 規則11・7章4行目 / ADR-032: 断りは api 層が rule で 404 に写す。包むと写せない。
      const violation = new IdentityRuleViolation(
        'joinHousehold.invalidInvitation',
        '使えない招待である',
      );
      const { runAccept, token } = await setUp({
        joinHouseholdOf: () => async () => {
          throw violation;
        },
      });

      await expect(runAccept(ourHousehold, token)).rejects.toBe(violation);
    });
  });
});
