import type { StockItem } from '../domain/entity/StockItem.js';
import type { StockItemRepository } from '../domain/repository/StockItemRepository.js';
import type { StockItemId } from '../domain/value/StockItemId.js';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { HouseholdTransaction } from './db/HouseholdTransaction.js';

/**
 * `StockItemRepository` の実装（B-07 設計 4章・5章）。
 *
 * **トランザクションを開かず、接続も作らず、`set local` も張らない**（設計 規則1 /
 * ADR-029 決定3(a)）。受け取った1つの handle の上でだけ問い合わせる。
 */
export class StockItemRepositoryImpl implements StockItemRepository {
  constructor(_tx: HouseholdTransaction) {}

  findById(_householdId: HouseholdId, _id: StockItemId): Promise<StockItem | null> {
    throw new Error('未実装');
  }

  findByHousehold(_householdId: HouseholdId): Promise<StockItem[]> {
    throw new Error('未実装');
  }

  save(_householdId: HouseholdId, _stockItem: StockItem): Promise<void> {
    throw new Error('未実装');
  }

  delete(_householdId: HouseholdId, _id: StockItemId): Promise<void> {
    throw new Error('未実装');
  }
}
