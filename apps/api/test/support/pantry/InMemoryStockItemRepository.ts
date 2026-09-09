import type { StockItemRepository } from '../../../src/contexts/pantry/domain/repository/StockItemRepository.js';
import type { StockItem } from '../../../src/contexts/pantry/domain/entity/StockItem.js';
import type { StockItemId } from '../../../src/contexts/pantry/domain/value/StockItemId.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';
import { PantryRuleViolation } from '../../../src/contexts/pantry/domain/error/PantryRuleViolation.js';

/**
 * 記憶の上だけで動く実装。ドメイン層のテスト（B-03）とユースケース層のテスト（B-04）が
 * 同じものを使う。**interface が実装できる形をしていること**の確認を兼ねている。
 *
 * `test/` に閉じてあるのは、`src/` に置くと Worker の成果物に載り、`infrastructure/` に
 * 置くと Supabase 実装と並んで結線の誤りに気づけなくなるためである（B-04 設計書 4章）。
 */
export class 記憶上の在庫品リポジトリ implements StockItemRepository {
  readonly #保存済み = new Map<string, StockItem>();

  async findById(householdId: HouseholdId, id: StockItemId) {
    const 在庫品 = this.#保存済み.get(id);
    // 世帯が違えば「無い」と答える。ここを緩めると世帯分離が破れる。
    return 在庫品 !== undefined && 在庫品.householdId === householdId ? 在庫品 : null;
  }

  async findByHousehold(householdId: HouseholdId) {
    return [...this.#保存済み.values()].filter((在庫品) => 在庫品.householdId === householdId);
  }

  async save(householdId: HouseholdId, stockItem: StockItem) {
    if (stockItem.householdId !== householdId) {
      throw new PantryRuleViolation(
        'save.householdMismatch',
        '引数の世帯と在庫品の世帯が食い違っている',
      );
    }
    this.#保存済み.set(stockItem.id, stockItem);
  }

  async delete(householdId: HouseholdId, id: StockItemId) {
    const 在庫品 = await this.findById(householdId, id);
    if (在庫品 !== null) this.#保存済み.delete(id);
  }
}
