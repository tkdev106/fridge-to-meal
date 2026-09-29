import type { TransactionSql } from 'postgres';

/**
 * 世帯のデータの9表で、ある世帯の行を数える道具（B-56a 規則2 / NFR-13）。
 *
 * **世帯で絞って数える** — 表全体を数える主張はしない（先行 `MealRows.ts` の `selectHouseholdIds`。
 * 表はファイルとケースをまたいで共有される）。クレームを張ったトランザクションの中で呼ぶ —
 * 張らなければ RLS が0行を返し、「消えた」と区別がつかない。
 */

/** 世帯のデータの9表（B-56a 規則2）。在庫の2表・献立の4表・提案の3表。 */
export const HOUSEHOLD_DATA_TABLES = [
  'stock_items',
  'stock_item_names',
  'meals',
  'meal_ingredients',
  'cooking_steps',
  'cooking_records',
  'suggestions',
  'suggestion_entries',
  'pantry_snapshot_stock_items',
] as const;

export type HouseholdDataTable = (typeof HOUSEHOLD_DATA_TABLES)[number];

export type HouseholdRowCounts = Record<HouseholdDataTable, number>;

/** 9表それぞれの、その世帯の行数を返す。 */
export async function countHouseholdRows(
  tx: TransactionSql,
  householdId: string,
): Promise<HouseholdRowCounts> {
  const counts = {} as Record<HouseholdDataTable, number>;
  for (const table of HOUSEHOLD_DATA_TABLES) {
    const [row] = await tx<{ count: number }[]>`
      select count(*)::int as count from ${tx(table)} where household_id = ${householdId}
    `;
    counts[table] = row?.count ?? 0;
  }
  return counts;
}
