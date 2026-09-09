import type { StockItemId } from '../value/StockItemId.js';

/**
 * 在庫品の識別子を発行する出口（ADR-026 提案中）。
 *
 * ユースケースの本体で `crypto.randomUUID()` を読むと、実行のたびに結果が変わり
 * テストが決定的でなくなる（`docs/testing.md` 5章）。発行をポートに出し、実装は
 * `main.ts` が渡す（B-09）。
 */
export type StockItemIdGenerator = () => StockItemId;
