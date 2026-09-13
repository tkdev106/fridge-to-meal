import { describe, expect, it } from 'vitest';
import { expiryDateOf } from '../../../../src/contexts/meal/domain/value/ExpiryDate.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';

describe('期限 ExpiryDate', () => {
  it('日付として保持する。時刻は持たない', () => {
    // B-14b 規則1 / ADR-036 決定3: 表現は YYYY-MM-DD の文字列に固定する。
    // 時刻を持たせると、同じ日の在庫どうしの前後が実行環境で変わる。
    expect(expiryDateOf('2026-09-30')).toBe('2026-09-30');
  });

  it('未入力を未設定として扱う', () => {
    // B-14b 規則1 / FR-13: 期限は任意入力。未設定の在庫品も献立の材料は賄える。
    expect(expiryDateOf(null)).toBeNull();
  });

  it('空文字を未設定として扱う', () => {
    // B-14b 規則1: 未設定の表し方を null に一本化する。
    expect(expiryDateOf('')).toBeNull();
  });

  it('空白だけの文字列を未設定として扱う', () => {
    // B-14b 規則1: 画面から届く空白だけの入力も未設定と同じに畳む。
    expect(expiryDateOf('   ')).toBeNull();
  });

  it('前後の空白を落として日付として扱う', () => {
    // B-14b 規則1: 落とすのは前後の空白だけ。
    expect(expiryDateOf('  2026-09-30  ')).toBe('2026-09-30');
  });

  it('YYYY-MM-DD 以外の書き方を拒む', () => {
    // B-14b 7章 / ADR-025: 投げるのは MealRuleViolation で、反した規則は識別子で持つ。
    expect(() => expiryDateOf('2026/09/30')).toThrow(MealRuleViolation);
    expect(() => expiryDateOf('2026-9-3')).toThrow(MealRuleViolation);
    expect(() => expiryDateOf('2026-09-30T00:00:00Z')).toThrow(MealRuleViolation);
    expect(() => expiryDateOf('2026/09/30')).toThrow(
      expect.objectContaining({ rule: 'expiryDate.format' }),
    );
  });

  it('暦に存在しない日付を拒む', () => {
    // B-14b 7章: 書式だけ見ると通ってしまうものを止める。ここを通すと、
    // 期限の列（C-12 の並び）が静かに狂う。
    expect(() => expiryDateOf('2026-02-30')).toThrow(MealRuleViolation);
    expect(() => expiryDateOf('2026-13-01')).toThrow(MealRuleViolation);
    expect(() => expiryDateOf('2026-02-30')).toThrow(
      expect.objectContaining({ rule: 'expiryDate.notACalendarDate' }),
    );
  });
});
