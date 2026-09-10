# backlog

自律ループ（`/next`）の入力。**上から順に1件ずつ着手し、1件 = 1 PR** で `main` に入れる。
運用は `docs/workflow.md`。

- 完了した行は**消す**。何をやったかの履歴は `git log` にあり、ここに二重に持たない
- 1 PR で説明できる大きさに収める。収まらないなら、実装より先に**分割する PR** を出す
- 画面に出せない段階でもマージする。表示は feature flag で止める（ADR-024）
- ここに無いものを勝手に足さない。必要になったら、まず backlog に行を足す提案をする
- 各行の括弧内は根拠（FR / NFR は `docs/requirements.md`、C-n は `docs/domain-model.md` 第7章、
  ADR-n は `docs/adr.md`）。運用由来のものは `docs/workflow.md` でよい。
  **根拠を書けないタスクは backlog に入れない**

> 順序は「在庫を1本の縦切りで通してから献立に入る」という方針。**ドメインを先に置き、DTO は
> そこから導く**（依存の向きと揃える）。**2026-09-08 にユーザーが確定**。以後は上から順に取る。

---

## 次にやること

- [ ] **B-07c** ORM の基盤を置き、`supabase/migrations/20260909154500_create_stock_items.sql`（手書き）を
  **生成したマイグレーションに置き換える**（ADR-029）。
  `drizzle-orm` / `drizzle-kit` / `postgres` を足す（**2026-09-10 にユーザーが承認済み**）。`apps/api/drizzle.config.ts` と、
  drizzle スキーマを `contexts/pantry/infrastructure/db/` に置く。**RLS の有効化・`force row level security`・4ポリシー・
  権限は生成物に手で足し、表と同じ1ファイルに収める** — 分けると RLS の無い表が実在する窓が開く（ADR-028）。
  `wrangler.toml` と `supabase/migrations/README.md` のコメントを新しい接続方式に直す。**まだ DB に繋がない。
  `pnpm verify` は緑のまま**（ADR-029 / ADR-028 / ADR-026）
- [ ] **B-07d** ローカル Postgres と `pnpm test:db` の枠を置く。`docker-compose.yml`（Postgres）、初期化 SQL
  （`authenticated` ロール・**非所有者のログインロール**・`auth.uid()` に相当する関数）、`vitest.db.config.ts`、
  `pnpm test:db`、**`pnpm test` 側の `exclude`**（同じテストが2度走らないように）、CI に Postgres を足して両方を走らせる。
  同じ周で `docs/testing.md` の「実 Supabase を要する」を直す。テストは煙テスト1本（`authenticated` として繋がり、
  **クレーム無しでは0行**）。**Docker が無い環境では赤を CI で確かめる**（ADR-029 / docs/workflow.md 2章）
- [ ] **B-07b** RLS の回帰テスト。他世帯の行が**見えない・書けない・消せない**ことを、**ローカル Postgres に対して**
  確かめる（実 Supabase ではなくなった）。**`insert` の `with check` と `update` の両側**を1件ずつ。
  **クレームを張り忘れた問い合わせが0行になることも確かめる** — これが3点セットの効きそのものである。
  **RLS は効いていないことに気づけない** — ポリシーを1行消してもアプリは正常に動き続ける（ADR-029 / ADR-028 / NFR-09 / C-9）
- [ ] **B-07** `pantry/infrastructure`: **`StockItemRepositoryImpl`**（Drizzle 実装）。**supabase-js は使わない。**
  リクエストごとに**トランザクション**を作り、そこにクレームとロールを張った接続を渡す — **クライアントの使い回しではなく
  トランザクションの寿命**が問題になる。`save` の上書きと `save.householdMismatch`、`findById` が他世帯を `null` に
  することを実 DB で確かめる。**`StockItemRepository` の doc の「supabase-js で問い合わせる」の1文をここで直す**
  （ADR-029 / ADR-002 / C-9 / NFR-09）
- [ ] **B-07e** `identity`: 受け取った JWT を**サーバ側で検証**し、`sub` を取り出す。**検証せずにクレームを張ることは、
  任意の世帯になりすませることと同じ**（ADR-029 の結果2）。PostgREST を通らなくなったことで生じた責務であり、
  **これを置くまで DB の経路を本番に出さない。** **鍵の方式（共有秘密 / JWKS）を着手時に確かめ、依存の追加が要るなら止まる**（NFR-09）
- [ ] **B-07f** **Workers から Postgres への接続経路を確かめる**（Hyperdrive の要否）。**このコンテナでは確かめられない** —
  Cloudflare と Supabase の実環境が要る。結果しだいで **ADR-029 の承認が動き**、要れば設定の追加として新しい ADR を起こす。
  **B-09（結線）の前に置く**（ADR-029 の結果3 / ADR-015 / ADR-020 の結果2）
- [ ] **B-08** `pantry/api`: Hono のルート。やりとりは DTO だけで、ドメインの型を HTTP 層に出さない（ADR-003）。
  **`PantryRuleViolation.rule` から状態コードを引く表を設計書に持たせる** — B-06 の
  `update.notFound` と B-06a の `delete.notFound`（どちらも見つからない）を規則違反の
  一種として表したため、404 と 400 の区別が `rule` の値に載っている。表が無いと
  すべて 400 になる
- [ ] **B-09** `apps/api/src/main.ts`: composition root で結線する。実装クラスの生成をここだけに閉じる
- [ ] **B-10** `apps/web`: feature flag の仕組み。`features.ts` の1か所で `VITE_FEATURE_*` を読み、既定は無効（ADR-024 / docs/workflow.md）
- [ ] **B-11** `apps/web`: 在庫一覧の画面。残日数を出し、期限が近いものを区別する。**色だけで表さない**（FR-04 / FR-11 / FR-12 / NFR-17）
- [ ] **B-12** `apps/web`: 在庫登録の画面。1件を10秒以内、片手で完結（FR-01 / FR-03 / NFR-14 / NFR-15）
- [ ] **B-13** `meal/domain/service`: `MealCoverageService`。**主材料だけを名称の完全一致で突き合わせる**（C-6 / C-16）。
  **突き合わせる前に両側の前後空白を落とす** — 在庫品の名称は登録時に落としてあり、片側だけ正規化すると一致が静かにずれる
- [ ] **B-14** `meal/domain/service`: `CookableMealFinder`。不足0件のみ、並びは決定的（C-10 / C-12 / C-13）
- [ ] **B-15** `meal/domain/port`: `MealGenerator` ポートの定義。プロバイダ未決のまま進める（ADR-019 / NFR-18）

## 判断待ち（着手しない）

ループが触れたら止まるもの。**decision が入るまで backlog の「次にやること」に上げない。**

| 待っているもの | これが決まらないと着手できないタスク |
| --- | --- |
| 食材マスタの初期データ（出所・件数） | 食材名のサジェスト（FR-02）。充足の当たり方（C-6）がここに懸かっている |
| LLM プロバイダ（ADR-019） | `MealGenerator` の腐敗防止層の実装。**ポートの定義（B-15）までは進められる** |
| 献立の保持期間 | 献立の削除・期限切れの扱い |
| 賞味期限と消費期限の区別 | 期限の警告の出し分け（FR-12） |
| Supabase 無料プランの一時停止対応 | 稼働の維持に関する運用タスク |
