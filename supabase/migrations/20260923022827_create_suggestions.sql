-- 提案（Suggestion）の3表と RLS ポリシー。backlog B-45 / ADR-029 / ADR-056 / C-9 / C-15。
--
-- **表を作る部分は `drizzle-kit` の生成物である。** 正はスキーマの側
-- （`apps/api/src/contexts/meal/infrastructure/db/schema.ts`）にあり、ここを手で直さない。
-- **下の RLS の4点だけは手で足す**（生成では出ない）。**3表ぶん＝ポリシーは12本**ある。
-- 手順は README、落ちないことの守りは `apps/api/test/migrations/tableMigrations.test.ts`
-- （**表ごとに**4点を見る。ADR-056）。
--
-- **提案の1件（suggestion_entries.meal_id）から献立へ外部キーを張らない**（B-45 設計 規則11 /
-- ADR-008）。集約をまたぐ参照は識別子であり、張ると献立を消す経路（保持期間は未決）を
-- 先回りして決めることになる。
--
-- **表・RLS の有効化・ポリシーを同じ1ファイルに置く。** 分けると、片方だけ適用された状態
-- ＝ RLS の無い表が実在する窓ができる。
--
-- **適用手段に依らず1トランザクションで通す。** SQL エディタは複数文をまとめて流すが、
-- psql -f は文ごとに別のトランザクションになり、途中で失敗すると上の窓が実際に開く。

begin;

