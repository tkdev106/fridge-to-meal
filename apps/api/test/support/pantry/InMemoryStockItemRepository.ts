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
export class InMemoryStockItemRepository implements StockItemRepository {
  readonly #stored = new Map<string, StockItem>();
  /**
   * 世帯ごとの、これまでに保存した在庫品の名称（B-50d）。`delete` では消さない。
   * 同じ名称は1つとして持つ（完全一致。C-6）。
   */
  readonly #savedNamesByHousehold = new Map<HouseholdId, Set<string>>();

  async findById(householdId: HouseholdId, id: StockItemId) {
    const stockItem = this.#stored.get(id);
    // 世帯が違えば「無い」と答える。ここを緩めると世帯分離が破れる。
    return stockItem !== undefined && stockItem.householdId === householdId ? stockItem : null;
  }

  async findByHousehold(householdId: HouseholdId) {
    return [...this.#stored.values()].filter((stockItem) => stockItem.householdId === householdId);
  }

  async findSavedNamesByHousehold(householdId: HouseholdId): Promise<string[]> {
    // 内部の集合を渡さず、呼ぶたびに新しい配列を返す。
    return [...(this.#savedNamesByHousehold.get(householdId) ?? [])];
  }

  async save(householdId: HouseholdId, stockItem: StockItem) {
    if (stockItem.householdId !== householdId) {
      throw new PantryRuleViolation(
        'save.householdMismatch',
        '引数の世帯と在庫品の世帯が食い違っている',
      );
    }
    this.#stored.set(stockItem.id, stockItem);
    this.#rememberName(householdId, stockItem.name);
  }

  #rememberName(householdId: HouseholdId, name: string) {
    const savedNames = this.#savedNamesByHousehold.get(householdId) ?? new Set<string>();
    savedNames.add(name);
    this.#savedNamesByHousehold.set(householdId, savedNames);
  }

  async delete(householdId: HouseholdId, id: StockItemId) {
    const stockItem = await this.findById(householdId, id);
    if (stockItem !== null) this.#stored.delete(id);
  }
}
