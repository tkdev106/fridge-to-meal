import { boolean, check, date, index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * `stock_items` の表の正（ADR-029 決定2）。**SQL を先に書いて、ここを後追いさせない。**
 * マイグレーションは `pnpm --filter @fridge-to-meal/api db:generate` で生成する。
 *
 * **生成物には RLS の4点を手で足す**（有効化・強制・4ポリシー・権限）。落とすと、
 * 表だけが RLS 無しで実在する状態が生まれる。手順は `supabase/migrations/README.md`、
 * 落ちないことの守りは `apps/api/test/migrations/tableMigrations.test.ts`（表ごとに見る。B-44 設計 規則13）。
 *
 * **ここは `drizzle-orm` 以外を import しない。** ドメインの型を持ち込まず、ドメインへ
 * 渡しもしない。行とドメインの変換は `StockItemRepositoryImpl` が担う（ADR-002）。
 */
export const stockItems = pgTable(
  'stock_items',
  {
    /**
     * 既定値を置かない。識別子はアプリが発行して渡す（ADR-026）。既定値があると、
     * 渡し忘れが別の値で黙って成功し、返した DTO の id と DB の id がずれる。
     */
    id: uuid('id').primaryKey(),

    /**
     * 既定値（`auth.uid()`）を置かない。渡し忘れを隠すうえ、共有が要件になった日には
     * 値の意味が変わる（世帯 id ≠ 利用者 id）ため、そのとき必ず消すことになる（ADR-028）。
     */
    householdId: uuid('household_id').notNull(),

    name: text('name').notNull(),

    /**
     * カタログの食材を指す。**外部キーを張らない** — コンテキストをまたぐ参照は識別子で
     * 行い（ADR-008）、カタログに無い名前でも登録が止まらないことが要件（FR-03）。
     */
    ingredientId: uuid('ingredient_id'),

    /** 自由文字列。数値と単位に分解しない（ADR-010）。「無い」を null の一通りに保つ。 */
    amount: text('amount'),

    /**
     * `date` 型にする。`YYYY-MM-DD` で読み書きでき、期限の表現と一致する。
     * 時刻とタイムゾーンが入ると、文字列比較による並びが実行環境で揺れる。
     */
    expiryDate: date('expiry_date'),

    /**
     * 献立に使うかどうか（FR-43 / ADR-086）。既定値は移行で既存の行を `true` に埋める
     * ためだけにあり、アプリは常に値を書く。
     */
    useForMeals: boolean('use_for_meals').notNull().default(true),
  },
  (t) => [
    // 一覧は必ず世帯で絞る（C-9）。期限順の並べ替えはユースケースが行うため、
    // expiry_date の索引は先回りして置かない。
    index('stock_items_household_id_idx').on(t.householdId),
    check('stock_items_name_not_blank', sql`btrim(${t.name}) <> ''`),
    check('stock_items_amount_not_blank', sql`${t.amount} is null or btrim(${t.amount}) <> ''`),
  ],
);

export type StockItemRow = typeof stockItems.$inferSelect;
export type NewStockItemRow = typeof stockItems.$inferInsert;

/**
 * これまでに保存した在庫品の名称（B-50d / FR-02 / ADR-069）。`stock_items` の行を消しても
 * ここは消えないので、消した在庫品の名称も食材名の補完に残る。
 *
 * **主キーは (世帯, 名称) の組。** 同じ世帯の同じ名称（完全一致。C-6）は1行に畳む。世帯が
 * 主キーに入るので、`on conflict do nothing` が他世帯の行に黙って当たることは無い。
 * 世帯は自分で持ち、RLS の述語は `stock_items` と同じ形にする（ADR-056）。
 */
export const stockItemNames = pgTable(
  'stock_item_names',
  {
    /** 既定値を置かない（`stock_items.household_id` と同じ理由。ADR-028）。 */
    householdId: uuid('household_id').notNull(),

    name: text('name').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.name] }),
    check('stock_item_names_name_not_blank', sql`btrim(${t.name}) <> ''`),
  ],
);
