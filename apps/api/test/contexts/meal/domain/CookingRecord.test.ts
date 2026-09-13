import { describe, expect, it } from 'vitest';
import { createCookingRecord } from '../../../../src/contexts/meal/domain/value/CookingRecord.js';
import { dateTimeOf, type DateTime } from '../../../../src/contexts/meal/domain/value/DateTime.js';

describe('調理記録 CookingRecord', () => {
  it('調理日時を持つ', () => {
    // domain-model 3章・4章 / B-14a 設計5章: 持つのは調理日時だけ。
    const record = createCookingRecord({ cookedAt: dateTimeOf('2026-09-13T12:00:00Z') });

    expect(record.cookedAt).toBe('2026-09-13T12:00:00.000Z');
  });

  it('作ったあとに書き換えられない', () => {
    // C-3 / B-14a 規則10: 献立は生成後に編集できず、調理記録は追加のみ。
    // 可変にすると、記録された事実を後から書き換えられてしまう。
    const record = createCookingRecord({ cookedAt: dateTimeOf('2026-09-13T12:00:00Z') });

    expect(() => {
      (record as { cookedAt: DateTime }).cookedAt = dateTimeOf('2026-09-14T12:00:00Z');
    }).toThrow();
  });
});
