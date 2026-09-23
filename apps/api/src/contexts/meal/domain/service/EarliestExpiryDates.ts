import type { ExpiryDate } from '../value/ExpiryDate.js';
import type { StockItem } from '../value/StockItem.js';

/**
 * 在庫品を名称で畳み、名称ごとに**最も早い期限**を選ぶ（ADR-036 決定1(ii)(iii) / 結果4）。
 *
 * - 期限を持たない在庫品は入らない。期限未設定の在庫品は並び順に一切効かない（結果3）
 * - そのため、期限を持つ在庫品が1件も無い名称は**まとまり自体が残らない**
 * - 畳むのは、買い置きの多さで順位が動くのを避けるためである。畳まないと「同じ食材を
 *   何個も持っている献立が上に来る」という別の量りになる（結果4）
 * - 名称の前後空白を落とすのは `mealCoverageOf` と同じ扱い。片側だけ別の正規化にすると
 *   賄えると判定した在庫の期限が列に入らない、といったずれ方をする（C-6）
 */
export function earliestExpiryDateByName(
  stockItems: readonly StockItem[],
): ReadonlyMap<string, ExpiryDate> {
  const earliestExpiryDates = new Map<string, ExpiryDate>();
  for (const stockItem of stockItems) {
    const name = stockItem.name.trim();
    if (name === '') continue;

    const expiryDate = stockItem.expiryDate;
    if (expiryDate === null) continue;

    const known = earliestExpiryDates.get(name);
    if (known === undefined || compareCodeUnits(expiryDate, known) < 0) {
      earliestExpiryDates.set(name, expiryDate);
    }
  }
  return earliestExpiryDates;
}

/**
 * コード単位の大小で比べる（先行 `ListStockItems`）。
 *
 * 照合順序は実行環境の ICU に依存するため `localeCompare` を使わない。コード単位なら
 * Workers と Node で同じ並びになる（ADR-036 結果8 / C-12 の決定性）。
 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