CREATE TABLE "pantry_snapshot_stock_items" (
	"suggestion_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"amount" text,
	"expiry_date" date,
	CONSTRAINT "pantry_snapshot_stock_items_pkey" PRIMARY KEY("suggestion_id","position"),
	CONSTRAINT "pantry_snapshot_stock_items_position_not_negative" CHECK ("pantry_snapshot_stock_items"."position" >= 0),
	CONSTRAINT "pantry_snapshot_stock_items_name_not_blank" CHECK (btrim("pantry_snapshot_stock_items"."name") <> ''),
	CONSTRAINT "pantry_snapshot_stock_items_amount_not_blank" CHECK ("pantry_snapshot_stock_items"."amount" is null or btrim("pantry_snapshot_stock_items"."amount") <> '')
);
--> statement-breakpoint
CREATE TABLE "suggestion_entries" (
	"suggestion_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"meal_id" uuid NOT NULL,
	"origin" text NOT NULL,
	CONSTRAINT "suggestion_entries_pkey" PRIMARY KEY("suggestion_id","position"),
	CONSTRAINT "suggestion_entries_position_not_negative" CHECK ("suggestion_entries"."position" >= 0),
	CONSTRAINT "suggestion_entries_origin_known" CHECK ("suggestion_entries"."origin" in ('generated', 'reused'))
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "suggestions_id_household_id_unique" UNIQUE("id","household_id")
);
--> statement-breakpoint
ALTER TABLE "pantry_snapshot_stock_items" ADD CONSTRAINT "pantry_snapshot_stock_items_suggestion_id_household_id_fk" FOREIGN KEY ("suggestion_id","household_id") REFERENCES "public"."suggestions"("id","household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_entries" ADD CONSTRAINT "suggestion_entries_suggestion_id_household_id_fk" FOREIGN KEY ("suggestion_id","household_id") REFERENCES "public"."suggestions"("id","household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pantry_snapshot_stock_items_household_id_idx" ON "pantry_snapshot_stock_items" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "suggestion_entries_household_id_idx" ON "suggestion_entries" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "suggestions_household_id_idx" ON "suggestions" USING btree ("household_id");


--> statement-breakpoint
-- ここから下は手で足した部分（ADR-029 決定2・決定3）。生成し直しても消さないこと。
--
-- **子表も自分の household_id で分離する。** 親への `exists (select 1 from suggestions …)` に
-- しない（ADR-056）— 3表の述語が1つの形に揃わないと、ポリシーを1本ずつ緩めたときの効きが
-- 別の表の緑と絡み、表ごとに閉じて読めなくなる。親と食い違う世帯の行は
-- 複合外部キー（suggestion_id, household_id）が DB の側で不可能にしている。
--
-- using は「既に在る行が対象になるか」、with check は「書き込んだあとの行が満たすべき
-- 条件」。読み取り側だけを書くと「見えないが作れる」穴が残る。
-- 述語を (select auth.uid()) で包むのは、行ごとの再評価を避けるため。

--> statement-breakpoint
alter table "suggestions" enable row level security;
--> statement-breakpoint
-- 表の所有者ロールは RLS を素通りする。非所有者で繋ぐ規律（ADR-029 決定3(b)）と
-- 重ねて掛け、所有者で繋がざるをえない場合にも効かせる。
alter table "suggestions" force row level security;
--> statement-breakpoint
create policy "suggestions_select" on "suggestions"
  for select to authenticated
  using ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- insert に using は存在しない。**with check を落とすことは「誰の行でも作れる」と
-- 書いたことに等しい** — しかも作った本人には select ポリシーで見えない。
create policy "suggestions_insert" on "suggestions"
  for insert to authenticated
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- update は両方が要る。using だけだと自分の行を他世帯へ移せてしまい、
-- with check だけだと他世帯の行を掴めてしまう。
create policy "suggestions_update" on "suggestions"
  for update to authenticated
  using ("household_id" = (select auth.uid()))
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
create policy "suggestions_delete" on "suggestions"
  for delete to authenticated
  using ("household_id" = (select auth.uid()));

--> statement-breakpoint
alter table "suggestion_entries" enable row level security;
--> statement-breakpoint
-- 表の所有者ロールは RLS を素通りする。非所有者で繋ぐ規律（ADR-029 決定3(b)）と
-- 重ねて掛け、所有者で繋がざるをえない場合にも効かせる。
alter table "suggestion_entries" force row level security;
--> statement-breakpoint
create policy "suggestion_entries_select" on "suggestion_entries"
  for select to authenticated
  using ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- insert に using は存在しない。**with check を落とすことは「誰の行でも作れる」と
-- 書いたことに等しい** — しかも作った本人には select ポリシーで見えない。
create policy "suggestion_entries_insert" on "suggestion_entries"
  for insert to authenticated
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- update は両方が要る。using だけだと自分の行を他世帯へ移せてしまい、
-- with check だけだと他世帯の行を掴めてしまう。
create policy "suggestion_entries_update" on "suggestion_entries"
  for update to authenticated
  using ("household_id" = (select auth.uid()))
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
create policy "suggestion_entries_delete" on "suggestion_entries"
  for delete to authenticated
  using ("household_id" = (select auth.uid()));

--> statement-breakpoint
alter table "pantry_snapshot_stock_items" enable row level security;
--> statement-breakpoint
-- 表の所有者ロールは RLS を素通りする。非所有者で繋ぐ規律（ADR-029 決定3(b)）と
-- 重ねて掛け、所有者で繋がざるをえない場合にも効かせる。
alter table "pantry_snapshot_stock_items" force row level security;
--> statement-breakpoint
create policy "pantry_snapshot_stock_items_select" on "pantry_snapshot_stock_items"
  for select to authenticated
  using ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- insert に using は存在しない。**with check を落とすことは「誰の行でも作れる」と
-- 書いたことに等しい** — しかも作った本人には select ポリシーで見えない。
create policy "pantry_snapshot_stock_items_insert" on "pantry_snapshot_stock_items"
  for insert to authenticated
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- update は両方が要る。using だけだと自分の行を他世帯へ移せてしまい、
-- with check だけだと他世帯の行を掴めてしまう。
create policy "pantry_snapshot_stock_items_update" on "pantry_snapshot_stock_items"
  for update to authenticated
  using ("household_id" = (select auth.uid()))
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
create policy "pantry_snapshot_stock_items_delete" on "pantry_snapshot_stock_items"
  for delete to authenticated
  using ("household_id" = (select auth.uid()));

--> statement-breakpoint
-- 権限は authenticated にだけ与える。接続は非所有者のロールで行い、読み書きの前に
-- set local role authenticated へ切り替える（ADR-029 決定3(a)(b)）。
-- create role はここに書かない — Supabase には既に在り、ローカル側は supabase/local/init.sql
-- が用意する。**3表を並べて書く** — 表を足して並びに入れ忘れれば、上の守りが表ごとに落とす。
revoke all on "suggestions", "suggestion_entries", "pantry_snapshot_stock_items" from anon;
--> statement-breakpoint
grant select, insert, update, delete
  on "suggestions", "suggestion_entries", "pantry_snapshot_stock_items"
  to authenticated;

commit;
