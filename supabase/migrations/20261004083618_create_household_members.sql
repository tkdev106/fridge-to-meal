-- 世帯の参加（household_members）と招待（household_invitations）の表、世帯を決める関数
-- private.current_household_id()、9表の RLS の述語の差し替え。backlog B-73 / FR-26 / C-9 /
-- ADR-087 決定1・2・3 / ADR-071 決定1 / ADR-029 決定2・3。
--
-- **2表を作る部分は `drizzle-kit` の生成物である。** 正はスキーマの側
-- （`apps/api/src/contexts/identity/infrastructure/db/schema.ts`）にあり、ここを手で直さない。
-- **その下の守り・関数・ポリシーの差し替えだけは手で足す**（生成では出ない）。
--
-- **2表は関数だけを通す表である**（ADR-087 決定3）。`authenticated` に直接読み書きさせず、
-- 世帯は関数だけが引く。自分で参加の行を書ければ、他の世帯に入ってその行を読める。
--
-- **既存の行を1件も書き換えない**（ADR-087 決定1・理由(2)）。参加の行の無い利用者の世帯は
-- 今と同じ自分の利用者 ID なので、移行の前後で見える行も書ける行も変わらず、
-- `sub` に世帯を張る古い api もそのまま動く（ADR-077）。
--
-- **1トランザクションで通す。** 表・守り・関数・ポリシーの片方だけが入った窓、
-- ポリシーの無い表が見える窓を作らない。

begin;

CREATE TABLE "household_invitations" (
	"token" text PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint
-- ここから下は手で足した部分（ADR-087 決定3 / ADR-029 決定2）。生成し直しても消さないこと。

-- 2表の守り。RLS を有効にし、ポリシーを置かない — `authenticated` の読み書きの口を開かない。
-- **強制（force）はしない。** 強制すると、所有者である関数自身が0行しか読めなくなる。
alter table "household_members" enable row level security;
--> statement-breakpoint
alter table "household_invitations" enable row level security;
--> statement-breakpoint
-- Supabase は public の新しい表に既定で権限を付けるので、明示して取り上げる。
revoke all on "household_members" from anon, authenticated;
--> statement-breakpoint
revoke all on "household_invitations" from anon, authenticated;
--> statement-breakpoint

-- 世帯を決める関数（ADR-087 決定2）。参加の行があればその世帯、無ければ自分の利用者 ID を返す。
-- クレームが無ければ `auth.uid()` が null なので null を返す（例外にしない。ADR-029 理由(1)）。
--
-- **引数を取らず、本体を `auth.uid()` に縛る。** 引数で利用者や世帯を受け取れば、他人の世帯を
-- 引ける口になる。`security definer` なので `search_path` を空にし、名前はすべてスキーマで
-- 修飾する（ADR-071 理由(4)）。所有者は移行を流すロールで、強制しない RLS を受けずに参加の表を読む。
-- `private` は `20261001110212_create_delete_own_account.sql` が作り、`usage` を `authenticated` に与えてある。
create function private.current_household_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.household_id from public.household_members m where m.user_id = (select auth.uid())),
    (select auth.uid())
  );
$$;
--> statement-breakpoint
revoke execute on function private.current_household_id() from public, anon;
--> statement-breakpoint
grant execute on function private.current_household_id() to authenticated;
--> statement-breakpoint

-- 9表の4ポリシーの述語を関数に差し替える（ADR-087 決定2）。名前・`to authenticated`・
-- using と with check の有無は今のまま。drop と create を同じトランザクションで行うので、
-- ポリシーの無い瞬間は外に見えない。述語を (select ...) で包むのは、行ごとの再評価を避けるため。

drop policy "stock_items_select" on "stock_items";
--> statement-breakpoint
create policy "stock_items_select" on "stock_items"
  for select to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "stock_items_insert" on "stock_items";
--> statement-breakpoint
create policy "stock_items_insert" on "stock_items"
  for insert to authenticated
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "stock_items_update" on "stock_items";
--> statement-breakpoint
create policy "stock_items_update" on "stock_items"
  for update to authenticated
  using ("household_id" = (select private.current_household_id()))
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "stock_items_delete" on "stock_items";
--> statement-breakpoint
create policy "stock_items_delete" on "stock_items"
  for delete to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint

drop policy "stock_item_names_select" on "stock_item_names";
--> statement-breakpoint
create policy "stock_item_names_select" on "stock_item_names"
  for select to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "stock_item_names_insert" on "stock_item_names";
--> statement-breakpoint
create policy "stock_item_names_insert" on "stock_item_names"
  for insert to authenticated
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "stock_item_names_update" on "stock_item_names";
--> statement-breakpoint
create policy "stock_item_names_update" on "stock_item_names"
  for update to authenticated
  using ("household_id" = (select private.current_household_id()))
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "stock_item_names_delete" on "stock_item_names";
--> statement-breakpoint
create policy "stock_item_names_delete" on "stock_item_names"
  for delete to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint

drop policy "meals_select" on "meals";
--> statement-breakpoint
create policy "meals_select" on "meals"
  for select to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "meals_insert" on "meals";
