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
export function 記憶上の在庫品識別子発行器(発行する値: readonly string[]): StockItemIdGenerator {
  let 発行済み = 0;

  return () => {
    const 値 = 発行する値[発行済み];
    if (値 === undefined) {
      throw new Error(`発行できる識別子が尽きた（用意したのは ${発行する値.length} 件）`);
    }
    発行済み += 1;
    return stockItemIdOf(値);
  };
}
