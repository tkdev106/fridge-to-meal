import type { MealId } from '../value/MealId.js';

/**
 * 献立の識別子を発行する出口（ADR-026。ポートはコンテキストごとに置く）。
 *
 * ユースケースの本体で `crypto.randomUUID()` を読むと、実行のたびに結果が変わり
 * テストが決定的でなくなる（`docs/testing.md` 5章）。発行をポートに出し、実装は
 * `main.ts` が渡す（B-09）。先行は `SuggestionIdGenerator` / `StockItemIdGenerator`。
 *
 * **`householdId` は取らない。** 識別子の発行に世帯は要らず、先行の2つと同じ形にそろえる。
 */
export type MealIdGenerator = () => MealId;
