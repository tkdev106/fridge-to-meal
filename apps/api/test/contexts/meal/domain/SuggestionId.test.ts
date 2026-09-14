import { describe, expect, it } from 'vitest';
import { suggestionIdOf } from '../../../../src/contexts/meal/domain/value/SuggestionId.js';

describe('提案の識別子 SuggestionId', () => {
  it('与えられた文字列を、書式を検査せずそのまま識別子として扱う', () => {
    // B-26 規則14 / ADR-026 / 先行 mealIdOf: 値の形は発行する側が決める。
    // ここで書式を縛ると、発行の仕組みを差し替えるたびにドメインが赤くなる。
    expect(suggestionIdOf('9f4c1b62-0b4a-4a5e-9c3f-2b8f6f1d4e70')).toBe(
      '9f4c1b62-0b4a-4a5e-9c3f-2b8f6f1d4e70',
    );
    expect(suggestionIdOf('suggestion-1')).toBe('suggestion-1');
  });
});
