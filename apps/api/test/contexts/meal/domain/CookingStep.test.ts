import { describe, expect, it } from 'vitest';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';

describe('手順 CookingStep', () => {
  it('手順の文をそのまま保持する', () => {
    // FR-19 / B-14a 規則5: 手順は文であり、番号の項目を持たない（順序は配列の並び）。
    expect(cookingStepOf('にんじんを乱切りにする')).toBe('にんじんを乱切りにする');
  });

  it('前後の空白は落とす', () => {
    // B-14a 規則5。
    expect(cookingStepOf('  にんじんを乱切りにする  ')).toBe('にんじんを乱切りにする');
  });

  it('空の手順を許さない', () => {
    // B-14a 規則5 / 7章: 順序を持つ手順が空では成り立たない。
    expect(() => cookingStepOf('')).toThrow(MealRuleViolation);
  });

  it('空白だけの手順を許さない', () => {
    // B-14a 規則5: 前後の空白を落とした結果が空のものも通さない。
    expect(() => cookingStepOf('   ')).toThrow(MealRuleViolation);
  });

  it('空の手順の規則違反は識別子から判別できる', () => {
    // B-14a 7章 / ADR-025: 反した規則は識別子で持つ。
    expect(() => cookingStepOf('')).toThrow(expect.objectContaining({ rule: 'step.empty' }));
  });

  it('長さの上限を設けない', () => {
    // B-14a 規則14 / prompt-design 6.2: 150字の上限は腐敗防止層の検証の規則であって、
    // ドメインの不変条件ではない（domain-model 4章の表に無い）。
    const longStep = 'にんじんを乱切りにして鍋に入れ、水をひたひたに注いで中火にかける。'.repeat(
      10,
    );

    expect(cookingStepOf(longStep)).toBe(longStep);
  });
});
