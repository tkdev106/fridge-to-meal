import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import { PantryRuleViolation } from '../domain/error/PantryRuleViolation.js';
import type { StockItemRepository } from '../domain/repository/StockItemRepository.js';
import type { StockItemId } from '../domain/value/StockItemId.js';

/**
 * 在庫品を1件削除する（FR-06）。世帯は第1引数で受け取る（C-9）。
 * 見つからないときも他の世帯の在庫品を指したときも `PantryRuleViolation` で断る
 * （B-06a 規則2。B-06 規則9 を置き換えた）。
 */
export type DeleteStockItem = (householdId: HouseholdId, id: StockItemId) => Promise<void>;

/**
 * 削除のユースケースを組み立てる。実装の生成は `main.ts` に任せる（ADR-002 / B-09）。
 *
 * **削除の前に存在を確かめる**（B-06a 規則2）。1件も消していない呼び出しを成功と
 * 呼ばないことを、再送しやすさより優先する — 削除は冪等でなくなる（規則4）。
 * リポジトリが投げた例外は握りつぶさず、そのまま呼び出し側へ伝える（HTTP への写像は B-08）。
 */
export function deleteStockItem(deps: {
  stockItemRepository: StockItemRepository;
}): DeleteStockItem {
  return async (householdId, id) => {
    const 保存済み = await deps.stockItemRepository.findById(householdId, id);
    if (保存済み === null) {
      // 存在しない場合と他の世帯の場合を同じ規則・同じ文言で断る（B-06a 規則3 / C-9）。
      // 文言に識別子も世帯も書かない — 書けば「他の世帯には在る」が漏れる。
      // `findById` が `null` を返す1つの経路に畳んであるので、区別は生まれない。
      throw new PantryRuleViolation('delete.notFound', '削除する在庫品が見つかりません');
    }

    // 確認に通ったら削除する。**呼んだあとに読み直して消えたことを確かめない**（規則5・6）。
    // 確認をもう1往復足しても、その直後に戻される可能性は消えない。MVP は競合を検出しない。
    await deps.stockItemRepository.delete(householdId, id);
  };
}
