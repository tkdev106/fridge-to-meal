-- 世帯を決める関数 private.current_household_id() と招待を作る関数 private.create_household_invitation() を
-- `create or replace` で置き直す。backlog B-82 / ADR-098 決定1 / FR-27 / ADR-087 決定2・6 / C-9。
--
-- **表を作らない移行である。** `drizzle-kit generate --custom` で空のファイルと journal を作り、
-- 本文を手で書いた（手順は README「関数を置く移行」）。表を作らないので RLS の4点の対象外。
-- 適用済みの `20261004083618_…` / `20261004122010_…` は書き換えない（README「適用済みのファイルは書き換えない」）。
--
-- 引数・戻り値・`stable` / `volatile`・`security definer`・`search_path = ''` は上の2ファイルの定義と同じ。
-- `create or replace` は所有者と権限を保つが、権限が読めるよう同じ revoke / grant を書き直す。
--
-- **1トランザクションで通す。** 関数と権限の片方だけが入った窓を作らない。

begin;

-- 世帯を決める（ADR-087 決定1・2 / ADR-098 決定1）。参加の行があればその世帯、無ければ
-- `auth.users` に居る利用者に限って利用者 ID を返し、居なければ null を返す。
-- クレームが無ければ `auth.uid()` が null なので null を返す（例外にしない。ADR-029 理由(1)）。
--
-- **参加の行の側では `auth.users` を見ない。** 参加の行は `auth.users` への外部キーで利用者と一緒に
-- 消えるので、行があれば利用者は居る。利用者 ID の側だけを確かめれば、アカウントを消した人の
-- トークンが期限まで残った世帯に解決されることはない（ADR-098 状況）。
-- api でトークンのたびに Supabase Auth へ問い合わせないのは ADR-098 案B を退けたため。
create or replace function private.current_household_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.household_id from public.household_members m where m.user_id = (select auth.uid())),
    (select u.id from auth.users u where u.id = (select auth.uid()))
  );
$$;
--> statement-breakpoint
revoke execute on function private.current_household_id() from public, anon;
--> statement-breakpoint
grant execute on function private.current_household_id() to authenticated;
--> statement-breakpoint

-- 招待を作る（FR-44 / ADR-087 決定4 / ADR-098 決定1）。世帯が null なら1行も書かずに null を返す。
-- クレームが無い場合も世帯が null になるので同じ扱いになる。
-- **`not null` 違反で落とさない**（例外にしない。ADR-029 理由(1)）。
create or replace function private.create_household_invitation() returns text
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.household_invitations (token, household_id, expires_at)
  select
    pg_catalog.gen_random_uuid()::text,
    h.household_id,
    pg_catalog.now() + interval '24 hours'
  from (select private.current_household_id() as household_id) h
  where h.household_id is not null
  returning token;
$$;
--> statement-breakpoint
revoke execute on function private.create_household_invitation() from public, anon;
--> statement-breakpoint
grant execute on function private.create_household_invitation() to authenticated;

commit;
