import type { StockItemIdGenerator } from '../../../src/contexts/pantry/domain/port/StockItemIdGenerator.js';
import { stockItemIdOf } from '../../../src/contexts/pantry/domain/value/StockItemId.js';

/**
 * 決まった値を順に発行する記憶上の実装（B-04 設計書 8章）。
 *
 * 本物は `crypto.randomUUID()` を読むため、そのままではテストが決定的でなくなる
 * （`docs/testing.md` 5章）。`vi.fn()` を使わずポートの記憶上の実装を書くのは
 * 同 2章による。
 *
 * 用意した数より多く発行を求められたら投げる。**足りないまま緑にしない**ため。
 */
export function fixedStockItemIdGenerator(idsToIssue: readonly string[]): StockItemIdGenerator {
  let issuedCount = 0;

  return () => {
    const idToIssue = idsToIssue[issuedCount];
    if (idToIssue === undefined) {
      throw new Error(`発行できる識別子が尽きた（用意したのは ${idsToIssue.length} 件）`);
    }
    issuedCount += 1;
    return stockItemIdOf(idToIssue);
  };
}
