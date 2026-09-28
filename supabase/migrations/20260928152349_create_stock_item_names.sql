-- 保存したことのある在庫品の名称（stock_item_names）の表と RLS ポリシー。backlog B-50d /
-- FR-02 / ADR-068 / ADR-056 / C-9。
--
-- **表を作る部分は `drizzle-kit` の生成物である。** 正はスキーマの側
-- （`apps/api/src/contexts/pantry/infrastructure/db/schema.ts`）にあり、ここを手で直さない。
-- **下の RLS の4点だけは手で足す**（生成では出ない）。手順は README、落ちないことの守りは
-- `apps/api/test/migrations/tableMigrations.test.ts`（表ごとに4点を見る。ADR-056）。
--
-- **既存の stock_items から遡って入れない**（ADR-068 決定2）。今ある在庫品の名称は
-- 食材名の補完の出所に残っている。
--
-- **表・RLS の有効化・ポリシーを同じ1ファイルに置き、1トランザクションで通す。** 分けると
-- RLS の無い表が実在する窓ができる。

begin;

CREATE TABLE "stock_item_names" (
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "stock_item_names_household_id_name_pk" PRIMARY KEY("household_id","name"),
	CONSTRAINT "stock_item_names_name_not_blank" CHECK (btrim("stock_item_names"."name") <> '')
);

--> statement-breakpoint
-- ここから下は手で足した部分（ADR-029 決定2・決定3）。生成し直しても消さないこと。

alter table "stock_item_names" enable row level security;
--> statement-breakpoint
-- 表の所有者ロールは RLS を素通りする。非所有者で繋ぐ規律（ADR-029 決定3(b)）と重ねて掛ける。
alter table "stock_item_names" force row level security;
--> statement-breakpoint

-- 述語は4本とも stock_items と同じ形（ADR-056）。(select auth.uid()) で包み、行ごとの
-- 再評価を避ける。
create policy "stock_item_names_select" on "stock_item_names"
  for select to authenticated
  using ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- insert に using は存在しない。with check を落とすと他世帯の行を作れてしまう。
create policy "stock_item_names_insert" on "stock_item_names"
  for insert to authenticated
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- アプリは update も delete も発行しないが、表ごとに4本そろえる（ADR-056）。
-- 片方を欠くと、その操作だけ既定の拒否に落ちるのではなく、後から許可を足した日に穴が開く。
create policy "stock_item_names_update" on "stock_item_names"
  for update to authenticated
  using ("household_id" = (select auth.uid()))
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
create policy "stock_item_names_delete" on "stock_item_names"
  for delete to authenticated
  using ("household_id" = (select auth.uid()));
--> statement-breakpoint

revoke all on "stock_item_names" from anon;
--> statement-breakpoint
grant select, insert, update, delete on "stock_item_names" to authenticated;

commit;
