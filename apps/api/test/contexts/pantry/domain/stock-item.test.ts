import { describe, expect, it } from 'vitest';
import { createStockItem } from '../../../../src/contexts/pantry/domain/entity/stock-item.js';
import { PantryRuleViolation } from '../../../../src/contexts/pantry/domain/pantry-rule-violation.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/stock-item-id.js';
import { ingredientIdOf } from '../../../../src/contexts/pantry/domain/value/ingredient-id.js';
import { householdIdOf } from '../../../../src/shared/domain/household-id.js';
import { amountOf } from '../../../../src/contexts/pantry/domain/value/amount.js';
import { expiryDateOf } from '../../../../src/contexts/pantry/domain/value/expiry-date.js';

const 世帯 = householdIdOf('11111111-1111-4111-8111-111111111111');
const 識別子 = stockItemIdOf('22222222-2222-4222-8222-222222222222');

/** 名前だけ変えて在庫品を作る。テストの本題以外を書かないためのもの。 */
function 在庫品(overrides: Partial<Parameters<typeof createStockItem>[0]> = {}) {
  return createStockItem({
    id: 識別子,
    householdId: 世帯,
    name: 'にんじん',
    ingredientId: null,
    amount: null,
    expiryDate: null,
    ...overrides,
  });
}

describe('在庫品 StockItem', () => {
  it('名称・数量・期限を持つ', () => {
    const item = 在庫品({ amount: amountOf('2本'), expiryDate: expiryDateOf('2026-09-30') });

    expect(item.name).toBe('にんじん');
    expect(item.amount).toBe('2本');
    expect(item.expiryDate).toBe('2026-09-30');
    expect(item.householdId).toBe(世帯);
  });

  it('名称の前後の空白は落とす', () => {
    expect(在庫品({ name: '  にんじん  ' }).name).toBe('にんじん');
  });

  it('空の名称を許さない', () => {
    // ドメインモデル 4章の不変条件。名前だけが在庫品を在庫品たらしめている
    // （充足判定は名称の突き合わせで行う。C-6）。
    expect(() => 在庫品({ name: '' })).toThrow(PantryRuleViolation);
    expect(() => 在庫品({ name: '   ' })).toThrow(PantryRuleViolation);
  });

  it('数量と期限は未設定を許す', () => {
    const item = 在庫品();

    expect(item.amount).toBeNull();
    expect(item.expiryDate).toBeNull();
  });

  it('カタログにない食材でも登録できる', () => {
    // FR-03: マスタにない食材名は自由入力のまま登録でき、登録がブロックされない。
    expect(在庫品({ name: '母のぬか床', ingredientId: null }).ingredientId).toBeNull();
  });

  it('カタログの食材を指すこともできる', () => {
    const にんじん = ingredientIdOf('33333333-3333-4333-8333-333333333333');

    expect(在庫品({ ingredientId: にんじん }).ingredientId).toBe(にんじん);
  });

  it('同じ食材でも別の在庫品として扱う', () => {
    // ADR-007: 買った日が違えば期限が違う。統合すると期限をどちらに寄せるか決められない。
    // 一覧に「にんじん」が2行並ぶのは仕様である。
    const 先週買った = 在庫品({ expiryDate: expiryDateOf('2026-09-20') });
    const 今日買った = 在庫品({
      id: stockItemIdOf('44444444-4444-4444-8444-444444444444'),
      expiryDate: expiryDateOf('2026-09-30'),
    });

    expect(先週買った.id).not.toBe(今日買った.id);
    expect(先週買った.expiryDate).not.toBe(今日買った.expiryDate);
  });

  it('作ったあとに書き換えられない', () => {
    // 更新は「新しい在庫品を作り直す」形で行う（B-06）。エンティティを可変にすると、
    // 不変条件を通らない書き換えが可能になる。
    const item = 在庫品();

    expect(() => {
      (item as { name: string }).name = 'たまねぎ';
    }).toThrow();
  });
});
