-- 本人の利用者を消す関数 private.delete_own_account()。backlog B-56d / FR-27 / NFR-13 /
-- ADR-071 決定1 / C-9。
--
-- **表を作らない移行である。** `drizzle-kit generate --custom` で空のファイルと journal を作り、
-- 本文を手で書いた（手順は README「関数を置く移行」）。表を作らないので RLS の4点の対象外。
--
-- **`public` に置かない。** Supabase の API は `public` を公開しており、そこに置くと利用者が
-- `rpc/delete_own_account` を直接呼べ、データを消さずに利用者だけを消す経路ができる。
-- `private` は公開するスキーマに入れず、`usage` も `authenticated` にだけ与える（ADR-071 結果7）。
--
-- **関数は引数を取らず、本体は `auth.uid()` の行を消す1文だけ。** 誰を消すかはトランザクションの
-- クレームが決め、クレームを張らない呼び出しは `auth.uid()` が null になり1行も消さない
-- （ADR-071 理由(2)）。`security definer` なので `search_path` を空にし、名前はすべてスキーマで
-- 修飾する（同 理由(4)）。所有者は移行を流すロール（実環境では `postgres`）である。
--
-- **1トランザクションで通す。** スキーマ・関数・権限の片方だけが入った窓を作らない。

begin;

create schema private;
--> statement-breakpoint
grant usage on schema private to authenticated;
--> statement-breakpoint
create function private.delete_own_account() returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = (select auth.uid());
$$;
--> statement-breakpoint
revoke execute on function private.delete_own_account() from public, anon;
--> statement-breakpoint
grant execute on function private.delete_own_account() to authenticated;

commit;
