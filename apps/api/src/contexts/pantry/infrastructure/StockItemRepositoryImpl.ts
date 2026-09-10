import { and, eq } from 'drizzle-orm';
import type { StockItem } from '../domain/entity/StockItem.js';
import { createStockItem } from '../domain/entity/StockItem.js';
import type { StockItemRepository } from '../domain/repository/StockItemRepository.js';
import type { StockItemId } from '../domain/value/StockItemId.js';
import { stockItemIdOf } from '../domain/value/StockItemId.js';
import { amountOf } from '../domain/value/Amount.js';
import { expiryDateOf } from '../domain/value/ExpiryDate.js';
import { ingredientIdOf } from '../domain/value/IngredientId.js';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../shared/domain/HouseholdId.js';
import type { HouseholdTransaction } from './db/HouseholdTransaction.js';
import type { StockItemRow } from './db/schema.js';
import { stockItems } from './db/schema.js';

/**
 * `StockItemRepository` の実装（B-07 設計 4章・5章）。
 *
 * **トランザクションを開かず、接続も作らず、`set local` も張らない**（設計 規則1 /
 * ADR-029 決定3(a)）。受け取った1つの handle の上でだけ問い合わせる。
 */
export class StockItemRepositoryImpl implements StockItemRepository {
  constructor(private readonly tx: HouseholdTransaction) {}

  /**
   * **引数の世帯で必ず絞る**（設計 規則3 / C-9）。クレームで RLS が絞っていても `where` を
   * 外さない — 網は二重であり、片方を頼ると渡された世帯が実際には使われないままになる。
   *
   * 0行は `null`。他世帯を指したときも同じく `null` で、例外にしない（設計 規則4）。
   */
  async findById(householdId: HouseholdId, id: StockItemId): Promise<StockItem | null> {
    const 行 = await this.tx
      .select()
      .from(stockItems)
      .where(and(eq(stockItems.id, id), eq(stockItems.householdId, householdId)))
      .limit(1);

    const 見つかった行 = 行[0];
    return 見つかった行 === undefined ? null : 在庫品にする(見つかった行);
  }

  findByHousehold(_householdId: HouseholdId): Promise<StockItem[]> {
    throw new Error('未実装');
  }

  /**
   * 登録（FR-01）と更新（FR-05）を兼ねる**1文の upsert**（設計 規則7）。`findById` して
   * から分岐しない — 同じ id の同時保存を取りこぼす。
   *
   * 上書きするのは `name` / `ingredient_id` / `amount` / `expiry_date` の4列すべてで、
   * `null` もそのまま書く（分量や期限を**消す**更新が FR-05 の主役）。
   * **`household_id` は上書きしない** — 世帯は移らない（設計 規則8 / ADR-028）。
   *
   * 書き込みが DB に拒まれたら、**握りつぶさずそのまま伝える**（設計 7章）。他世帯の
   * 在庫品と id が衝突する保存は、RLS が更新の対象にできず失敗する（設計 規則13）。
   */
  async save(householdId: HouseholdId, stockItem: StockItem): Promise<void> {
    await this.tx
      .insert(stockItems)
      .values({
        id: stockItem.id,
        householdId: stockItem.householdId,
        name: stockItem.name,
        ingredientId: stockItem.ingredientId,
        amount: stockItem.amount,
        expiryDate: stockItem.expiryDate,
      })
      .onConflictDoUpdate({
        target: stockItems.id,
        set: {
          name: stockItem.name,
          ingredientId: stockItem.ingredientId,
          amount: stockItem.amount,
          expiryDate: stockItem.expiryDate,
        },
      });
  }

  delete(_householdId: HouseholdId, _id: StockItemId): Promise<void> {
    throw new Error('未実装');
  }
}

/**
 * 行から在庫品を組む。**各値の生成関数と `createStockItem` を必ず通す**（設計 規則11）。
 * 素のリテラルは型のブランドがあるため在庫品として扱えず、通さない実装は書けない。
 * 期限は `date` 列から `YYYY-MM-DD` の文字列として受け取る（設計 規則10）。
 */
function 在庫品にする(row: StockItemRow): StockItem {
  return createStockItem({
    id: stockItemIdOf(row.id),
    householdId: householdIdOf(row.householdId),
    name: row.name,
    ingredientId: row.ingredientId === null ? null : ingredientIdOf(row.ingredientId),
    amount: amountOf(row.amount),
    expiryDate: expiryDateOf(row.expiryDate),
  });
}
