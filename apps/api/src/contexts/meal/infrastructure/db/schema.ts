import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * 献立（`Meal`）の4表の正（ADR-029 決定2）。**SQL を先に書いて、ここを後追いさせない。**
 * マイグレーションは `pnpm --filter @fridge-to-meal/api db:generate` で生成する。
 *
 * **生成物には RLS の4点を手で足す**（有効化・強制・4ポリシー・権限）。4表ぶん＝16本の
 * ポリシーが要る。落とすと、表だけが RLS 無しで実在する状態が生まれる。手順は
 * `supabase/migrations/README.md`、落ちないことの守りは
 * `apps/api/test/migrations/tableMigrations.test.ts`（**表ごとに見る**。B-44 設計 規則13）。
 *
 * **ここは `drizzle-orm` 以外を import しない。** ドメインの型を持ち込まず、ドメインへ
 * 渡しもしない。行とドメインの変換は `MealRepositoryImpl` が担う（ADR-002）。
 *
 * **子表は世帯を自分で持つ**（B-44 設計 規則10・11）。親への `exists` に寄りかからせず、
 * 4表の RLS の述語を1つの形に揃えるためである。親と食い違う行は
 * `(meal_id, household_id)` の複合外部キーが**型ではなく DB の側で**不可能にする。
 *
 * **外部キーに `on delete` を書かない**（同 10章）。献立を消す経路は無く（保持期間は未決）、
 * 先回りして決めた消し方は、消す要件が来たときに読み直されないまま効いてしまう。
 */
export const meals = pgTable(
  'meals',
  {
    /**
     * 既定値を置かない。識別子はアプリが発行して渡す（ADR-026）。既定値があると、
     * 渡し忘れが別の値で黙って成功し、返した集約の id と DB の id がずれる。
     */
    id: uuid('id').primaryKey(),

    /**
     * 既定値を置かない。渡し忘れを隠すうえ、参加した利用者では世帯 id ≠ 利用者 id である
     * （ADR-087 決定1）。
     */
    householdId: uuid('household_id').notNull(),

    title: text('title').notNull(),

    /**
     * `timestamptz` に置く。時点そのものを持ち、表示の時差は読む側が決める
     * （`DateTime` は UTC の正準形。B-44 設計 規則6）。
     */
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    /**
     * 子表の複合外部キーの相手になる（設計 規則10）。`id` は単独でも主キーだが、
     * **参照先には参照する列の組そのものへの一意が要る。**
     */
    unique('meals_id_household_id_unique').on(t.id, t.householdId),
    // 一覧は必ず世帯で絞る（C-9）。並べ替えはユースケースが行うため、
    // generated_at の索引は先回りして置かない。
    index('meals_household_id_idx').on(t.householdId),
    check('meals_title_not_blank', sql`btrim(${t.title}) <> ''`),
  ],
);

export const mealIngredients = pgTable(
  'meal_ingredients',
  {
    mealId: uuid('meal_id').notNull(),
    householdId: uuid('household_id').notNull(),

    /**
     * 集約の配列の添字そのもの（設計 10章）。詰め直す経路を作らない — 作ると
     * C-3 の「生成後に編集できない」が実質崩れる。
     */
    position: integer('position').notNull(),

    /** 充足は名称の完全一致で突き合わせる（C-6）。在庫品の識別子は持たない（C-5）。 */
    name: text('name').notNull(),

    /**
     * `main` か `seasoning`（C-16）。**enum 型を作らず check で断つ**
     * （設計 規則15。先行の `stock_items` も check を使っている）。
     */
    kind: text('kind').notNull(),

    /** 自由文字列。数値と単位に分解しない（ADR-010）。「無い」を null の一通りに保つ。 */
    amount: text('amount'),
  },
  (t) => [
    primaryKey({ name: 'meal_ingredients_pkey', columns: [t.mealId, t.position] }),
    foreignKey({
      name: 'meal_ingredients_meal_id_household_id_fk',
      columns: [t.mealId, t.householdId],
      foreignColumns: [meals.id, meals.householdId],
    }),
    index('meal_ingredients_household_id_idx').on(t.householdId),
    check('meal_ingredients_position_not_negative', sql`${t.position} >= 0`),
    check('meal_ingredients_name_not_blank', sql`btrim(${t.name}) <> ''`),
    check('meal_ingredients_kind_known', sql`${t.kind} in ('main', 'seasoning')`),
    check(
      'meal_ingredients_amount_not_blank',
      sql`${t.amount} is null or btrim(${t.amount}) <> ''`,
    ),
  ],
);

export const cookingSteps = pgTable(
  'cooking_steps',
  {
    mealId: uuid('meal_id').notNull(),
    householdId: uuid('household_id').notNull(),
    position: integer('position').notNull(),
    body: text('body').notNull(),
  },
  (t) => [
    primaryKey({ name: 'cooking_steps_pkey', columns: [t.mealId, t.position] }),
    foreignKey({
      name: 'cooking_steps_meal_id_household_id_fk',
      columns: [t.mealId, t.householdId],
      foreignColumns: [meals.id, meals.householdId],
    }),
    index('cooking_steps_household_id_idx').on(t.householdId),
    check('cooking_steps_position_not_negative', sql`${t.position} >= 0`),
    check('cooking_steps_body_not_blank', sql`btrim(${t.body}) <> ''`),
  ],
);

