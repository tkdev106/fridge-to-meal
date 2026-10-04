import { describe, expect, it } from 'vitest';
import {
  createStockItem,
  withEditedValues,
} from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { PantryRuleViolation } from '../../../../src/contexts/pantry/domain/error/PantryRuleViolation.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import { ingredientIdOf } from '../../../../src/contexts/pantry/domain/value/IngredientId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { amountOf } from '../../../../src/contexts/pantry/domain/value/Amount.js';
import { expiryDateOf } from '../../../../src/contexts/pantry/domain/value/ExpiryDate.js';

const householdId = householdIdOf('11111111-1111-4111-8111-111111111111');
const stockItemId = stockItemIdOf('22222222-2222-4222-8222-222222222222');

/** 名前だけ変えて在庫品を作る。テストの本題以外を書かないためのもの。 */
function stockItem(overrides: Partial<Parameters<typeof createStockItem>[0]> = {}) {
  return createStockItem({
    id: stockItemId,
    householdId,
    name: 'にんじん',
    ingredientId: null,
    amount: null,
    expiryDate: null,
    useForMeals: true,
    ...overrides,
  });
}

describe('在庫品 StockItem', () => {
  it('名称・数量・期限を持つ', () => {
    const carrot = stockItem({ amount: amountOf('2本'), expiryDate: expiryDateOf('2026-09-30') });

    expect(carrot.name).toBe('にんじん');
    expect(carrot.amount).toBe('2本');
    expect(carrot.expiryDate).toBe('2026-09-30');
    expect(carrot.householdId).toBe(householdId);
  });

  it('名称の前後の空白は落とす', () => {
    expect(stockItem({ name: '  にんじん  ' }).name).toBe('にんじん');
  });

  it('空の名称を許さない', () => {
    // ドメインモデル 4章の不変条件。名前だけが在庫品を在庫品たらしめている
    // （充足判定は名称の突き合わせで行う。C-6）。
    expect(() => stockItem({ name: '' })).toThrow(PantryRuleViolation);
    expect(() => stockItem({ name: '   ' })).toThrow(PantryRuleViolation);
  });

  it('献立に使わないことを持てる', () => {
    // FR-43 / ADR-086: 献立に使うかどうかは真偽値で持ち、渡した値をそのまま持つ。
    expect(stockItem({ useForMeals: false }).useForMeals).toBe(false);
  });

  it('数量と期限は未設定を許す', () => {
    const carrot = stockItem();

    expect(carrot.amount).toBeNull();
    expect(carrot.expiryDate).toBeNull();
  });

  it('カタログにない食材でも登録できる', () => {
    // FR-03: マスタにない食材名は自由入力のまま登録でき、登録がブロックされない。
    expect(stockItem({ name: '母のぬか床', ingredientId: null }).ingredientId).toBeNull();
  });

  it('カタログの食材を指すこともできる', () => {
    const carrotIngredientId = ingredientIdOf('33333333-3333-4333-8333-333333333333');

    expect(stockItem({ ingredientId: carrotIngredientId }).ingredientId).toBe(carrotIngredientId);
  });

  it('同じ食材でも別の在庫品として扱う', () => {
    // ADR-007: 買った日が違えば期限が違う。統合すると期限をどちらに寄せるか決められない。
    // 一覧に「にんじん」が2行並ぶのは仕様である。
    const boughtLastWeek = stockItem({ expiryDate: expiryDateOf('2026-09-20') });
    const boughtToday = stockItem({
      id: stockItemIdOf('44444444-4444-4444-8444-444444444444'),
      expiryDate: expiryDateOf('2026-09-30'),
    });

    expect(boughtLastWeek.id).not.toBe(boughtToday.id);
    expect(boughtLastWeek.expiryDate).not.toBe(boughtToday.expiryDate);
  });

  it('分量・期限・献立に使うかどうかを置き換え、識別子・世帯・名称・食材の指定は元の在庫品から引き継ぐ', () => {
    // B-06 規則2 / FR-05: 更新は書き換えではなく作り直しで表す。引き継ぐ4つを引数に
    // 取らないので、名称の変更が型として起こせない。
    const carrotIngredientId = ingredientIdOf('33333333-3333-4333-8333-333333333333');
    const originalStockItem = stockItem({
      ingredientId: carrotIngredientId,
      amount: amountOf('2本'),
      expiryDate: expiryDateOf('2026-10-01'),
    });

    const recreatedStockItem = withEditedValues(originalStockItem, {
      amount: amountOf('5本'),
      expiryDate: expiryDateOf('2026-12-31'),
      useForMeals: true,
    });

    expect(recreatedStockItem.amount).toBe('5本');
    expect(recreatedStockItem.expiryDate).toBe('2026-12-31');
    expect(recreatedStockItem.id).toBe(stockItemId);
    expect(recreatedStockItem.householdId).toBe(householdId);
    expect(recreatedStockItem.name).toBe('にんじん');
    expect(recreatedStockItem.ingredientId).toBe(carrotIngredientId);
  });

  it('編集の作り直しで、献立に使うかどうかも渡した値に置き換える', () => {
    // FR-05 / ADR-086: 編集で変えられるのは分量・期限・献立に使うかどうかの3つ。
    const originalStockItem = stockItem({ useForMeals: true });

    const recreatedStockItem = withEditedValues(originalStockItem, {
      amount: null,
      expiryDate: null,
      useForMeals: false,
    });

    expect(recreatedStockItem.useForMeals).toBe(false);
  });

  it('作ったあとに書き換えられない', () => {
    // 更新は「新しい在庫品を作り直す」形で行う（B-06）。エンティティを可変にすると、
    // 不変条件を通らない書き換えが可能になる。
    const carrot = stockItem();

    expect(() => {
      (carrot as { name: string }).name = 'たまねぎ';
    }).toThrow();
  });
});
