import type { SuggestionIdGenerator } from '../../../src/contexts/meal/domain/port/SuggestionIdGenerator.js';
import { suggestionIdOf } from '../../../src/contexts/meal/domain/value/SuggestionId.js';

/**
 * 決まった値を順に発行する記憶上の実装（B-27 設計書 8章）。先行は
 * `FixedStockItemIdGenerator.ts`。
 *
 * 本物は `crypto.randomUUID()` を読むため、そのままではテストが決定的でなくなる
 * （`docs/testing.md` 5章）。`vi.fn()` を使わずポートの記憶上の実装を書くのは同 2章による。
 *
 * 用意した数より多く発行を求められたら投げる。**足りないまま緑にしない**ため。
 */
export function fixedSuggestionIdGenerator(idsToIssue: readonly string[]): SuggestionIdGenerator {
  let issuedCount = 0;

  return () => {
    const id = idsToIssue[issuedCount];
    if (id === undefined) {
      throw new Error(`発行できる識別子が尽きた（用意したのは ${idsToIssue.length} 件）`);
    }
    issuedCount += 1;
    return suggestionIdOf(id);
  };
}
