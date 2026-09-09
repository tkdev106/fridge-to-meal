-- 在庫品（StockItem）の表と RLS ポリシー。backlog B-07a / ADR-028（提案）。
--
-- **この1ファイルで表・RLS の有効化・4つのポリシーまでを揃える。** 分けると、
-- 片方だけ適用された状態＝RLS の無い stock_items が実在する窓ができる。
--
-- 世帯は household_id = (select auth.uid()) で表す。列名を user_id にしないこと、
-- アプリが常に householdId を渡すことの2つを守る限り、共有が要件になった日の移行は
-- 行を1件も書き換えずポリシーの差し替えだけで済む（ADR-028）。

-- **適用手段に依らず1トランザクションで通す。** SQL エディタは複数文をまとめて流すが、
-- psql -f は文ごとに別のトランザクションになり、途中で失敗すると上の窓が実際に開く。
begin;

create table public.stock_items (
  -- 既定値を置かない。識別子はアプリが発行して渡す（ADR-026）。既定値があると、
  -- 渡し忘れが別の値で黙って成功し、返した DTO の id と DB の id がずれる。
  id uuid primary key,

  -- 既定値（auth.uid()）を置かない。渡し忘れを隠すうえ、共有が要件になった日には
  -- 値の意味が変わる（世帯 id ≠ 利用者 id）ため、そのとき必ず消すことになる。
  household_id uuid not null,

  -- 空白だけの名称を持たせない。ドメイン（createStockItem）が同じ規則を持っており、
  -- ここは二重の網である。
  name text not null constraint stock_items_name_not_blank check (btrim(name) <> ''),

  -- カタログの食材を指す。**外部キーを張らない** — コンテキストをまたぐ参照は識別子で
  -- 行い（ADR-008）、カタログに無い名前でも登録が止まらないことが要件（FR-03）。
  ingredient_id uuid,

  -- 自由文字列。数値と単位に分解しない（ADR-010）。「無い」を null の一通りに保つ。
  amount text constraint stock_items_amount_not_blank check (amount is null or btrim(amount) <> ''),

  -- date 型にする。PostgREST は YYYY-MM-DD で返し ExpiryDate の表現と一致する。
  -- timestamptz だと時刻とタイムゾーンが入り、文字列比較による並び（B-05）が揺れる。
  -- text だと 2026-02-30 のような暦に無い日付を DB が弾かない。
  expiry_date date
);

-- 一覧は必ず世帯で絞る（C-9）。期限順の並べ替えはユースケースが行うため、
-- expiry_date の索引は先回りして置かない。
create index stock_items_household_id_idx on public.stock_items (household_id);

alter table public.stock_items enable row level security;

-- using は「既に在る行が対象になるか」、with check は「書き込んだあとの行が満たすべき
-- 条件」。読み取り側だけを書くと「見えないが作れる」穴が残る。

create policy stock_items_select on public.stock_items
  for select to authenticated
  using (household_id = (select auth.uid()));

-- insert に using は存在しない。**with check を落とすことは「誰の行でも作れる」と
-- 書いたことに等しい** — しかも作った本人には select ポリシーで見えないため、
-- 画面上は何も起きていないように見える。
create policy stock_items_insert on public.stock_items
  for insert to authenticated
  with check (household_id = (select auth.uid()));

-- update は両方が要る。using だけだと自分の行を他世帯へ移せてしまい、
-- with check だけだと他世帯の行を掴めてしまう。
create policy stock_items_update on public.stock_items
  for update to authenticated
  using (household_id = (select auth.uid()))
  with check (household_id = (select auth.uid()));

create policy stock_items_delete on public.stock_items
  for delete to authenticated
  using (household_id = (select auth.uid()));

-- 権限は authenticated にだけ与える。RLS は service_role を迂回させるため、
-- 接続に service_role を使わないことが前提として効き続ける（ADR-020 / NFR-09）。
revoke all on public.stock_items from anon;
grant select, insert, update, delete on public.stock_items to authenticated;

commit;
