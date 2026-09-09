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
    const 保存されているもの = await deps.stockItemRepository.findByHousehold(householdId);

    // 受け取った配列をその場で並べ替えない（B-05 規則7）。実装が内部の配列を返した
    // 場合に、一覧しただけで保存済みの並びが変わってしまう。
    const 並べたもの = [...保存されているもの].sort(期限の近い順);

    return { stockItems: 並べたもの.map(stockItemDtoOf) };
  };
}

/**
 * 期限の昇順、同じなら名称の昇順、それも同じなら識別子の昇順（B-05 規則4）。
 * 識別子は一意なので、ここで全順序が閉じる — リポジトリが約束していない順序が
 * 結果に漏れない（規則8）。
 */
function 期限の近い順(左: StockItem, 右: StockItem): number {
  const 期限の差 = 期限を比べる(左.expiryDate, 右.expiryDate);
  if (期限の差 !== 0) return 期限の差;

  // 照合順序は実行環境の ICU に依存するため localeCompare を使わない。
  // コード単位の大小なら Workers と Node で同じ並びになる。
  const 名称の差 = コード単位で比べる(左.name, 右.name);
  if (名称の差 !== 0) return 名称の差;

  return コード単位で比べる(左.id, 右.id);
}

/**
 * 期限を比べる。未設定は期限のあるどれよりも後ろに置く（B-05 規則3）。
 * 期限は `YYYY-MM-DD` なので、日付に変換せず文字列の大小で比較できる（規則2）。
 */
function 期限を比べる(左: string | null, 右: string | null): number {
  if (左 === null && 右 === null) return 0;
  if (左 === null) return 1;
  if (右 === null) return -1;
  return コード単位で比べる(左, 右);
}

/** コード単位の大小で比べる。 */
function コード単位で比べる(左: string, 右: string): number {
  if (左 < 右) return -1;
  if (左 > 右) return 1;
  return 0;
}
