import { and, eq } from 'drizzle-orm';
import type { StockItem } from '../domain/entity/StockItem.js';
import { createStockItem } from '../domain/entity/StockItem.js';
import { PantryRuleViolation } from '../domain/error/PantryRuleViolation.js';
import type { StockItemRepository } from '../domain/repository/StockItemRepository.js';
import type { StockItemId } from '../domain/value/StockItemId.js';
import { stockItemIdOf } from '../domain/value/StockItemId.js';
import { amountOf } from '../domain/value/Amount.js';
import { expiryDateOf } from '../domain/value/ExpiryDate.js';
import { ingredientIdOf } from '../domain/value/IngredientId.js';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../shared/domain/HouseholdId.js';
import type { HouseholdTransaction } from '../../../shared/infrastructure/db/HouseholdTransaction.js';
import type { StockItemRow } from './db/schema.js';
import { stockItemNames, stockItems } from './db/schema.js';

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
    const rows = await this.tx
      .select()
      .from(stockItems)
      .where(and(eq(stockItems.id, id), eq(stockItems.householdId, householdId)))
      .limit(1);

    const foundRow = rows[0];
    return foundRow === undefined ? null : toStockItem(foundRow);
  }

  /**
   * その世帯の在庫品をすべて返す。0行なら空の配列で、`null` にも例外にもしない。
   *
   * **引数の世帯で必ず絞る**（設計 規則3 / C-9）。クレームで見えている在庫品でも、
   * 渡された世帯と食い違えば返さない。
   *
   * **並び順を約束しない**（設計 規則5）ので `order by` を足さない — 期限の近い順に
   * 見せるのは画面の要求であり、並べ替えはユースケース層が行う（B-05）。
   */
  async findByHousehold(householdId: HouseholdId): Promise<StockItem[]> {
    const rows = await this.tx
      .select()
      .from(stockItems)
      .where(eq(stockItems.householdId, householdId));

    return rows.map(toStockItem);
  }

  /**
   * その世帯でこれまでに保存した在庫品の名称をすべて返す（B-50d / ADR-069）。0行なら空の配列。
   *
   * **引数の世帯で必ず絞る**（C-9）。クレームで見えている名称でも、渡された世帯と食い違えば
   * 返さない。全件を返す口なので**並び順を約束せず**、`order by` を足さない（並べるのは
   * `ListSavedStockItemNames`）。
   */
  async findSavedNamesByHousehold(householdId: HouseholdId): Promise<string[]> {
    const rows = await this.tx
      .select({ name: stockItemNames.name })
      .from(stockItemNames)
      .where(eq(stockItemNames.householdId, householdId));

    return rows.map((row) => row.name);
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
   *
   * **`on conflict do update` に世帯の条件を足さない。** 4メソッドのうちここだけが
   * 引数の世帯を `where` で使わないが、意図してそうしている — 条件を足すと、他世帯の
   * id と衝突した保存が**エラーではなく「0行を更新した成功」**に変わり、拒否が沈黙する。
   * 衝突を失敗として見せているのは RLS であり、ここでは網を1枚に保つ（設計 規則13）。
   * 引数と在庫品の世帯の食い違いは、この文の手前で `save.householdMismatch` が断つ。
   */
  async save(householdId: HouseholdId, stockItem: StockItem): Promise<void> {
    if (stockItem.householdId !== householdId) {
      throw new PantryRuleViolation(
        'save.householdMismatch',
        '引数の世帯と在庫品の世帯が食い違っている',
      );
    }

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

    // 名称を同じ handle の上で残す（B-50d / ADR-069）。在庫品と同じトランザクションなので、
    // 片方だけが残ることは無い。同じ世帯の同じ名称は主キーが1行に畳み、2度目は断らない。
    // **主キーに世帯が入るので、`do nothing` が他世帯の行に黙って当たることは無い**
    // （献立の保存が `do nothing` を避けた理由は、ここには当たらない）。
    await this.tx
      .insert(stockItemNames)
      .values({ householdId: stockItem.householdId, name: stockItem.name })
      .onConflictDoNothing({ target: [stockItemNames.householdId, stockItemNames.name] });
  }

  /**
   * 物理削除する（FR-06）。**名称の表（`stock_item_names`）には触れない** — 消した在庫品の名称も
   * 食材名の補完に残す（B-50d / ADR-069）。献立は材料を複製済みで在庫品を参照しないため、消しても
   * 献立は壊れない（C-5）。
   *
   * `id` と `householdId` の**両方**で絞る（設計 規則3・12 / C-9）。**行が無くても
   * 他世帯を指していても、何もせずに成功する** — 影響行数を見ず、例外にしない。
   * 「無い」を利用者に断るのはユースケース層の役目である（ADR-027）。
   */
  async delete(householdId: HouseholdId, id: StockItemId): Promise<void> {
    await this.tx
      .delete(stockItems)
      .where(and(eq(stockItems.id, id), eq(stockItems.householdId, householdId)));
  }
}

/**
 * 行から在庫品を組む。**各値の生成関数と `createStockItem` を必ず通す**（設計 規則11）。
 * 素のリテラルは型のブランドがあるため在庫品として扱えず、通さない実装は書けない。
 * 期限は `date` 列から `YYYY-MM-DD` の文字列として受け取る（設計 規則10）。
 */
function toStockItem(row: StockItemRow): StockItem {
  return createStockItem({
    id: stockItemIdOf(row.id),
    householdId: householdIdOf(row.householdId),
    name: row.name,
    ingredientId: row.ingredientId === null ? null : ingredientIdOf(row.ingredientId),
    amount: amountOf(row.amount),
    expiryDate: expiryDateOf(row.expiryDate),
  });
}
