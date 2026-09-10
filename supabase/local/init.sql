-- テスト用のローカル Postgres の初期化（B-07d / ADR-029 決定3(a)(b)・結果1 / NFR-09）。
--
-- **initdb で1度だけ走る。** 直しても既存のコンテナには反映されないため、
-- `pnpm db:down` してから `pnpm db:up`（または `docker compose up -d --force-recreate`）する。
--
-- ここで用意するのは Supabase の実物に名前ごと揃えた役と、`auth.uid()` だけである。
-- 表は `supabase/migrations/*.sql` が作る（適用は `pnpm test:db` の globalSetup）。

-- 役は3つ。行レベルセキュリティを迂回できる役は**作らない** — 使えないことを環境で担保する。
create role anon nologin;
create role authenticated nologin;

-- アプリが繋ぐ役。login でき、表を持たない。noinherit なので、繋いだだけでは
-- anon / authenticated の権限を持たず、`set local role` で明示的に切り替える必要がある。
create role authenticator login noinherit password 'authenticator';
grant anon, authenticated to authenticator;

create schema auth;
grant usage on schema auth to anon, authenticated, authenticator;

-- 世帯 ID の出どころ。ポリシーの述語 `household_id = (select auth.uid())` はこれを読む。
--
-- **`current_setting` の第2引数 true（missing_ok）を落とさない。** 落とすと、クレームを
-- 張らない問い合わせが「0行」ではなく**例外**になり、ADR-029 が理由に挙げた失敗の向きが
-- 変わる。security definer にはしない（呼び手の設定を読むだけの関数である）。
create function auth.uid() returns uuid
language sql
stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;
