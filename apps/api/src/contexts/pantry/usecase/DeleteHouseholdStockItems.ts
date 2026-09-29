import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { StockItemRepository } from '../domain/repository/StockItemRepository.js';

/**
 * 世帯の在庫品と、保存したことのある在庫品の名称をすべて消す（B-56a / FR-27 / NFR-13）。
 * 世帯は第1引数で受け取る（C-9）。
 */
export type DeleteHouseholdStockItems = (householdId: HouseholdId) => Promise<void>;

/**
 * 世帯の在庫を消すユースケースを組み立てる。依存は引数で受け取り、実装の生成は `main.ts` に
 * 任せる（ADR-002）。
 *
 * **存在を確かめない**（B-56a 規則7）— 「消えている」状態を求める操作なので、消す物が無くても
 * 断らない（`DeleteStockItem` の `delete.notFound` とは逆）。受け取った例外は包まずに伝える
 * （規則8。巻き戻しはトランザクションに任せる）。
 */
export function deleteHouseholdStockItems(deps: {
  stockItemRepository: StockItemRepository;
}): DeleteHouseholdStockItems {
  return async (householdId) => {
    await deps.stockItemRepository.deleteByHousehold(householdId);
  };
}
