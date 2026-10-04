# 技術スタックと構成

使っている技術・実装上の必須事項・ディレクトリ構成・lint の仕組み・環境変数の詳細。
`CLAUDE.md` には要点だけを置き、理由と細部はここに置く。各層の置き場所の意味は `apps/api/src/README.md`。

## 技術スタック

| 領域 | 採用 | 根拠 |
| --- | --- | --- |
| フロントエンド | React 19 + Vite 8（SPA・PWA） | ADR-014。Next.js は**採用しない** — サーバアクション類が ADR-003 と衝突するため |
| サーバサイド | Hono on Cloudflare Workers | ADR-015。ドメイン層とユースケース層はここに置かれる |
| 配信 | **web と api は別の Worker。** api は `fridge-to-meal-api`、web は静的アセットだけの `fridge-to-meal`（`apps/web/wrangler.toml`）。**どちらも Workers Builds が `main` から自動でデプロイする**。web の `VITE_*` の3つは Workers Builds のビルド変数に置く | ADR-082 |
| DB・認証 | Supabase（Postgres + Auth）。**DB アクセスは Drizzle**（`drizzle-orm` + `postgres`）。**サーバの DB アクセスに supabase-js は使わない** — この禁止は `apps/api` の問い合わせに限る（ADR-029 決定1 は「認証と Postgres そのものは Supabase のまま使う」と続けている） | ADR-029（ADR-020 を置き換え） |
| web のログイン | **`@supabase/supabase-js` を `apps/web` に置き、メールとパスワードでサインインする。** セッションは継ぎ目1つの背後に閉じ、**画面はライブラリの型を見ない。** **継ぎ目は `apps/web/src/session/` に置かれた**（B-34）。**画面（`features/identity/`）と結線（`main.tsx`）も置かれた**（B-35）。サインインの失敗の種別は分けておらず、画面の断りの文言は原因を断定しない。**サインアップの断りだけは種別に分ける**（B-73） | ADR-046 / ADR-081 |
| Workers → Postgres の経路 | **Cloudflare Hyperdrive 経由。** origin は Supabase の直接接続（`db.<ref>.supabase.co:5432`）。Supavisor は使わない。**問い合わせキャッシュは切る** | ADR-042 / ADR-044 |
| アクセストークンの検証 | **JWKS（ES256）。** 共有秘密は使わない | ADR-043（ADR-031 を置き換え） |
| LLM | **Gemini `gemini-3.5-flash-lite`（最初は無料枠）。** SDK を使わず `fetch` で呼ぶ | ADR-079（ADR-019 を置き換え） |
| 検証 | Vitest 5 / ESLint 10 + typescript-eslint / dependency-cruiser / Prettier。**画面のコンポーネントは jsdom + `@testing-library/react` で描いて観察する**（既定の環境は `node` のまま。要る回だけ `// @vitest-environment jsdom` を宣言する） | `docs/testing.md` / `docs/workflow.md` 2章 / ADR-052 |

## 実装上の必須事項

