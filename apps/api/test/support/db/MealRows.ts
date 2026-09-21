import type { TransactionSql } from 'postgres';

/**
 * 献立の4表に行を1件置く／読む道具（B-44 設計 4章・規則10）。
 *
 * **子表の行を置くには親の献立が要る** — `(meal_id, household_id)` の複合外部キーが
 * 親を指す（設計 規則10）。本題は世帯の分離と表の制約なので、親を置く手順はここに隠す
 * （`docs/testing.md` 6章）。
 *
 * 時刻は固定値を既定に持つ。`new Date()` を読むと決定的でなくなる（同 5章）。
 */

/** 献立の4表。RLS は表ごとに同じ形で掛かる（設計 規則11）。 */
export const MEAL_TABLES = [
  'meals',
  'meal_ingredients',
  'cooking_steps',
  'cooking_records',
] as const;

export type MealTable = (typeof MEAL_TABLES)[number];

/** 親（`meals`）を除いた3表。複合外部キーと `position` の守りが効く側（設計 規則10・16）。 */
export const MEAL_CHILD_TABLES = ['meal_ingredients', 'cooking_steps', 'cooking_records'] as const;

export type MealChildTable = (typeof MEAL_CHILD_TABLES)[number];

/** 献立の生成時刻の標本。 */
export const GENERATED_AT = new Date('2026-09-20T09:00:00.000Z');

/** 調理した時刻の標本。 */
export const COOKED_AT = new Date('2026-09-20T18:30:00.000Z');

export type MealRowProps = {
  readonly mealId: string;
  readonly householdId: string;
  readonly title?: string;
};

export type ChildRowProps = {
  readonly mealId: string;
  readonly householdId: string;
  readonly position?: number;
};

export function insertMeal(tx: TransactionSql, props: MealRowProps): Promise<unknown> {
  return tx`
    insert into meals (id, household_id, title, generated_at)
    values (${props.mealId}, ${props.householdId}, ${props.title ?? 'にんじんの煮物'}, ${GENERATED_AT})
  `;
}

export function insertChildRow(
  tx: TransactionSql,
  table: MealChildTable,
  props: ChildRowProps,
): Promise<unknown> {
  const position = props.position ?? 0;

  if (table === 'meal_ingredients') {
    return tx`
      insert into meal_ingredients (meal_id, household_id, position, name, kind, amount)
      values (${props.mealId}, ${props.householdId}, ${position}, 'にんじん', 'main', '200g')
    `;
  }

  if (table === 'cooking_steps') {
    return tx`
      insert into cooking_steps (meal_id, household_id, position, body)
      values (${props.mealId}, ${props.householdId}, ${position}, 'にんじんを切る')
    `;
  }

  return tx`
    insert into cooking_records (meal_id, household_id, position, cooked_at)
    values (${props.mealId}, ${props.householdId}, ${position}, ${COOKED_AT})
  `;
}

/**
 * 子表のときだけ親の献立を置く。**親は本題ではない** — 子表の行が複合外部キーで
 * 親を指すので、置かないと本題の前に外部キーで落ちる（設計 規則10）。
 */
export async function prepareParentMeal(
  tx: TransactionSql,
  table: MealTable,
  props: MealRowProps,
): Promise<void> {
  if (table === 'meals') return;

  await insertMeal(tx, props);
}

/** 4表のどれにでも、その表の行を1件置く（親はここでは置かない）。 */
export async function insertRow(
  tx: TransactionSql,
  table: MealTable,
  props: MealRowProps & { readonly position?: number },
): Promise<void> {
  if (table === 'meals') {
    await insertMeal(tx, props);
    return;
  }

  await insertChildRow(tx, table, props);
}

/**
 * ある献立に属する行の世帯 ID を読む。**識別子で絞って読む** — 表全体を読む主張は
 * しない（先行 `stockItemsRls.test.ts` 規則4）。
 */
export function selectHouseholdIds(
  tx: TransactionSql,
  table: MealTable,
  mealId: string,
): Promise<{ household_id: string }[]> {
  if (table === 'meals') {
    return tx<{ household_id: string }[]>`
      select household_id from meals where id = ${mealId}
    `;
  }

  return tx<{ household_id: string }[]>`
    select household_id from ${tx(table)} where meal_id = ${mealId}
  `;
}
