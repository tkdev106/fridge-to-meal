-- `anon` と `authenticated` から、`public` の表の `TRUNCATE`・`REFERENCES`・`TRIGGER`（Postgres 17 では
-- `MAINTAIN` も）を取り上げる。今ある表と、所有者（`postgres`）がこれから作る表の両方。C-9。
--
-- **`TRUNCATE` は RLS を見ない。** 実行できれば全世帯の行が消える。api は Drizzle の決まった問い合わせしか
-- 投げず、Data API は `public` を公開していないので今は届く道が無いが、権限そのものを残さない。
-- 付いていたのは移行の `grant` ではなく、Supabase の既定の権限（`pg_default_acl`）による。
--
-- **`MAINTAIN` は版で分ける。** Postgres 16（ローカルのテスト）には無い語なので、17 以上でだけ取り上げる。
--
-- **表を作らない移行である。** `drizzle-kit generate --custom` で空のファイルと journal を作り、本文を手で書いた。

begin;

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
--> statement-breakpoint
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
--> statement-breakpoint
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
    execute 'alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated';
  end if;
end
$$;

commit;
