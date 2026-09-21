-- 献立（Meal）の4表と RLS ポリシー。backlog B-44 / ADR-029 / ADR-028 / C-3 / C-9 / C-16。
--
-- **表を作る部分は `drizzle-kit` の生成物である。** 正はスキーマの側
-- （`apps/api/src/contexts/meal/infrastructure/db/schema.ts`）にあり、ここを手で直さない。
-- **下の RLS の4点だけは手で足す**（生成では出ない）。**4表ぶん＝ポリシーは16本**ある。
-- 手順は README、落ちないことの守りは `apps/api/test/migrations/tableMigrations.test.ts`
-- （**表ごとに**4点を見る。B-44 設計 規則13）。
--
-- **表・RLS の有効化・ポリシーを同じ1ファイルに置く。** 分けると、片方だけ適用された状態
-- ＝ RLS の無い表が実在する窓ができる。
--
-- **適用手段に依らず1トランザクションで通す。** SQL エディタは複数文をまとめて流すが、
-- psql -f は文ごとに別のトランザクションになり、途中で失敗すると上の窓が実際に開く。

begin;

CREATE TABLE "cooking_records" (
	"meal_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"cooked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cooking_records_pkey" PRIMARY KEY("meal_id","position"),
	CONSTRAINT "cooking_records_position_not_negative" CHECK ("cooking_records"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cooking_steps" (
	"meal_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"body" text NOT NULL,
	CONSTRAINT "cooking_steps_pkey" PRIMARY KEY("meal_id","position"),
	CONSTRAINT "cooking_steps_position_not_negative" CHECK ("cooking_steps"."position" >= 0),
	CONSTRAINT "cooking_steps_body_not_blank" CHECK (btrim("cooking_steps"."body") <> '')
);
--> statement-breakpoint
CREATE TABLE "meal_ingredients" (
	"meal_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"amount" text,
	CONSTRAINT "meal_ingredients_pkey" PRIMARY KEY("meal_id","position"),
	CONSTRAINT "meal_ingredients_position_not_negative" CHECK ("meal_ingredients"."position" >= 0),
	CONSTRAINT "meal_ingredients_name_not_blank" CHECK (btrim("meal_ingredients"."name") <> ''),
	CONSTRAINT "meal_ingredients_kind_known" CHECK ("meal_ingredients"."kind" in ('main', 'seasoning')),
	CONSTRAINT "meal_ingredients_amount_not_blank" CHECK ("meal_ingredients"."amount" is null or btrim("meal_ingredients"."amount") <> '')
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "meals_id_household_id_unique" UNIQUE("id","household_id"),
	CONSTRAINT "meals_title_not_blank" CHECK (btrim("meals"."title") <> '')
);
--> statement-breakpoint
ALTER TABLE "cooking_records" ADD CONSTRAINT "cooking_records_meal_id_household_id_fk" FOREIGN KEY ("meal_id","household_id") REFERENCES "public"."meals"("id","household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cooking_steps" ADD CONSTRAINT "cooking_steps_meal_id_household_id_fk" FOREIGN KEY ("meal_id","household_id") REFERENCES "public"."meals"("id","household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_ingredients" ADD CONSTRAINT "meal_ingredients_meal_id_household_id_fk" FOREIGN KEY ("meal_id","household_id") REFERENCES "public"."meals"("id","household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cooking_records_household_id_idx" ON "cooking_records" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "cooking_steps_household_id_idx" ON "cooking_steps" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "meal_ingredients_household_id_idx" ON "meal_ingredients" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "meals_household_id_idx" ON "meals" USING btree ("household_id");

--> statement-breakpoint
-- ここから下は手で足した部分（ADR-029 決定2・決定3）。生成し直しても消さないこと。
--
-- **子表も自分の household_id で分離する。** 親への `exists (select 1 from meals …)` に
-- しない（B-44 設計 規則11 の理由）— 4表の述語が1つの形に揃わないと、ポリシーを1本ずつ
-- 緩めたときの効きが別の表の緑と絡み、表ごとに閉じて読めなくなる。親と食い違う世帯の行は
-- 複合外部キー（meal_id, household_id）が DB の側で不可能にしている。
--
-- using は「既に在る行が対象になるか」、with check は「書き込んだあとの行が満たすべき
-- 条件」。読み取り側だけを書くと「見えないが作れる」穴が残る。
-- 述語を (select auth.uid()) で包むのは、行ごとの再評価を避けるため。

--> statement-breakpoint
alter table "meals" enable row level security;
--> statement-breakpoint
-- 表の所有者ロールは RLS を素通りする。非所有者で繋ぐ規律（ADR-029 決定3(b)）と
-- 重ねて掛け、所有者で繋がざるをえない場合にも効かせる。
alter table "meals" force row level security;
--> statement-breakpoint
create policy "meals_select" on "meals"
  for select to authenticated
  using ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- insert に using は存在しない。**with check を落とすことは「誰の行でも作れる」と
-- 書いたことに等しい** — しかも作った本人には select ポリシーで見えない。
create policy "meals_insert" on "meals"
  for insert to authenticated
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- update は両方が要る。using だけだと自分の行を他世帯へ移せてしまい、
-- with check だけだと他世帯の行を掴めてしまう。
create policy "meals_update" on "meals"
  for update to authenticated
  using ("household_id" = (select auth.uid()))
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
create policy "meals_delete" on "meals"
  for delete to authenticated
  using ("household_id" = (select auth.uid()));

--> statement-breakpoint
alter table "meal_ingredients" enable row level security;
--> statement-breakpoint
-- 表の所有者ロールは RLS を素通りする。非所有者で繋ぐ規律（ADR-029 決定3(b)）と
-- 重ねて掛け、所有者で繋がざるをえない場合にも効かせる。
alter table "meal_ingredients" force row level security;
--> statement-breakpoint
create policy "meal_ingredients_select" on "meal_ingredients"
  for select to authenticated
  using ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- insert に using は存在しない。**with check を落とすことは「誰の行でも作れる」と
-- 書いたことに等しい** — しかも作った本人には select ポリシーで見えない。
create policy "meal_ingredients_insert" on "meal_ingredients"
  for insert to authenticated
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- update は両方が要る。using だけだと自分の行を他世帯へ移せてしまい、
-- with check だけだと他世帯の行を掴めてしまう。
create policy "meal_ingredients_update" on "meal_ingredients"
  for update to authenticated
  using ("household_id" = (select auth.uid()))
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
create policy "meal_ingredients_delete" on "meal_ingredients"
  for delete to authenticated
  using ("household_id" = (select auth.uid()));

--> statement-breakpoint
alter table "cooking_steps" enable row level security;
--> statement-breakpoint
-- 表の所有者ロールは RLS を素通りする。非所有者で繋ぐ規律（ADR-029 決定3(b)）と
-- 重ねて掛け、所有者で繋がざるをえない場合にも効かせる。
alter table "cooking_steps" force row level security;
--> statement-breakpoint
create policy "cooking_steps_select" on "cooking_steps"
  for select to authenticated
  using ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- insert に using は存在しない。**with check を落とすことは「誰の行でも作れる」と
-- 書いたことに等しい** — しかも作った本人には select ポリシーで見えない。
create policy "cooking_steps_insert" on "cooking_steps"
  for insert to authenticated
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- update は両方が要る。using だけだと自分の行を他世帯へ移せてしまい、
-- with check だけだと他世帯の行を掴めてしまう。
create policy "cooking_steps_update" on "cooking_steps"
  for update to authenticated
  using ("household_id" = (select auth.uid()))
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
create policy "cooking_steps_delete" on "cooking_steps"
  for delete to authenticated
  using ("household_id" = (select auth.uid()));

--> statement-breakpoint
alter table "cooking_records" enable row level security;
--> statement-breakpoint
-- 表の所有者ロールは RLS を素通りする。非所有者で繋ぐ規律（ADR-029 決定3(b)）と
-- 重ねて掛け、所有者で繋がざるをえない場合にも効かせる。
alter table "cooking_records" force row level security;
--> statement-breakpoint
create policy "cooking_records_select" on "cooking_records"
  for select to authenticated
  using ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- insert に using は存在しない。**with check を落とすことは「誰の行でも作れる」と
-- 書いたことに等しい** — しかも作った本人には select ポリシーで見えない。
create policy "cooking_records_insert" on "cooking_records"
  for insert to authenticated
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
-- update は両方が要る。using だけだと自分の行を他世帯へ移せてしまい、
-- with check だけだと他世帯の行を掴めてしまう。
create policy "cooking_records_update" on "cooking_records"
  for update to authenticated
  using ("household_id" = (select auth.uid()))
  with check ("household_id" = (select auth.uid()));
--> statement-breakpoint
create policy "cooking_records_delete" on "cooking_records"
  for delete to authenticated
  using ("household_id" = (select auth.uid()));

--> statement-breakpoint
-- 権限は authenticated にだけ与える。接続は非所有者のロールで行い、読み書きの前に
-- set local role authenticated へ切り替える（ADR-029 決定3(a)(b)）。
-- create role はここに書かない — Supabase には既に在り、ローカル側は supabase/local/init.sql
-- が用意する。**4表を並べて書く** — 表を足して並びに入れ忘れれば、上の守りが表ごとに落とす。
revoke all on "meals", "meal_ingredients", "cooking_steps", "cooking_records" from anon;
--> statement-breakpoint
grant select, insert, update, delete
  on "meals", "meal_ingredients", "cooking_steps", "cooking_records"
  to authenticated;

commit;
