import { and, asc, count, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Suggestion } from '../domain/entity/Suggestion.js';
import { createSuggestion } from '../domain/entity/Suggestion.js';
import { MealRuleViolation } from '../domain/error/MealRuleViolation.js';
import type { SuggestionRepository } from '../domain/repository/SuggestionRepository.js';
import { amountOf } from '../domain/value/Amount.js';
import type { DateTime } from '../domain/value/DateTime.js';
import { dateTimeOf } from '../domain/value/DateTime.js';
import { expiryDateOf } from '../domain/value/ExpiryDate.js';
import { mealIdOf } from '../domain/value/MealId.js';
import { createPantrySnapshot } from '../domain/value/PantrySnapshot.js';
import type { StockItem } from '../domain/value/StockItem.js';
import { createStockItem } from '../domain/value/StockItem.js';
import type { SuggestionEntry, SuggestionEntryOrigin } from '../domain/value/SuggestionEntry.js';
import { createSuggestionEntry } from '../domain/value/SuggestionEntry.js';
import { suggestionIdOf } from '../domain/value/SuggestionId.js';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../shared/domain/HouseholdId.js';
import type { HouseholdTransaction } from './db/HouseholdTransaction.js';
import type { PantrySnapshotStockItemRow, SuggestionEntryRow, SuggestionRow } from './db/schema.js';
import { pantrySnapshotStockItems, suggestionEntries, suggestions } from './db/schema.js';

/**
 * `SuggestionRepository` の実装（B-45 設計 4章・5章）。
 *
 * **トランザクションを開かず、接続も作らず、`set local` も張らない**（設計 規則1 /
 * ADR-029 決定3(a)）。受け取った1つの handle の上でだけ問い合わせる。
 */
export class SuggestionRepositoryImpl implements SuggestionRepository {
  constructor(private readonly tx: HouseholdTransaction) {}

  /**
   * 生成日時の降順、同時刻は識別子の降順で最大 `limit` 件を返す（設計 規則3 / ADR-038）。
   * 0件なら空の配列。
   *
   * **引数の世帯で必ず絞る**（設計 規則2 / C-9）。クレームで RLS が絞っていても `where` を
   * 外さない — 網は二重であり、片方を頼ると渡された世帯が実際には使われないままになる。
   * 子表も自分の `household_id` で絞り、親へ結合しない（ADR-056）。
   *
   * 行の組が不変条件に反していれば、生成関数が投げる `MealRuleViolation` を
   * **握りつぶさずそのまま伝える**（設計 規則6 / 7章）。
   */
  async findRecentByHousehold(householdId: HouseholdId, limit: number): Promise<Suggestion[]> {
    const suggestionRows = await this.tx
      .select()
      .from(suggestions)
      .where(eq(suggestions.householdId, householdId))
      // 順の定義はここ1か所だけに置く。`findLatestByHousehold` はこの口の先頭1件である
      // （設計 規則4）。同時刻を識別子で閉じないと、限って取る行が実行ごとに変わる（C-12）。
      .orderBy(desc(suggestions.generatedAt), desc(suggestions.id))
      .limit(limit);
    if (suggestionRows.length === 0) return [];

    const suggestionIds = suggestionRows.map((row) => row.id);

    // 集約の内部の並びは `position` の昇順で保つ（設計 規則5）。
    const entryRows = await this.tx
      .select()
      .from(suggestionEntries)
      .where(
        and(
          eq(suggestionEntries.householdId, householdId),
          inArray(suggestionEntries.suggestionId, suggestionIds),
        ),
      )
      .orderBy(asc(suggestionEntries.position));
    const stockItemRows = await this.tx
      .select()
      .from(pantrySnapshotStockItems)
      .where(
        and(
          eq(pantrySnapshotStockItems.householdId, householdId),
          inArray(pantrySnapshotStockItems.suggestionId, suggestionIds),
        ),
      )
      .orderBy(asc(pantrySnapshotStockItems.position));

    // 子は親ごとに配り直す。まとめて引いた行をそのまま渡すと、2件以上の提案で
    // 提案の1件と在庫品が取り違う（設計 規則5）。
    const entriesBySuggestion = groupBySuggestion(entryRows);
    const stockItemsBySuggestion = groupBySuggestion(stockItemRows);

    return suggestionRows.map((suggestionRow) =>
      toSuggestion({
        suggestionRow,
        entryRows: entriesBySuggestion.get(suggestionRow.id) ?? [],
        stockItemRows: stockItemsBySuggestion.get(suggestionRow.id) ?? [],
      }),
    );
  }

  /** `findRecentByHousehold` と同じ順の先頭1件。無ければ `null`（設計 規則4 / C-7）。 */
  async findLatestByHousehold(householdId: HouseholdId): Promise<Suggestion | null> {
    const [latest] = await this.findRecentByHousehold(householdId, 1);
    return latest ?? null;
  }