- **Supabase の Postgres には `authenticated` ロールで繋ぐ。`service_role` キーと、表の所有者ロールの接続文字列を使わない。** どちらも RLS を迂回してしまい、Supabase を選んだ理由（世帯分離の安全網）が消える。**この禁止はアプリの実行経路のものである** — 本番への移行の適用だけは、CI が Secret `SUPABASE_DB_URL` の所有者 `postgres` で流す（ADR-077 決定3・5）。一時停止を防ぐ1日1回の読み取り（`read only`）も同じ Secret を使う（ADR-078 結果1）。
- **1リクエスト1トランザクションとし、その中で `set local role` と `set local request.jwt.claims` を張る。`local` を落とさない。** 接続プーラは接続を貸し回すため、セッションに残した設定は他人のリクエストに漏れる。**クレームを張り忘れた問い合わせは0行になる**（他世帯が見えるのではない）。実装は `shared/infrastructure/db/HouseholdTransaction.ts`（B-17 で pantry から移った。ADR-059）。
- **受け取った JWT はサーバ側で検証してからクレームに張る。** PostgREST を通らなくなったため、署名と有効期限の検証はアプリの責務である。検証せずに `sub` を張ることは、任意の世帯になりすませることと同じ（ADR-029 の結果2）。実装は `contexts/identity/infrastructure/HouseholdAuthenticatorImpl.ts`。**検証は JWKS（ES256）で行う** — 実環境が非対称鍵で署名していることを確かめた（ADR-043 / B-07f、実装は B-07g）。**鍵が引けないことと設定が空であることを `IdentityRuleViolation` に包まない** — 包むと api 層の写像が 401 を返し、サーバ側の不備を利用者のアクセストークンのせいにする。**`issuer` / `audience` は省略できない** — hono は空文字を「照合しない」と読むため、空を通すと照合が消えたことに気づけない。
- **Workers から Postgres へは Hyperdrive 経由で繋ぐ。直接 TCP で繋がない。** 到達はできるが、**TLS を要求すると接続のやり直しが繰り返され、1リクエストあたりの外向き接続数の上限に当たって落ちる**（B-07f で実測）。NFR-08 は例外を認めていないため、TLS を捨てる選択肢は無い（ADR-042）。**`prepare: false` と `fetch_types: false` をドライバに与える。**
- **Hyperdrive の問い合わせキャッシュを切る**（`caching.disabled`。ADR-044）。読み取りはすべて世帯で絞られており**キャッシュから得るものが無い**のに、噛み合わなければ他世帯の在庫が**例外も警告もなく**返る。**リポジトリの側からは検査できない設定である** — 新しい環境を立てるときは `wrangler hyperdrive get <id>` で確かめる。
- **LLM の API キーはクライアントに置かない。** 生成の呼び出しは必ずサーバ経由（NFR-10）。
- **Workers の実行時間・CPU 制限に LLM 呼び出しが収まるか、実装初期に確認する。** 収まらなければストリーミングか非同期化に切り替える。

## ディレクトリ構成

