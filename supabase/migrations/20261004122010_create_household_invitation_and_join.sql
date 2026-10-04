-- 招待を作る関数 private.create_household_invitation() と、招待で参加する関数
-- private.join_household(invitation_token text)。backlog B-74 / FR-44 / FR-45 / C-9 /
-- ADR-087 決定3・4・5 / ADR-071 決定1。
--
-- **表を作らない移行である。** `drizzle-kit generate --custom` で空のファイルと journal を作り、
-- 本文を手で書いた（手順は README「関数を置く移行」）。表を作らないので RLS の4点の対象外。
--
-- **世帯は引数で受け取らず、本体を `auth.uid()` に縛る。** 参加の関数が受け取るのはトークンだけで、
-- 書くのは呼んだ利用者自身の参加の行だけである。クレームが無ければ `auth.uid()` が null になり、
-- 何も書かずに作る関数は null、参加の関数は 'invalid_invitation' を返す（例外にしない。ADR-029 理由(1)）。
-- `security definer` なので `search_path` を空にし、名前はすべてスキーマで修飾する（ADR-071 理由(4)）。
-- 所有者は移行を流すロールで、強制しない RLS を受けずに参加と招待の表を読み書きする（ADR-087 決定3）。
--
-- **1トランザクションで通す。** 関数と権限の片方だけが入った窓を作らない。

begin;

-- 招待を作る（FR-44 / ADR-087 決定4）。今の世帯に、24時間で切れる1回限りの招待を1行書いて
-- トークンを返す。呼ぶたびに新しく作り、同じ世帯の未使用の招待があっても消さない。
create function private.create_household_invitation() returns text
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.household_invitations (token, household_id, expires_at)
  select
    pg_catalog.gen_random_uuid()::text,
    private.current_household_id(),
    pg_catalog.now() + interval '24 hours'
  where (select auth.uid()) is not null
  returning token;
$$;
--> statement-breakpoint
revoke execute on function private.create_household_invitation() from public, anon;
--> statement-breakpoint
grant execute on function private.create_household_invitation() to authenticated;
--> statement-breakpoint

-- 招待で参加する（FR-45 / ADR-087 決定4・5）。返すのは 'joined' / 'already_member' /
-- 'invalid_invitation' のどれか。
--
-- 招待が使えるのは、行があり期限が今より後で、招待の世帯にメンバーが1人以上居るときだけ。
-- 人数の数え方は `household_member_count()` と同じ（参加の行の数 + 参加の行を持たない作った人）。
-- 無い・切れた・使用済み・メンバーの居ない世帯の招待は区別せず 'invalid_invitation' に畳み、何も書かない。
-- 招待の世帯が今の世帯と同じなら、招待を消さずに 'already_member'。
-- それ以外は自分の参加の行を招待の世帯にし（無ければ足し、あれば書き換える）、招待を消して 'joined'。
-- 在庫・献立・提案には触れない。
--
-- **招待の行を `for update` で取る。** 同じトークンで同時に参加すると後の者はロックを待ち、
-- 先の者が招待を消してコミットしたあとは行が見えず 'invalid_invitation' になる（1回限り）。
create function private.join_household(invitation_token text) returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  invited_household uuid;
begin
  if caller is null then
    return 'invalid_invitation';
  end if;

  select i.household_id into invited_household
  from public.household_invitations i
  where i.token = invitation_token
    and i.expires_at > pg_catalog.now()
  for update;

  if invited_household is null then
    return 'invalid_invitation';
  end if;

  if (select count(*) from public.household_members m where m.household_id = invited_household)
     + (
       select count(*) from auth.users u
       where u.id = invited_household
         and not exists (select 1 from public.household_members m where m.user_id = u.id)
     ) < 1 then
    return 'invalid_invitation';
  end if;

  if invited_household = private.current_household_id() then
    return 'already_member';
  end if;

  insert into public.household_members (user_id, household_id)
  values (caller, invited_household)
  on conflict (user_id) do update set household_id = excluded.household_id;

  delete from public.household_invitations i where i.token = invitation_token;

  return 'joined';
end;
$$;
--> statement-breakpoint
revoke execute on function private.join_household(text) from public, anon;
--> statement-breakpoint
grant execute on function private.join_household(text) to authenticated;

commit;