  /**
   * 提案を保存する（C-14）。引数の世帯と提案の世帯が食い違えば `save.householdMismatch` で
   * 断り、**1行も書かない**（設計 7章）。RLS の拒否に任せないのは、任せると `rule` の付かない
   * 別の失敗になり、呼ぶ側が理由で分岐できないためである。
   *
   * **親 → 提案の1件 → 在庫品の順に素の insert で書く**（設計 規則8）。読み比べも
   * `on conflict` も置かない — 提案は生成後に完全に不変で、追加される部分も無い。同じ
   * 識別子の2度目は親の主キーが拒み、**その DB の失敗を包まずそのまま伝える**
   * （ADR-057 理由(3)）。書き込みが RLS に拒まれたときも同じく伝える。
   */
  async save(householdId: HouseholdId, suggestion: Suggestion): Promise<void> {
    if (suggestion.householdId !== householdId) {
      throw new MealRuleViolation(
        'save.householdMismatch',
        '引数の世帯と提案の世帯が食い違っている',
      );
    }

    await this.tx.insert(suggestions).values({
      id: suggestion.id,
      householdId,
      // `timestamptz` に `Date` を渡す（設計 規則7）。文字列のまま持たない。
      generatedAt: new Date(suggestion.generatedAt),
    });

    await this.tx.insert(suggestionEntries).values(
      suggestion.entries.map((entry, position) => ({
        suggestionId: suggestion.id,
        householdId,
        // 位置は集約の配列の添字そのもの（設計 規則5）。詰め直す経路を作らない。
        position,
        mealId: entry.mealId,
        origin: entry.origin,
      })),
    );

    const stockItems = suggestion.pantrySnapshot.stockItems;
    // 在庫0件の在庫スナップショットは在庫品の表に1行も書かない（設計 規則9）。
    if (stockItems.length === 0) return;

    await this.tx.insert(pantrySnapshotStockItems).values(
      stockItems.map((stockItem, position) => ({
        suggestionId: suggestion.id,
        householdId,
        position,
        name: stockItem.name,
        // **分量と期限の `null` はそのまま書く**（ADR-010 / ADR-036 / 設計 規則7）。
        amount: stockItem.amount,
        expiryDate: stockItem.expiryDate,
      })),
    );
  }

  /**
   * 世帯・生成の由来・窓の下端の3つで絞った**提案の件数**を返す（設計 規則10 /
   * ADR-049 決定1・結果4 / NFR-C2）。0件なら 0。
   *
   * **数えるのは親の行であって、提案の1件の行ではない** — 生成3件の提案も1回である。
   * 由来は子表にしか無いため、子は「由来が生成の提案の識別子」を引く副問い合わせに
   * だけ使い、親を1行ずつ数える（子へ結合して数えると件数が提案の1件ぶん膨らむ）。
   *
   * **親も子も引数の世帯で絞る**（設計 規則2 / C-9 / ADR-056）。RLS に任せない。
   * **下端は含む**（`generated_at >= since`）。`count` は `number` に写して返す。
   */
  async countGeneratedByHouseholdSince(householdId: HouseholdId, since: DateTime): Promise<number> {
    const generatedSuggestionIds = this.tx
      .select({ suggestionId: suggestionEntries.suggestionId })
      .from(suggestionEntries)
      .where(
        and(
          eq(suggestionEntries.householdId, householdId),
          eq(suggestionEntries.origin, 'generated'),
        ),
      );

    const [row] = await this.tx
      .select({ count: count() })
      .from(suggestions)
      .where(
        and(
          eq(suggestions.householdId, householdId),
          // `timestamptz` とは `Date` で比べる（設計 規則7）。
          gte(suggestions.generatedAt, new Date(since)),
          inArray(suggestions.id, generatedSuggestionIds),
        ),
      );
    return row?.count ?? 0;
  }
}

/** `position` の昇順を保ったまま、提案ごとに配り直す。 */
function groupBySuggestion<T extends { suggestionId: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const rowsOfSuggestion = grouped.get(row.suggestionId);
    if (rowsOfSuggestion === undefined) {
      grouped.set(row.suggestionId, [row]);
    } else {
      rowsOfSuggestion.push(row);
    }
  }
  return grouped;
}

/**
 * 行から提案を組む。**各値の生成関数と `createSuggestion` を必ず通す**（設計 規則6）。
 * 日時は `timestamptz` から `Date` として受け取り、UTC の正準形にしてから
 * `dateTimeOf` に通す（設計 規則7）。
 */
function toSuggestion(rows: {
  suggestionRow: SuggestionRow;
  entryRows: readonly SuggestionEntryRow[];
  stockItemRows: readonly PantrySnapshotStockItemRow[];
}): Suggestion {
  return createSuggestion({
    id: suggestionIdOf(rows.suggestionRow.id),
    householdId: householdIdOf(rows.suggestionRow.householdId),
    entries: rows.entryRows.map(toSuggestionEntry),
    pantrySnapshot: createPantrySnapshot({ stockItems: rows.stockItemRows.map(toStockItem) }),
    generatedAt: dateTimeOf(rows.suggestionRow.generatedAt.toISOString()),
  });
}

function toSuggestionEntry(row: SuggestionEntryRow): SuggestionEntry {
  return createSuggestionEntry({
    mealId: mealIdOf(row.mealId),
    // 列の値は check（`origin in ('generated', 'reused')`）が守っている（設計 規則14 / C-15）。
    origin: row.origin as SuggestionEntryOrigin,
  });
}

function toStockItem(row: PantrySnapshotStockItemRow): StockItem {
  return createStockItem({
    name: row.name,
    amount: amountOf(row.amount),
    // `date` 列は `YYYY-MM-DD` の文字列のまま往復する（設計 規則7）。
    expiryDate: expiryDateOf(row.expiryDate),
  });
}
