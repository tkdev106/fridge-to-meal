import type { SuggestionId } from '../value/SuggestionId.js';

/**
 * 提案の識別子を発行する出口（ADR-026。ポートはコンテキストごとに置く）。
 *
 * ユースケースの本体で `crypto.randomUUID()` を読むと、実行のたびに結果が変わり
 * テストが決定的でなくなる（`docs/testing.md` 5章）。発行をポートに出し、実装は
 * `main.ts` が渡す（B-09）。先行は `StockItemIdGenerator`。
 */
export type SuggestionIdGenerator = () => SuggestionId;
