import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { StockItemRepository } from '../domain/repository/StockItemRepository.js';

/**
 * その世帯でこれまでに保存したことのある在庫品の名称を返す（FR-02 / B-50d）。
 * 世帯は第1引数で受け取る（C-9）。重複なく、コード単位の昇順で返す（ADR-063 決定4）。
 */
export type ListSavedStockItemNames = (householdId: HouseholdId) => Promise<readonly string[]>;

/**
 * 名称の列を返すユースケースを組み立てる。依存は引数で受け取り、実装の生成は `main.ts` に
 * 任せる（ADR-002）。リポジトリが投げた例外は握りつぶさず、そのまま呼び出し側へ伝える
 * （先行 `ListStockItems`）。
 */
export function listSavedStockItemNames(deps: {
  stockItemRepository: StockItemRepository;
}): ListSavedStockItemNames {
  return async (householdId) => {
    const savedNames = await deps.stockItemRepository.findSavedNamesByHousehold(householdId);

    // リポジトリは並びを約束しないので、ここで並べる。重複は名称の完全一致で畳む
    // （ADR-063 決定4 / C-6）。新しい配列を作ってから並べ、受け取った配列をその場で
    // 書き換えない（先行 `ListStockItems` 規則7）。
    return [...new Set(savedNames)].sort(compareCodeUnits);
  };
}

/**
 * コード単位の大小で比べる。照合順序は実行環境の ICU に依存するため `localeCompare` を
 * 使わない（ADR-063 決定4 / 先行 `ListStockItems`）。
 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
