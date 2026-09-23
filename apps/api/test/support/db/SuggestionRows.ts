import type { TransactionSql } from 'postgres';

/**
 * 提案の3表に行を1件置く／読む道具（B-45 設計 4章・規則12）。
 *
 * **子表の行を置くには親の提案が要る** — `(suggestion_id, household_id)` の複合外部キーが
 * 親を指す（設計 規則12）。本題は世帯の分離と表の制約なので、親を置く手順はここに隠す
 * （`docs/testing.md` 6章）。
 *
 * 時刻は固定値を既定に持つ。`new Date()` を読むと決定的でなくなる（同 5章）。
 */

/** 提案の3表。RLS は表ごとに同じ形で掛かる（設計 規則13）。 */
export const SUGGESTION_TABLES = [
  'suggestions',
  'suggestion_entries',
  'pantry_snapshot_stock_items',
] as const;

export type SuggestionTable = (typeof SUGGESTION_TABLES)[number];

/** 親（`suggestions`）を除いた2表。複合外部キーと `position` の守りが効く側（設計 規則12・14）。 */
export const SUGGESTION_CHILD_TABLES = [
  'suggestion_entries',
  'pantry_snapshot_stock_items',
] as const;

export type SuggestionChildTable = (typeof SUGGESTION_CHILD_TABLES)[number];

/** 提案の生成時刻の標本。 */
export const SUGGESTION_GENERATED_AT = new Date('2026-09-22T09:00:00.000Z');

/** 提案の1件が指す献立の識別子の標本。**献立の表には置かない**（設計 規則11）。 */
export const ENTRY_MEAL_ID = 'e5e5e5e5-ffff-4000-8000-00000000000a';

export type SuggestionRowProps = {
  readonly suggestionId: string;
  readonly householdId: string;
};

export type SuggestionChildRowProps = SuggestionRowProps & {
  readonly position?: number;
};

export function insertSuggestion(tx: TransactionSql, props: SuggestionRowProps): Promise<unknown> {
  return tx`
    insert into suggestions (id, household_id, generated_at)
    values (${props.suggestionId}, ${props.householdId}, ${SUGGESTION_GENERATED_AT})
  `;
}

export function insertSuggestionChildRow(
  tx: TransactionSql,
  table: SuggestionChildTable,
  props: SuggestionChildRowProps,
): Promise<unknown> {
  const position = props.position ?? 0;

  if (table === 'suggestion_entries') {
    return tx`
      insert into suggestion_entries (suggestion_id, household_id, position, meal_id, origin)
      values (${props.suggestionId}, ${props.householdId}, ${position}, ${ENTRY_MEAL_ID}, 'generated')
    `;
  }

  return tx`
    insert into pantry_snapshot_stock_items
      (suggestion_id, household_id, position, name, amount, expiry_date)
    values (${props.suggestionId}, ${props.householdId}, ${position}, 'にんじん', '2本', '2026-09-25')
  `;
}

/**
 * 子表のときだけ親の提案を置く。**親は本題ではない** — 子表の行が複合外部キーで
 * 親を指すので、置かないと本題の前に外部キーで落ちる（設計 規則12）。
 */
export async function prepareParentSuggestion(
  tx: TransactionSql,
  table: SuggestionTable,
  props: SuggestionRowProps,
): Promise<void> {
  if (table === 'suggestions') return;

  await insertSuggestion(tx, props);
}

/** 3表のどれにでも、その表の行を1件置く（親はここでは置かない）。 */
export async function insertSuggestionRow(
  tx: TransactionSql,
  table: SuggestionTable,
  props: SuggestionChildRowProps,
): Promise<void> {
  if (table === 'suggestions') {
    await insertSuggestion(tx, props);
    return;
  }

  await insertSuggestionChildRow(tx, table, props);
}

/**
 * ある提案に属する行の世帯 ID を読む。**識別子で絞って読む** — 表全体を読む主張は
 * しない（先行 `stockItemsRls.test.ts` 規則4）。
 */
export function selectSuggestionHouseholdIds(
  tx: TransactionSql,
  table: SuggestionTable,
  suggestionId: string,
): Promise<{ household_id: string }[]> {
  if (table === 'suggestions') {
    return tx<{ household_id: string }[]>`
      select household_id from suggestions where id = ${suggestionId}
    `;
  }

  return tx<{ household_id: string }[]>`
    select household_id from ${tx(table)} where suggestion_id = ${suggestionId}
  `;
}
