import { describe, expect, it } from 'vitest';
import { expiryDateOf } from '../../../../src/contexts/pantry/domain/value/expiry-date.js';
import { PantryRuleViolation } from '../../../../src/contexts/pantry/domain/pantry-rule-violation.js';

describe('期限 ExpiryDate', () => {
  it('日付として保持する。時刻は持たない', () => {
    expect(expiryDateOf('2026-09-30')).toBe('2026-09-30');
  });

  it('未入力を許す', () => {
    // FR-13: 期限は任意入力。未入力の在庫品は期限による警告・優先の対象外になる。
    expect(expiryDateOf(null)).toBeNull();
    expect(expiryDateOf('')).toBeNull();
    expect(expiryDateOf('  ')).toBeNull();
  });

  it('暦に存在しない日付を拒む', () => {
    // 書式だけ見ると通ってしまうものを止める。ここを通すと、期限の近い順（FR-04）が
    // 静かに狂う。
    expect(() => expiryDateOf('2026-02-30')).toThrow(PantryRuleViolation);
    expect(() => expiryDateOf('2026-13-01')).toThrow(PantryRuleViolation);
  });

  it('YYYY-MM-DD 以外の書き方を拒む', () => {
    expect(() => expiryDateOf('2026/09/30')).toThrow(PantryRuleViolation);
    expect(() => expiryDateOf('2026-9-3')).toThrow(PantryRuleViolation);
    expect(() => expiryDateOf('2026-09-30T00:00:00Z')).toThrow(PantryRuleViolation);
  });

  it('文字列として並べ替えると期限の近い順になる', () => {
    // FR-04 の既定の並びをこの表現に依存させてよいことを、ここで固定しておく。
    const 並び = ['2026-10-01', '2026-09-30', '2027-01-01'].map((d) => expiryDateOf(d)).sort();
    expect(並び).toEqual(['2026-09-30', '2026-10-01', '2027-01-01']);
  });
});
