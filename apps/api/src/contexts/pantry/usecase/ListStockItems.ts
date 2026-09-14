import type { ListStockItemsOutput } from '@fridge-to-meal/contract';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { StockItem } from '../domain/entity/StockItem.js';
import type { StockItemRepository } from '../domain/repository/StockItemRepository.js';
import { stockItemDtoOf } from './StockItemDto.js';

/**
 * その世帯の在庫品を、期限の近い順（未設定は末尾）に一覧する（FR-04 / FR-13）。
 * 世帯は第1引数で受け取る（C-9）。基準時刻は取らない（B-05 規則5）。
 */
export type ListStockItems = (householdId: HouseholdId) => Promise<ListStockItemsOutput>;

/**
 * 一覧のユースケースを組み立てる。依存は引数で受け取り、実装の生成は `main.ts` に任せる
 * （ADR-002 / B-09）。
 *
 * 残日数は返さない（B-05 規則5）。算出には基準時刻が要り、画面を開いたまま日付を
 * またぐと値が古くなる。期限をそのまま載せ、日数は画面（B-11）が持つ。
 * リポジトリが投げた例外は握りつぶさず、そのまま呼び出し側へ伝える（HTTP への写像は B-08）。
 */
export function listStockItems(deps: { stockItemRepository: StockItemRepository }): ListStockItems {
  return async (householdId) => {
    const storedStockItems = await deps.stockItemRepository.findByHousehold(householdId);

    // 受け取った配列をその場で並べ替えない（B-05 規則7）。実装が内部の配列を返した
    // 場合に、一覧しただけで保存済みの並びが変わってしまう。
    const sortedStockItems = [...storedStockItems].sort(byExpirySoonestThenName);

    return { stockItems: sortedStockItems.map(stockItemDtoOf) };
  };
}

/**
 * 期限の昇順、同じなら名称の昇順、それも同じなら識別子の昇順（B-05 規則4）。
 * 識別子は一意なので、ここで全順序が閉じる — リポジトリが約束していない順序が
 * 結果に漏れない（規則8）。
 */
function byExpirySoonestThenName(left: StockItem, right: StockItem): number {
  const expiryDateOrder = compareExpiryDates(left.expiryDate, right.expiryDate);
  if (expiryDateOrder !== 0) return expiryDateOrder;

  // 照合順序は実行環境の ICU に依存するため localeCompare を使わない。
  // コード単位の大小なら Workers と Node で同じ並びになる。
  const nameOrder = compareCodeUnits(left.name, right.name);
  if (nameOrder !== 0) return nameOrder;

  return compareCodeUnits(left.id, right.id);
}

/**
 * 期限を比べる。未設定は期限のあるどれよりも後ろに置く（B-05 規則3）。
 * 期限は `YYYY-MM-DD` なので、日付に変換せず文字列の大小で比較できる（規則2）。
 */
function compareExpiryDates(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareCodeUnits(left, right);
}

/** コード単位の大小で比べる。 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
