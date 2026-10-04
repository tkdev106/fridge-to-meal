-- 在庫品の「献立に使う」（stock_items.use_for_meals）の列。backlog B-76 / FR-01 / FR-05 /
-- FR-43 / ADR-086。
--
-- **列を足す部分は `drizzle-kit` の生成物である。** 正はスキーマの側
-- （`apps/api/src/contexts/pantry/infrastructure/db/schema.ts`）にあり、ここを手で直さない。
--
-- 既定値 true は既存の行を埋めるためだけにあり、アプリは常に値を書く。列を足すだけなので、
-- 列を知らない api が動いたままでも壊れない。表を作らないので RLS の4点は要らない
-- （stock_items の RLS はそのまま効く）。

begin;

ALTER TABLE "stock_items" ADD COLUMN "use_for_meals" boolean DEFAULT true NOT NULL;

commit;
