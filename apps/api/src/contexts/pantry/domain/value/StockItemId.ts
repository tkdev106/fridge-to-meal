/** 在庫品の識別子。 */
export type StockItemId = string & { readonly __brand: 'StockItemId' };

/**
 * 文字列を在庫品の識別子として扱う。
 *
 * 発行はインフラ層（DB の既定値）に任せるため、ここでは書式を検査しない。
 */
export function stockItemIdOf(raw: string): StockItemId {
  return raw as StockItemId;
}
