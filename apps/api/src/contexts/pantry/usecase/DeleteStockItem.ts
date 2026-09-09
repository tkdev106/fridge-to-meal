import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { StockItemRepository } from '../domain/repository/StockItemRepository.js';
import type { StockItemId } from '../domain/value/StockItemId.js';

/**
 * 在庫品を1件削除する（FR-06）。世帯は第1引数で受け取る（C-9）。
 * 見つからないときも他の世帯の在庫品を指したときも断らない（B-06 規則9）。
 */
export type DeleteStockItem = (householdId: HouseholdId, id: StockItemId) => Promise<void>;

/**
 * 削除のユースケースを組み立てる。実装の生成は `main.ts` に任せる（ADR-002 / B-09）。
 *
 * **事前に存在を確かめない**（規則9）。「消えている」という結果は存在しなかった場合と
 * 畳めるうえ、確かめると他の世帯の在庫品の有無が呼び出し側に漏れる。
 * リポジトリが投げた例外は握りつぶさず、そのまま呼び出し側へ伝える（HTTP への写像は B-08）。
 */
export function deleteStockItem(deps: {
  stockItemRepository: StockItemRepository;
}): DeleteStockItem {
  return async (householdId, id) => {
    await deps.stockItemRepository.delete(householdId, id);
  };
}