```
.claude/                   エージェントの作業環境
  settings.json            許可・拒否とフックの登録（settings.local.json は各自のもので git 管理外）
  hooks/guard.mjs          戻せない操作・main への push の拒否。guard.test.mjs が回帰テスト
  hooks/session-start.sh   web セッション開始時の pnpm install・ローカル Postgres の起動・コミット作者とメッセージ形式の設定
  commands/                /next（ループ1周）/tdd（テスト駆動で1件）/verify /sync /address
  agents/design-writer     タスク1件を設計書に落とす。実装の3段はこれを入力に取る
  agents/test-designer     観察可能な振る舞いを洗い出し、テストケース一覧を作る
  agents/test-writer       一覧をテストにし、落ちること（赤）を確認する
  agents/implementer       テストを変えずに緑にする
  agents/design-reviewer   差分を設計文書と突き合わせる読み手
.githooks/pre-push         main への push を git の側で止める（要 core.hooksPath）。pre-push.test.mjs が回帰テスト
.github/workflows/ci.yml   PR と main への push で pnpm verify と pnpm test:db を別ジョブで回す
.github/workflows/cleanup-assigned-branches.yml  web セッションが残す claude/* の枝を毎日掃除する
.github/workflows/migrate-production.yml  main に入った移行を本番の Supabase へ流す（ADR-077。本番に書き込む唯一の workflow）
.github/workflows/keep-supabase-active.yml  本番の Supabase を1日1回読み、無料プランの一時停止を防ぐ（ADR-078。読み取りだけ）
apps/web/                  React + Vite（PWA）— API のクライアント
  src/session/             セッションの継ぎ目。**ここは画面ではない**（ADR-046 決定3）。@supabase/* を import してよい唯一の場所
  src/navigation/          下タブの器（B-38）。**ここも画面ではない継ぎ目**で、3コンテキストの画面を並べる
  src/connectivity/       接続状態の継ぎ目とオフラインの帯（B-70）。**ここも画面ではない継ぎ目**で、門と main.tsx だけが引く
  src/backNavigation/      端末の「戻る」の継ぎ目（B-75 / ADR-084）。window.history に触るのはここだけ。features/ は BackHandler.tsx の hook だけを引く
  src/icons/               アイコンの部品（B-59。原本の11個の SVG）。**ここも画面ではない** — `features/` を横断して引かれる
  src/global.css           `:root` のトークン・リセット・地（B-59 / ADR-055 決定2）。`index.html` が読む
  public/fonts/            書体（B-59b / ADR-075）。`fonts.css` は `@font-face` だけ。差し替えは版の入ったディレクトリごと
  src/features/pantry/     画面もコンテキスト単位で切る（PantryTab が一覧と登録を出し分ける / PantryList / PantrySections / RemainingDays）
  src/features/meal/
  test/                    画面ロジックの単体テスト
  test/support/dom/        コンポーネントを描く継ぎ目（ADR-052）。@testing-library/* はここだけが import する
apps/api/                  Hono on Cloudflare Workers
  src/contexts/meal/       ← コアドメイン
    domain/
      entity/  value/  service/  repository/«if»  port/«if»  error/
    usecase/
    infrastructure/        ← 腐敗防止層はここ
    api/
  src/contexts/pantry/     同じ5つのディレクトリ。infrastructure/db/ に Drizzle の schema
  src/contexts/catalog/
  src/contexts/identity/   infrastructure/db/ に世帯の参加と招待の schema
  src/shared/domain/
  src/shared/api/            HTTP 層が共有する最小限の部品（500 に畳む失敗のログ。ADR-080）
  src/shared/infrastructure/  コンテキストをまたぐインフラ（トランザクションの helper）。infrastructure/ と main.ts だけが引く（ADR-059）
  src/main.ts              composition root
  test/contexts/           単体テスト（src と同じ木）
  test/contract/           packages/contract との突き合わせ
  test/db/                 pnpm test:db の対象。RLS とリポジトリ実装
  test/migrations/         移行 SQL の検査
  test/support/            Fixed* / InMemory* の差し替え実装と DB の helper
  drizzle.config.ts        pnpm --filter @fridge-to-meal/api db:generate
packages/contract/         API の型定義。web と api で共有
supabase/migrations/       移行 SQL（drizzle-kit 生成）と meta/
supabase/local/init.sql    ローカル Postgres の役と auth.uid()
tools/prompt-trial/        献立生成プロンプトの試行ツール（アプリ本体ではない。依存ルールの対象外）
tools/start-local-postgres.sh  Docker 無しでローカル Postgres を立てる（ADR-030）
docs/                      設計文書
```

「ドメイン」が2つの意味で使われる点に注意。**業務領域としてのドメイン**（献立・在庫）は `contexts/meal/` — コンテキストの単位。**層としてのドメイン層**は `contexts/meal/domain/`。

## lint の仕組み

| コマンド | 中身 |
| --- | --- |
| `pnpm lint:code` | ESLint。型の指摘に加えて、**禁止語（`Recipe` / `Menu` 等）を識別子に書くとエラーにする** |
| `pnpm lint:deps` | dependency-cruiser。**`CLAUDE.md` の依存ルールの表を機械的に検査する** |

依存ルールは `.dependency-cruiser.cjs` にあり、**`CLAUDE.md` の表と1対1で対応している。**
表を変えたらそちらも変えること。**規則を緩めて表を放置しない。**

**ワークスペースの package は `exports` に `source` 条件を持つ**（`packages/contract/package.json`）。
`lint:deps` はこれでソースを解決する。ビルド成果物を経由すると2つ壊れる — `dist` の無いクローン
（CI）では `lint` が `build` より先に走るため「存在しないモジュール」で落ち、`dist` があるときは
`exclude` に当たって**辺がグラフから消え、規則が当たらないまま緑になる**。
**新しい package を足すときも `source` を書く。**

## 環境変数

`apps/api/.dev.vars`（gitignore 済み）に置く。**これはサーバ側の置き場である。**

```
SUPABASE_URL=...          # 認証（Supabase Auth）用。DB アクセスには使わない
SUPABASE_ANON_KEY=...     # 同上
GEMINI_API_KEY=...        # 献立の生成（ADR-079 決定4）。本番は `wrangler secret put GEMINI_API_KEY`
```