export const cookingRecords = pgTable(
  'cooking_records',
  {
    mealId: uuid('meal_id').notNull(),
    householdId: uuid('household_id').notNull(),

    /**
     * 記録は**追加のみ**（C-3）。`(meal_id, position)` を主キーに取ることで、同じ位置の
     * 二重書きは弾きつつ、位置を進めた記録は何件でも足せる（設計 規則9）。
     */
    position: integer('position').notNull(),

    cookedAt: timestamp('cooked_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'cooking_records_pkey', columns: [t.mealId, t.position] }),
    foreignKey({
      name: 'cooking_records_meal_id_household_id_fk',
      columns: [t.mealId, t.householdId],
      foreignColumns: [meals.id, meals.householdId],
    }),
    index('cooking_records_household_id_idx').on(t.householdId),
    check('cooking_records_position_not_negative', sql`${t.position} >= 0`),
  ],
);

/**
 * 提案（`Suggestion`）の3表（B-45）。献立の4表と同じ決めごとに従う — 識別子と世帯に
 * 既定値を置かない、子表は世帯を自分で持つ、`(suggestion_id, household_id)` の複合外部キーで
 * 親と食い違う行を DB の側で断つ、外部キーに `on delete` を書かない（ADR-056）。
 *
 * **生成物には RLS の4点を手で足す**（3表ぶん＝12本のポリシー）。
 */
export const suggestions = pgTable(
  'suggestions',
  {
    id: uuid('id').primaryKey(),
    householdId: uuid('household_id').notNull(),

    /** 1日の上限（NFR-C2）と「最新の提案」（C-7）の両方がこの時点で数え・並べる。 */
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    /** 子表の複合外部キーの相手になる（参照先には参照する列の組そのものへの一意が要る）。 */
    unique('suggestions_id_household_id_unique').on(t.id, t.householdId),
    // generated_at の索引は先回りして置かない（B-45 設計 2章「作らないもの」）。
    index('suggestions_household_id_idx').on(t.householdId),
  ],
);

export const suggestionEntries = pgTable(
  'suggestion_entries',
  {
    suggestionId: uuid('suggestion_id').notNull(),
    householdId: uuid('household_id').notNull(),

    /** 集約の配列の添字そのもの。C-12 で呼ぶ側が決めた順を保つ（詰め直さない）。 */
    position: integer('position').notNull(),

    /**
     * **献立への外部キーを張らない**（B-45 設計 規則11 / ADR-008）。集約をまたぐ参照は
     * 識別子であり、張ると献立を消す経路（保持期間は未決）を先回りして決めることになる。
     */
    mealId: uuid('meal_id').notNull(),

    /** `generated` か `reused`（C-15）。enum 型を作らず check で断つ。 */
    origin: text('origin').notNull(),
  },
  (t) => [
    primaryKey({ name: 'suggestion_entries_pkey', columns: [t.suggestionId, t.position] }),
    foreignKey({
      name: 'suggestion_entries_suggestion_id_household_id_fk',
      columns: [t.suggestionId, t.householdId],
      foreignColumns: [suggestions.id, suggestions.householdId],
    }),
    index('suggestion_entries_household_id_idx').on(t.householdId),
    check('suggestion_entries_position_not_negative', sql`${t.position} >= 0`),
    check('suggestion_entries_origin_known', sql`${t.origin} in ('generated', 'reused')`),
  ],
);

export const pantrySnapshotStockItems = pgTable(
  'pantry_snapshot_stock_items',
  {
    suggestionId: uuid('suggestion_id').notNull(),
    householdId: uuid('household_id').notNull(),

    /** 在庫スナップショットの中の並び（ADR-037）。配列の添字そのもの。 */
    position: integer('position').notNull(),

    name: text('name').notNull(),

    /** 自由文字列（ADR-010）。「無い」を null の一通りに保つ。 */
    amount: text('amount'),

    /** 期限（ADR-036 決定1）。`YYYY-MM-DD` のまま往復させる。 */
    expiryDate: date('expiry_date'),
  },
  (t) => [
    primaryKey({
      name: 'pantry_snapshot_stock_items_pkey',
      columns: [t.suggestionId, t.position],
    }),
    foreignKey({
      name: 'pantry_snapshot_stock_items_suggestion_id_household_id_fk',
      columns: [t.suggestionId, t.householdId],
      foreignColumns: [suggestions.id, suggestions.householdId],
    }),
    index('pantry_snapshot_stock_items_household_id_idx').on(t.householdId),
    check('pantry_snapshot_stock_items_position_not_negative', sql`${t.position} >= 0`),
    check('pantry_snapshot_stock_items_name_not_blank', sql`btrim(${t.name}) <> ''`),
    check(
      'pantry_snapshot_stock_items_amount_not_blank',
      sql`${t.amount} is null or btrim(${t.amount}) <> ''`,
    ),
  ],
);

export type MealRow = typeof meals.$inferSelect;
export type NewMealRow = typeof meals.$inferInsert;
export type MealIngredientRow = typeof mealIngredients.$inferSelect;
export type NewMealIngredientRow = typeof mealIngredients.$inferInsert;
export type CookingStepRow = typeof cookingSteps.$inferSelect;
export type NewCookingStepRow = typeof cookingSteps.$inferInsert;
export type CookingRecordRow = typeof cookingRecords.$inferSelect;
export type NewCookingRecordRow = typeof cookingRecords.$inferInsert;
export type SuggestionRow = typeof suggestions.$inferSelect;
export type NewSuggestionRow = typeof suggestions.$inferInsert;
export type SuggestionEntryRow = typeof suggestionEntries.$inferSelect;
export type NewSuggestionEntryRow = typeof suggestionEntries.$inferInsert;
export type PantrySnapshotStockItemRow = typeof pantrySnapshotStockItems.$inferSelect;
export type NewPantrySnapshotStockItemRow = typeof pantrySnapshotStockItems.$inferInsert;
