import { describe, expect, it } from 'vitest';
import { createStockItem } from '../../../../src/contexts/meal/domain/value/StockItem.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { expiryDateOf } from '../../../../src/contexts/meal/domain/value/ExpiryDate.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';

/** 本題でない値を隠して在庫品を作る。既定は分量も期限も持たない在庫品。 */
function stockItem(overrides: Partial<Parameters<typeof createStockItem>[0]> = {}) {
  return createStockItem({ name: 'にんじん', amount: null, expiryDate: null, ...overrides });
}

describe('在庫品 StockItem', () => {
  it('名称・分量・期限の3つを持つ', () => {
    // ADR-037 決定1: C-7 の一致比較が見る (name, amount, expiryDate) を献立側の在庫品が運ぶ。
    const created = stockItem({
      name: 'にんじん',
      amount: amountOf('200g'),
      expiryDate: expiryDateOf('2026-09-30'),
    });

    expect(created.name).toBe('にんじん');
    expect(created.amount).toBe('200g');
    expect(created.expiryDate).toBe('2026-09-30');
  });

  it('分量の未設定を許す', () => {
    // B-26 規則11 / ADR-010: 分量は任意入力。一致比較では null と値を区別するので、
    // 「分量なし」の表し方は null に一本化する。
    expect(stockItem({ amount: null }).amount).toBeNull();
  });

  it('期限の未設定を許す', () => {
    // B-14b 規則2 / FR-13: 期限は任意入力。期限を持たない在庫品も在庫品である。
    expect(stockItem({ expiryDate: null }).expiryDate).toBeNull();
  });

  it('名称の前後の空白は落とす', () => {
    // B-14b 規則3 / C-6: 突き合わせは名称の完全一致。両側で同じ正規化を通さないと
    // 一致が静かにずれる。
    expect(stockItem({ name: '  にんじん  ' }).name).toBe('にんじん');
  });

  it('空の名称を許さない', () => {
    // B-14b 規則3 / 7章: 空の名称は献立に対して存在しないのと同じになる。
    expect(() => stockItem({ name: '' })).toThrow(MealRuleViolation);
    expect(() => stockItem({ name: '   ' })).toThrow(MealRuleViolation);
    expect(() => stockItem({ name: '' })).toThrow(
      expect.objectContaining({ rule: 'stockItem.name.empty' }),
    );
  });

  it('識別子も世帯も持たない', () => {
    // ADR-033 決定3 / ADR-037 理由(2): 3項目は献立側の規則が見るものの総和である。
    // 識別子・世帯・カタログ参照はどの規則も見ないので、pantry の StockItem から持ち込まない。
    expect(stockItem({ name: 'にんじん', amount: null, expiryDate: null })).toEqual({
      __brand: 'StockItem',
      name: 'にんじん',
      amount: null,
      expiryDate: null,
    });
  });

  it('作ったあとに書き換えられない', () => {
    // 先行の createCookingRecord / createMealIngredient / pantry の createStockItem と
    // 同じ流儀。可変にすると、規則3 を通らない名称を後から入れられる。
    const created = stockItem();

    expect(() => {
      (created as { name: string }).name = 'たまねぎ';
    }).toThrow(TypeError);
  });
});