**モデル名 `GEMINI_MODEL` は秘密ではないので `.dev.vars` に置かず、`apps/api/wrangler.toml` の `[vars]` に1か所だけ置く**（ADR-079 決定4）。

**鍵を3つに分けて扱う（ADR-046 決定4）。混ぜて「クライアントに置かない」と括らない。**

| 鍵 | 扱い |
| --- | --- |
| **anon key** | **公開される前提の鍵。** RLS が守るので、web のバンドルに焼き込まれてよい。web 側は `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` として持つ（**`VITE_` の付いたものはビルド時にバンドルへ入る**）。**`.dev.vars` には足さない** — あちらはサーバ専用である |
| **`service_role` キー** | **使わない。** RLS を迂回し、Supabase を選んだ理由が消える（ADR-029 結果1） |
| **LLM の API キー** | **サーバ側だけ。** クライアントに置くと抽出されて無制限に使われる（NFR-10） |

**`apps/web` には鍵でない必須の設定がもう1つある。** `VITE_API_BASE_URL`（api の基点。`https://…` や `http://127.0.0.1:8787`）であり、**既定値を埋め込まない** — 埋め込むと、設定を忘れたビルドが間違った相手を静かに叩く。欠けていれば起動時に `Error` で落ち、message に名前が出る（ADR-048 決定4 / 結果1）。**秘密ではないが、web だけが持つ**（`.dev.vars` はサーバ専用である）。

**Postgres への接続情報はここに置かない。** Hyperdrive の設定（Cloudflare 側）が持ち、`main.ts` は
`env.HYPERDRIVE.connectionString` を読む（ADR-042 決定2）。binding は `apps/api/wrangler.toml` の
`[[hyperdrive]]`（`binding = "HYPERDRIVE"`）にある。**`id` は B-07f で作った Hyperdrive のもの**
（秘密ではない。ADR-042 結果2）。**この設定の問い合わせキャッシュが切れていることは
2026-09-19 にユーザーが確かめた**（ADR-044 決定3）。手元の `wrangler dev` はローカル Postgres の `authenticator`
（`127.0.0.1:55432`）を既定で使う — `pnpm --filter @fridge-to-meal/api dev` がその値を
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` に入れる。別の接続先にしたければ
同じ名の環境変数を外から与える（旧名 `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` も
読むが、wrangler 4.129 はこれを非推奨にした）。**新しい環境を立てるときは `wrangler hyperdrive get <id>`
で `caching.disabled` が真であることを確かめる**（ADR-044 決定3。リポジトリの側からは検査できない）。

**`SUPABASE_JWT_SECRET` は使わない。** 検証は JWKS で行う（ADR-043）。取りに行く先は
`<SUPABASE_URL>/auth/v1/.well-known/jwks.json` であり、**公開鍵の一覧なので秘密ではない。**

**`DATABASE_URL` は `pnpm --filter @fridge-to-meal/api db:generate` にだけ残る**
（`apps/api/drizzle.config.ts` が読む）。生成はスキーマの差分だけで行われ DB に繋がないため、
**空でも通る。** アプリの実行経路はここを読まない。

**`service_role` キーと、表の所有者ロールの接続文字列を使わない**（どちらも RLS を迂回する。鍵の3分類は上の表）。**アプリの実行経路の規則であり**、移行の適用と一時停止を防ぐ読み取りだけは CI が所有者の接続文字列を Secret から使う（ADR-077 決定5 / ADR-078 結果1）。**接続に使うロールは、表を持たない非所有者のログインロールを別に作る** — 実 Supabase の `postgres` は表の所有者であり、`authenticator` は PostgREST が使っているため、どちらも使わない（B-07f で確認）。

**ローカル Postgres の接続先は秘密でない**ため `.dev.vars` に置かず、`docker-compose.yml` と CI、
`apps/api/package.json` の `dev` スクリプトから渡す（`apps/api/test/support/db/ConnectionStrings.ts` が
127.0.0.1:55432 を固定で持つ）。
