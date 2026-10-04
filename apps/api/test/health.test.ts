import { describe, expect, it } from 'vitest';
import { createApp } from '../src/main.js';
import { householdIdOf } from '../src/shared/domain/HouseholdId.js';
import { FixedCountHouseholdMembers } from './support/identity/FixedCountHouseholdMembers.js';
import { FixedIdentifyHousehold } from './support/identity/FixedIdentifyHousehold.js';
import { FixedLeaveHousehold } from './support/identity/FixedLeaveHousehold.js';
import { FixedAddCookingRecord } from './support/meal/FixedAddCookingRecord.js';
import { FixedDeleteHouseholdData } from './support/meal/FixedDeleteHouseholdData.js';
import { FixedListIngredientNames } from './support/meal/FixedListIngredientNames.js';
import { FixedListMeals } from './support/meal/FixedListMeals.js';
import { FixedShowMeal } from './support/meal/FixedShowMeal.js';
import {
  FixedShowLatestSuggestion,
  FixedSuggestMeals,
  FixedSuggestNewMeals,
} from './support/meal/FixedSuggestMeals.js';
import {
  FixedDeleteStockItem,
  FixedListStockItems,
  FixedRegisterStockItem,
  FixedUpdateStockItem,
} from './support/pantry/FixedStockItemUsecases.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');

/**
 * 疎通確認の本題は在庫でも提案でも認証でもないので、依存はすべて代役で足りる（B-09 規則1）。
 * default export は Workers の `fetch` ハンドラになり `.request()` を持たないため、
 * `createApp` で組んだ Hono を叩く。
 */
function app() {
  const stockItem = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'にんじん',
    ingredientId: null,
    amount: null,
    expiryDate: null,
    useForMeals: true,
  };

  return createApp({
    identifyHousehold: new FixedIdentifyHousehold({ returns: ourHousehold }).identify,
    registerStockItem: new FixedRegisterStockItem({ returns: stockItem }).register,
    listStockItems: new FixedListStockItems({ returns: { stockItems: [] } }).list,
    updateStockItem: new FixedUpdateStockItem({ returns: stockItem }).update,
    deleteStockItem: new FixedDeleteStockItem({ succeeds: true }).delete,
    suggestMeals: new FixedSuggestMeals({ returns: { outcome: 'insufficientStockItems' } }).suggest,
    showLatestSuggestion: new FixedShowLatestSuggestion({ returns: { outcome: 'none' } }).show,
    suggestNewMeals: new FixedSuggestNewMeals({ returns: { outcome: 'insufficientStockItems' } })
      .suggest,
    listIngredientNames: new FixedListIngredientNames({ returns: { ingredientNames: [] } }).list,
    addCookingRecord: new FixedAddCookingRecord({ succeeds: true }).add,
    // B-52 で口が増えたことへの機械的な追随。疎通確認の本題ではない。
    showMeal: new FixedShowMeal({
      returns: {
        mealId: '44444444-4444-4444-8444-444444444444',
        title: '肉じゃが',
        ingredients: [],
        steps: [],
        coverage: { covered: [], missing: [] },
        cooked: false,
      },
    }).show,
    // B-54a で口が増えたことへの機械的な追随。疎通確認の本題ではない。
    listMeals: new FixedListMeals({ returns: { seen: [], cooked: [] } }).list,
    // B-56a で口が増えたことへの機械的な追随。疎通確認の本題ではない。
    deleteHouseholdData: new FixedDeleteHouseholdData({ succeeds: true }).delete,
    // B-75 で口が増えたことへの機械的な追随。疎通確認の本題ではない。
    countHouseholdMembers: new FixedCountHouseholdMembers({ returns: 1 }).count,
    leaveHousehold: new FixedLeaveHousehold({ succeeds: true }).leave,
    now: () => '2026-09-23T12:00:00.000Z',
  });
}

describe('疎通確認', () => {
  it('GET /health が ok を返す', async () => {
    const res = await app().request('/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });
});
