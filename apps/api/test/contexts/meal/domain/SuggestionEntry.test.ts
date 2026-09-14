import { describe, expect, it } from 'vitest';
import { createSuggestionEntry } from '../../../../src/contexts/meal/domain/value/SuggestionEntry.js';
import type { SuggestionEntryOrigin } from '../../../../src/contexts/meal/domain/value/SuggestionEntry.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';

const mealId = mealIdOf('22222222-2222-4222-8222-222222222222');

/** 本題でない値を隠して提案の1件を作る。既定は生成の由来。 */
function suggestionEntry(overrides: Partial<Parameters<typeof createSuggestionEntry>[0]> = {}) {
  return createSuggestionEntry({ mealId, origin: 'generated', ...overrides });
}

describe('提案の1件 SuggestionEntry', () => {
  it('献立の識別子と由来を持つ', () => {
    // domain-model 4章: entries の各要素は { mealId, origin } である。
    const entry = suggestionEntry({ mealId, origin: 'generated' });

    expect(entry.mealId).toBe(mealId);
    expect(entry.origin).toBe('generated');
  });

  it('再利用の由来の1件も作れる', () => {
    // C-15 / FR-35: 再利用だけで組んだ提案も同じ型で表す。由来は2つとも通る値である。
    expect(suggestionEntry({ origin: 'reused' }).origin).toBe('reused');
  });

  it('献立の識別子と由来だけを抱え、献立そのものを抱えない', () => {
    // ADR-008 / B-26 規則5: 集約をまたぐ参照は識別子で持つ。献立を抱え込むと、
    // 提案が献立の中身に依ってしまう。
    expect(suggestionEntry()).toEqual({
      __brand: 'SuggestionEntry',
      mealId,
      origin: 'generated',
    });
  });

  it('作ったあとに由来を書き換えられない', () => {
    // domain-model 4章: 提案は生成後に完全に不変。可変にすると、由来を混ぜない規則
    // （C-15）を通らない状態を後から作れてしまう。
    const entry = suggestionEntry();

    expect(() => {
      (entry as { origin: SuggestionEntryOrigin }).origin = 'reused';
    }).toThrow(TypeError);
  });
});
