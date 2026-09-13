import { describe, expect, it } from 'vitest';
import { createStockItem } from '../../../../src/contexts/meal/domain/value/StockItem.js';
import { expiryDateOf } from '../../../../src/contexts/meal/domain/value/ExpiryDate.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';

/** 本題でない値を隠して在庫品を作る。既定は期限を持たない在庫品。 */
function 在庫品(overrides: Partial<Parameters<typeof createStockItem>[0]> = {}) {
  return createStockItem({ name: 'にんじん', expiryDate: null, ...overrides });
}

describe('在庫品 StockItem', () => {
  it('名称と期限を持つ', () => {
    // B-14b 規則2 / ADR-036 決定3: 献立側の在庫品が持つのはこの2つだけ。
    const stockItem = 在庫品({ name: 'にんじん', expiryDate: expiryDateOf('2026-09-30') });

    expect(stockItem.name).toBe('にんじん');
    expect(stockItem.expiryDate).toBe('2026-09-30');
  });

  it('期限の未設定を許す', () => {
    // B-14b 規則2 / FR-13: 期限は任意入力。期限を持たない在庫品も在庫品である。
    expect(在庫品({ expiryDate: null }).expiryDate).toBeNull();
  });

  it('名称の前後の空白は落とす', () => {
    // B-14b 規則3 / C-6: 突き合わせは名称の完全一致。両側で同じ正規化を通さないと
    // 一致が静かにずれる。
    expect(在庫品({ name: '  にんじん  ' }).name).toBe('にんじん');
  });

  it('空の名称を許さない', () => {
    // B-14b 規則3 / 7章: 空の名称は献立に対して存在しないのと同じになる。
    expect(() => 在庫品({ name: '' })).toThrow(MealRuleViolation);
    expect(() => 在庫品({ name: '   ' })).toThrow(MealRuleViolation);
    expect(() => 在庫品({ name: '' })).toThrow(
      expect.objectContaining({ rule: 'stockItem.name.empty' }),
    );
  });

  it('分量も識別子も世帯も持たない', () => {
    // B-14b 規則2 / ADR-033 決定3: 規則が見ないものを引数にも項目にも入れない。
    // pantry の StockItem とは別の型であり、あちらの項目を持ち込まない。
    expect(在庫品({ name: 'にんじん', expiryDate: null })).toEqual({
      __brand: 'StockItem',
      name: 'にんじん',
      expiryDate: null,
    });
  });

  it('作ったあとに書き換えられない', () => {
    // 先行の createCookingRecord / createMealIngredient / pantry の createStockItem と
    // 同じ流儀。可変にすると、規則3 を通らない名称を後から入れられる。
    const stockItem = 在庫品();

    expect(() => {
      (stockItem as { name: string }).name = 'たまねぎ';
    }).toThrow(TypeError);
  });
});
