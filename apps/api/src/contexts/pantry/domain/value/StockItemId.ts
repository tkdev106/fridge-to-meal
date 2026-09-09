/** 在庫品の識別子。 */
export type StockItemId = string & { readonly __brand: 'StockItemId' };

/**
 * 文字列を在庫品の識別子として扱う。
 *
 * 発行は `StockItemIdGenerator`（`domain/port/`）が担い、実装は `main.ts` が渡す（ADR-026）。
 * ここでは書式を検査しない — 値の形は発行する側が決める。
 */
export function stockItemIdOf(raw: string): StockItemId {
  return raw as StockItemId;
}
