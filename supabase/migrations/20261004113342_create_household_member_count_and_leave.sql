-- 世帯の人数を返す関数 private.household_member_count() と、世帯を抜ける関数
-- private.leave_household()。backlog B-75 / FR-46 / FR-27 / C-9 / ADR-087 決定1・2・3・6 /
-- ADR-071 決定1。
--
-- **表を作らない移行である。** `drizzle-kit generate --custom` で空のファイルと journal を作り、
-- 本文を手で書いた（手順は README「関数を置く移行」）。表を作らないので RLS の4点の対象外。
--
-- **2関数は引数を取らず、本体を `auth.uid()` に縛る。** 引数で利用者や世帯を受け取れば、他人の
-- 世帯を数えたり動かしたりできる口になる。クレームが無ければ `auth.uid()` が null になり、人数は 0、
-- 抜ける関数は何も書かずに false を返す（例外にしない。ADR-029 理由(1)）。`security definer` なので
-- `search_path` を空にし、名前はすべてスキーマで修飾する（ADR-071 理由(4)）。所有者は移行を流す
-- ロールで、強制しない RLS を受けずに参加の表を読み書きする（ADR-087 決定3）。
--
-- **1トランザクションで通す。** 関数と権限の片方だけが入った窓を作らない。

begin;

-- 世帯の人数（ADR-087 決定1）。参加の行の数に、参加の行を持たない作った人（世帯 ID と同じ
-- 利用者 ID の利用者）を足す。作った人が抜けていれば参加の行を持つので数えず、アカウントを
-- 消していれば利用者が居ないので数えない。`count` は bigint なので integer に落として数値で返す。
create function private.household_member_count() returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with household as (
    select private.current_household_id() as id
  )
  select (
    (select count(*) from public.household_members m, household h where m.household_id = h.id)
    + (
      select count(*) from auth.users u, household h
      where u.id = h.id
        and not exists (select 1 from public.household_members m where m.user_id = u.id)
    )
  )::integer;
$$;
--> statement-breakpoint
revoke execute on function private.household_member_count() from public, anon;
--> statement-breakpoint
grant execute on function private.household_member_count() to authenticated;
--> statement-breakpoint

-- 世帯を抜ける（ADR-087 決定6 / FR-46）。人数が 2 以上のときだけ、自分の参加の行を新しい乱数の
-- 世帯 ID にする（行が無ければ足し、あれば書き換える）。書き換えるのは自分の参加の行だけで、
-- 在庫・献立・提案は1行も動かさない。抜けたら true、自分しか居なくて何もしなかったら false。
create function private.leave_household() returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with moved as (
    insert into public.household_members (user_id, household_id)
    select (select auth.uid()), pg_catalog.gen_random_uuid()
    where private.household_member_count() >= 2
    on conflict (user_id) do update set household_id = excluded.household_id
    returning 1
  )
  select exists (select 1 from moved);
$$;
--> statement-breakpoint
revoke execute on function private.leave_household() from public, anon;
--> statement-breakpoint
grant execute on function private.leave_household() to authenticated;

commit;