--> statement-breakpoint
create policy "meals_insert" on "meals"
  for insert to authenticated
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "meals_update" on "meals";
--> statement-breakpoint
create policy "meals_update" on "meals"
  for update to authenticated
  using ("household_id" = (select private.current_household_id()))
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "meals_delete" on "meals";
--> statement-breakpoint
create policy "meals_delete" on "meals"
  for delete to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint

drop policy "meal_ingredients_select" on "meal_ingredients";
--> statement-breakpoint
create policy "meal_ingredients_select" on "meal_ingredients"
  for select to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "meal_ingredients_insert" on "meal_ingredients";
--> statement-breakpoint
create policy "meal_ingredients_insert" on "meal_ingredients"
  for insert to authenticated
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "meal_ingredients_update" on "meal_ingredients";
--> statement-breakpoint
create policy "meal_ingredients_update" on "meal_ingredients"
  for update to authenticated
  using ("household_id" = (select private.current_household_id()))
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "meal_ingredients_delete" on "meal_ingredients";
--> statement-breakpoint
create policy "meal_ingredients_delete" on "meal_ingredients"
  for delete to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint

drop policy "cooking_steps_select" on "cooking_steps";
--> statement-breakpoint
create policy "cooking_steps_select" on "cooking_steps"
  for select to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "cooking_steps_insert" on "cooking_steps";
--> statement-breakpoint
create policy "cooking_steps_insert" on "cooking_steps"
  for insert to authenticated
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "cooking_steps_update" on "cooking_steps";
--> statement-breakpoint
create policy "cooking_steps_update" on "cooking_steps"
  for update to authenticated
  using ("household_id" = (select private.current_household_id()))
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "cooking_steps_delete" on "cooking_steps";
--> statement-breakpoint
create policy "cooking_steps_delete" on "cooking_steps"
  for delete to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint

drop policy "cooking_records_select" on "cooking_records";
--> statement-breakpoint
create policy "cooking_records_select" on "cooking_records"
  for select to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "cooking_records_insert" on "cooking_records";
--> statement-breakpoint
create policy "cooking_records_insert" on "cooking_records"
  for insert to authenticated
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "cooking_records_update" on "cooking_records";
--> statement-breakpoint
create policy "cooking_records_update" on "cooking_records"
  for update to authenticated
  using ("household_id" = (select private.current_household_id()))
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "cooking_records_delete" on "cooking_records";
--> statement-breakpoint
create policy "cooking_records_delete" on "cooking_records"
  for delete to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint

drop policy "suggestions_select" on "suggestions";
--> statement-breakpoint
create policy "suggestions_select" on "suggestions"
  for select to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "suggestions_insert" on "suggestions";
--> statement-breakpoint
create policy "suggestions_insert" on "suggestions"
  for insert to authenticated
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "suggestions_update" on "suggestions";
--> statement-breakpoint
create policy "suggestions_update" on "suggestions"
  for update to authenticated
  using ("household_id" = (select private.current_household_id()))
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "suggestions_delete" on "suggestions";
--> statement-breakpoint
create policy "suggestions_delete" on "suggestions"
  for delete to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint

drop policy "suggestion_entries_select" on "suggestion_entries";
--> statement-breakpoint
create policy "suggestion_entries_select" on "suggestion_entries"
  for select to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "suggestion_entries_insert" on "suggestion_entries";
--> statement-breakpoint
create policy "suggestion_entries_insert" on "suggestion_entries"
  for insert to authenticated
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "suggestion_entries_update" on "suggestion_entries";
--> statement-breakpoint
create policy "suggestion_entries_update" on "suggestion_entries"
  for update to authenticated
  using ("household_id" = (select private.current_household_id()))
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "suggestion_entries_delete" on "suggestion_entries";
--> statement-breakpoint
create policy "suggestion_entries_delete" on "suggestion_entries"
  for delete to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint

drop policy "pantry_snapshot_stock_items_select" on "pantry_snapshot_stock_items";
--> statement-breakpoint
create policy "pantry_snapshot_stock_items_select" on "pantry_snapshot_stock_items"
  for select to authenticated
  using ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "pantry_snapshot_stock_items_insert" on "pantry_snapshot_stock_items";
--> statement-breakpoint
create policy "pantry_snapshot_stock_items_insert" on "pantry_snapshot_stock_items"
  for insert to authenticated
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "pantry_snapshot_stock_items_update" on "pantry_snapshot_stock_items";
--> statement-breakpoint
create policy "pantry_snapshot_stock_items_update" on "pantry_snapshot_stock_items"
  for update to authenticated
  using ("household_id" = (select private.current_household_id()))
  with check ("household_id" = (select private.current_household_id()));
--> statement-breakpoint
drop policy "pantry_snapshot_stock_items_delete" on "pantry_snapshot_stock_items";
--> statement-breakpoint
create policy "pantry_snapshot_stock_items_delete" on "pantry_snapshot_stock_items"
  for delete to authenticated
  using ("household_id" = (select private.current_household_id()));

commit;
