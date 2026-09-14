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
export function 記憶上の提案識別子発行器(発行する値: readonly string[]): SuggestionIdGenerator {
  let 発行済み = 0;

  return () => {
    const 値 = 発行する値[発行済み];
    if (値 === undefined) {
      throw new Error(`発行できる識別子が尽きた（用意したのは ${発行する値.length} 件）`);
    }
    発行済み += 1;
    return suggestionIdOf(値);
  };
}
