import { describe, expect, it } from 'vitest';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';

describe('献立の識別子 MealId', () => {
  it('与えられた文字列を、書式を検査せずそのまま識別子として扱う', () => {
    // B-14a 設計5章 / ADR-026 / 先行 stockItemIdOf: 値の形は発行する側が決める。
    // ここで書式を縛ると、発行の仕組みを差し替えるたびにドメインが赤くなる。
    expect(mealIdOf('9f4c1b62-0b4a-4a5e-9c3f-2b8f6f1d4e70')).toBe(
      '9f4c1b62-0b4a-4a5e-9c3f-2b8f6f1d4e70',
    );
    expect(mealIdOf('meal-1')).toBe('meal-1');
  });
});
