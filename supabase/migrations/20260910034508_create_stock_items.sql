-- 在庫品（StockItem）の表と RLS ポリシー。backlog B-07c / ADR-029 / ADR-028。
--
-- **表を作る部分は `drizzle-kit` の生成物である。** 正はスキーマの側
-- （`apps/api/src/contexts/pantry/infrastructure/db/schema.ts`）にあり、ここを手で直さない。
-- **下の RLS の4点だけは手で足す**（生成では出ない）。手順は README、落ちないことの守りは
-- `apps/api/test/migrations/stockItemsMigration.test.ts`。
--
-- **表・RLS の有効化・ポリシーを同じ1ファイルに置く。** 分けると、片方だけ適用された状態
-- ＝ RLS の無い stock_items が実在する窓ができる。
--
-- **適用手段に依らず1トランザクションで通す。** SQL エディタは複数文をまとめて流すが、
-- psql -f は文ごとに別のトランザクションになり、途中で失敗すると上の窓が実際に開く。

begin;

CREATE TABLE "stock_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ingredient_id" uuid,
	"amount" text,
	"expiry_date" date,
	CONSTRAINT "stock_items_name_not_blank" CHECK (btrim("stock_items"."name") <> ''),
	CONSTRAINT "stock_items_amount_not_blank" CHECK ("stock_items"."amount" is null or btrim("stock_items"."amount") <> '')
);
--> statement-breakpoint
CREATE INDEX "stock_items_household_id_idx" ON "stock_items" USING btree ("household_id");

--> statement-breakpoint
-- ここから下は手で足した部分（ADR-029 決定2・決定3）。生成し直しても消さないこと。

alter table "stock_items" enable row level security;
--> statement-breakpoint
-- 表の所有者ロールは RLS を素通りする。非所有者で繋ぐ規律（ADR-029 決定3(b)）と
-- 重ねて掛け、所有者で繋がざるをえない場合にも効かせる。
alter table "stock_items" force row level security;
--> statement-breakpoint

-- using は「既に在る行が対象になるか」、with check は「書き込んだあとの行が満たすべき
-- 条件」。読み取り側だけを書くと「見えないが作れる」穴が残る。
-- 述語を (select auth.uid()) で包むのは、行ごとの再評価を避けるため。

create policy "stock_items_select" on "stock_items"
  for select to authenticated
  using ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- insert に using は存在しない。**with check を落とすことは「誰の行でも作れる」と
-- 書いたことに等しい** — しかも作った本人には select ポリシーで見えないため、
-- 画面上は何も起きていないように見える。
create policy "stock_items_insert" on "stock_items"
  for insert to authenticated
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- update は両方が要る。using だけだと自分の行を他世帯へ移せてしまい、
-- with check だけだと他世帯の行を掴めてしまう。
create policy "stock_items_update" on "stock_items"
  for update to authenticated
  using ("household_id" = (select auth.uid()))
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
create policy "stock_items_delete" on "stock_items"
  for delete to authenticated
  using ("household_id" = (select auth.uid()));
--> statement-breakpoint

-- 権限は authenticated にだけ与える。接続は非所有者のロールで行い、読み書きの前に
-- set local role authenticated へ切り替える（ADR-029 決定3(a)(b)）。
-- create role はここに書かない — Supabase には既に在り、ローカル側は B-07d が用意する。
revoke all on "stock_items" from anon;
--> statement-breakpoint
grant select, insert, update, delete on "stock_items" to authenticated;

commit;
