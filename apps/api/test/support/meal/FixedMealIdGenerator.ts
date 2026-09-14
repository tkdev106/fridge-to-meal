import type { MealIdGenerator } from '../../../src/contexts/meal/domain/port/MealIdGenerator.js';
import { mealIdOf } from '../../../src/contexts/meal/domain/value/MealId.js';

/**
 * 決まった値を順に発行する記憶上の実装（B-28 設計書 4章）。先行は
 * `FixedSuggestionIdGenerator.ts` / `FixedStockItemIdGenerator.ts`。
 *
 * 本物は `crypto.randomUUID()` を読むため、そのままではテストが決定的でなくなる
 * （`docs/testing.md` 5章）。`vi.fn()` を使わずポートの記憶上の実装を書くのは同 2章による。
 *
 * 用意した数より多く発行を求められたら投げる。**足りないまま緑にしない**ため。
 * 発行を求められない周（再利用だけで組めた回）は、用意を空にしておけば
 * 「1件も発行しないこと」がそのまま守られる。
 */
export function 記憶上の献立識別子発行器(発行する値: readonly string[]): MealIdGenerator {
  let 発行済み = 0;

  return () => {
    const 値 = 発行する値[発行済み];
    if (値 === undefined) {
      throw new Error(`発行できる識別子が尽きた（用意したのは ${発行する値.length} 件）`);
    }
    発行済み += 1;
    return mealIdOf(値);
  };
}
