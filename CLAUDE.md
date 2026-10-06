# fridge-to-meal

冷蔵庫の在庫を登録し、その在庫で作れる献立を提案する個人向け Web アプリ。
目的は「今日何作ろう」を考える手間をなくすこと。**在庫管理は手段であって目的ではない。**

構成は pnpm のモノレポ: `apps/web`（React 19 + Vite 8 の SPA・PWA）、`apps/api`（Hono on Cloudflare Workers）、
`packages/contract`（API の型。web と api で共有）、`supabase/migrations`（Postgres の移行 SQL）。

## 迷ったらここを見る

| 知りたいこと | ファイル |
| --- | --- |
| 何が既にあるか（コンテキストごとの実装の要約） | `docs/implementation-status.md` |
| 次に何をやるか（ループの入力になるタスク一覧） | `docs/backlog.md` |
| 何を作るか（機能要件・非機能要件・コスト設計） | `docs/requirements.md` |
| どう表現するか（ドメインモデル・用語・不変条件・確定事項） | `docs/domain-model.md` |
| なぜその作りなのか（アーキテクチャ決定） | `docs/adr.md` |
| 技術スタック・実装上の必須事項の詳細・ディレクトリ構成・環境変数 | `docs/architecture.md` |
| LLM に何を渡し何を受け取るか（プロンプト全文・応答の検証規則） | `docs/prompt-design.md` |
| 画面に何をどう出すか（遷移・状態・再利用の見せ方） | `docs/screen-design.md` |
| 画面がどう見えるか（配色・書体・寸法・文言。**文言もこちらが正**） | `docs/design/`（入口は `README.md`。ADR-074） |
| どうテストするか（古典派・観察可能な振る舞い・TDD の1周） | `docs/testing.md` |
| どう進めるか（ブランチ運用・完了の定義・自律ループ・安全装置） | `docs/workflow.md` |
| 各層の置き場所の意味 | `apps/api/src/README.md` |

## コマンド

前提: Node 22 以上と pnpm 10（corepack が版を合わせる）。初回は `pnpm install`。

```
pnpm verify       # 完了の定義の片方。Docker を要さない。format:check → lint → typecheck → test → test:hooks → build
pnpm test:db      # もう片方。ローカル Postgres に対する RLS とリポジトリ実装のテスト
pnpm db:up        # その相手を Docker で立てる
pnpm db:up:native # Docker が使えないときはこちら（ADR-030）。エージェントのコンテナはセッション開始のフックが立てている
pnpm dev          # web (:5173) と api (:8787) を同時起動
pnpm test         # vitest
pnpm test:hooks   # guard.mjs と pre-push の回帰テスト（node --test）
pnpm typecheck    # tsc --build。全ワークスペース（テストの tsconfig も含む）
pnpm lint         # lint:code（ESLint と禁止語）と lint:deps（dependency-cruiser で依存ルール）
pnpm build        # contract → apps の順にビルド
pnpm format       # prettier。docs/ と tools/ は対象外

pnpm --filter @fridge-to-meal/api dev      # wrangler dev
pnpm --filter @fridge-to-meal/web dev      # vite
pnpm --filter @fridge-to-meal/web build
```

**IMPORTANT: 完了の定義は `pnpm verify` と `pnpm test:db` の両方が緑になること。** PR を出す条件であり、
マージの条件でもある。CI（`.github/workflows/ci.yml`）が同じものを走らせる。テストを skip・無効化して緑にしない。
lint の規則を緩めて緑にしない（緩めたくなったら ADR の話）。

## 絶対に守る4つのこと

### 1. 用語表にない語をコードに書かない

日本語とコード上の識別子は1対1で固定されている。同義語の混在がこのプロジェクトで最も曖昧性を生む。

| 日本語 | 識別子 | 何者か |
| --- | --- | --- |
| 献立 | `Meal` | 生成された1つの献立。名称・材料・手順を持ち、永続化される |
| 提案 | `Suggestion` | 1回の提案で得た献立1〜3件と、そのときの在庫スナップショット |
| 材料 | `MealIngredient` | 献立が必要とする食材と分量 |
| 手順 | `CookingStep` | 調理の1ステップ |
| 調理記録 | `CookingRecord` | 献立を作ったという記録。追加のみ |
| 在庫スナップショット | `PantrySnapshot` | **ある時点の**在庫の複製。以後不変。`Suggestion` が抱えるのは生成時点のもの（ADR-037） |
| 充足 | `MealCoverage` | 現在の在庫で材料をどれだけ賄えるか。都度算出 |
| 作れる献立 | `CookableMeal` | 現在の在庫で不足0件の既存献立 |
| 在庫品 | `StockItem` | 冷蔵庫にある1件の食材 |
| 分量 | `Amount` | 「200g」「1本」。**自由文字列**、構造化しない |
| 食材 | `Ingredient` | カタログ上の食材の種類。在庫品とは別物 |
| 世帯 | `Household` | 冷蔵庫を共有する単位。全データの所有者 |

**禁止語 — コード・UI・仕様・コメントのどこにも使わない**（`pnpm lint:code` が検査する）:
`レシピ` / `Recipe` / `メニュー` / `Menu` / `候補` / `料理` / `ストック` / `アイテム` / `フード` / `献立案` / `MealIdea`。
`Recipe` は将来の自前レシピ DB のために予約済み（ADR-018）。

**識別子の流儀（ADR-039）:** コード上の識別子はローカルなものも含めてすべて英語。用語表にある概念は用語表の英語を
そのまま使い、訳語を自分で作らない（`献立` → `meal`、`在庫スナップショット` → `pantrySnapshot`）。禁止語は英語でも禁止。
**コメントと doc は日本語。** テストの `describe` は対象、`it` は振る舞いを日本語の文で書く（`docs/testing.md` 6章）。

### 2. 依存は外から内へ。`domain/` は何も import しない

| 依存する側 ↓ / される側 → | domain | usecase | infrastructure | api |
| --- | --- | --- | --- | --- |
| `domain/` | — | 禁止 | 禁止 | 禁止 |
| `usecase/` | 許可 | — | 禁止 | 禁止 |
| `infrastructure/` | 許可 | 禁止 | — | 禁止 |
| `api/` | 禁止 | 許可 | 禁止 | — |
| `main.ts`（composition root） | 許可 | 許可 | 許可 | 許可 |

この表は `.dependency-cruiser.cjs` と1対1で対応している（`pnpm lint:deps` が検査する）。表を変えたらそちらも変える。

- コンテキストをまたぐ import は `usecase/` どうしだけ。相手の `domain/` を直接 import せず、名称などのプリミティブで受け取る（ADR-033）
- `usecase/` は `domain/` の兄弟であって下ではない（`contexts/meal/usecase/` が正しい）
- ユースケースの引数と戻り値にフレームワーク由来の型（`Request` / `Response` / `Context`）を入れない。DTO だけを受け渡す（ADR-003）
- `shared/infrastructure/`（トランザクションの helper）を import してよいのは各コンテキストの `infrastructure/` と `main.ts` だけ。`shared/` は `contexts/` を import しない（ADR-059）
- 実装クラスを `new` してよいのは `apps/api/src/main.ts` だけ。実装クラスは `<interface 名>Impl` と名づけ、`Db` / `Supabase` / `Drizzle` の接頭辞を付けない（ADR-029）
- ドメイン層の型・識別子・ロジックに LLM・プロンプト・JSON・モデル名・SQL を持ち込まない。外部との変換は `infrastructure/` の腐敗防止層が担う（ADR-005）。設計の意図を書くコメントに語が現れるのは可
- `householdId` はリポジトリの全メソッドで必須引数（C-9）
- リポジトリの口が並び順を約束するのは `limit` で一部だけ返すときだけ。全件返す口は約束せず、並べ替えはユースケース層が行う（ADR-038）
- api 層は世帯と識別子の型をユースケースから導出し、規則違反は例外の `name` で見分ける（ADR-032）
- `@supabase/*` を import してよいのは `apps/web/src/session/` だけ。画面は継ぎ目の型だけを見る（ADR-046 決定3）

### 3. 確定事項 C-1〜C-16 を勝手に変えない

`docs/domain-model.md` 第7章。実装の都合で破らない。破る必要が出たら、**コードを書く前に相談する。** とくに引っかかりやすいもの:

- **C-3** 献立は生成後に編集できない。追加されるのは調理記録のみ
- **C-5** 材料は `StockItemId` を持たず、文字列として複製する
- **C-6** 充足判定は食材名の**完全一致**（表記ゆれは吸収しない）
- **C-8** 「作った」を記録しても在庫は自動で減らさない
- **C-10** 再利用の対象は不足材料**0件**のものだけ
- **C-12** 再利用の並び順は**決定的**でなければならない

### 4. 未決事項を勝手に決めない

今、未決の事項は無い（Supabase 無料プランの一時停止対応は ADR-078、LLM プロバイダは ADR-079、起動時に開く画面は ADR-064 で決まった）。
新たに決めるべきことが出たら、この節に足してユーザーに聞く。

## 実装上の必須事項

理由と細部は `docs/architecture.md`「実装上の必須事項」。

- Supabase の Postgres には `authenticated` ロールで繋ぐ。**`service_role` キーと、表の所有者ロールの接続文字列をアプリの実行経路で使わない**（RLS を迂回する）
- 1リクエスト1トランザクションとし、その中で `set local role` と `set local request.jwt.claims` を張る。`local` を落とさない（`shared/infrastructure/db/HouseholdTransaction.ts`）
- 受け取った JWT はサーバ側で JWKS（ES256）で検証してからクレームに張る。鍵が引けないことと設定が空であることを `IdentityRuleViolation` に包まない（401 に化ける。ADR-045）
- Workers から Postgres へは Hyperdrive 経由で繋ぎ、`prepare: false` と `fetch_types: false` を与える。Hyperdrive の問い合わせキャッシュは切る（ADR-042 / ADR-044）
- LLM の API キーはクライアントに置かない。生成の呼び出しは必ずサーバ経由（NFR-10）
- サーバの DB アクセスは Drizzle。supabase-js は使わない（web のログインだけは `apps/web/src/session/` で使う）

### 環境変数

サーバ側は `apps/api/.dev.vars`（gitignore 済み）に `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `GEMINI_API_KEY` を置く。
モデル名 `GEMINI_MODEL` は `apps/api/wrangler.toml` の `[vars]`。web は `apps/web/.env.local` に
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_API_BASE_URL`（無ければ起動時に落ちる）。
Postgres の接続情報は Hyperdrive が持つ。`.dev.vars` と `.env*` は読まない（`guard.mjs` が止める）。
鍵の扱いの区別（anon key は公開前提、LLM の鍵はサーバだけ）と詳細は `docs/architecture.md`「環境変数」。

## ブランチ運用と自律ループ

詳細は `docs/workflow.md`。人が1コマンドずつ見ていない前提の運用である。

- トランクベース。作業ブランチ1本 = 1 PR = 1タスク。`<type>/<slug>` で切り、**squash merge** で入れる
- ブランチ名は名前だけで何をする枝か読めること。`claude` を含めない・生成された識別子を入れない・番号だけにしない（`guard.mjs` と `.githooks/pre-push` が断る）
- **`main` への直接 push は禁止**（`guard.mjs` と `.githooks/pre-push` で止める。GitHub のブランチ保護は効かない）
- 未完成の機能もマージを止めない。**feature flag は置かない**（ADR-082 決定5。本番を使うのはユーザー本人だけ）
- ループの1周は `/next`。実装の前に `design-writer` が設計書を `z-ai/design/<ID>.md` に書き、`/tdd` が `test-designer` → `test-writer` → `implementer` を回す
- 止まる条件（C-1〜C-16 を破る必要・未決事項の決定・FR / NFR に無い機能・**依存パッケージの追加**・同じ検証失敗を2回直せない・テストが仕様として誤っている）に当たったら、ドラフト PR を push して1つの質問にして終える。黙って止まらない。黙って進めない

## Claude Code on the web で作業するとき

web のセッションは `claude/<slug>-<識別子>` という枝をハーネスが割り当てて始まる。この名前は上のブランチ名の規則に
反し、`guard.mjs` と `pre-push` がどちらも断る。両方を満たす進め方:

- **PR は `<type>/<slug>` の枝から出す。** `/next` の手順どおり `git switch -c <type>/<slug>` で切り直し、そちらを push して PR にする
- 割り当てられた枝は、セッションの指示に従って成果を退避する先としてだけ使う。PR の head ではないのでマージ時の自動削除では消えないが、`.github/workflows/cleanup-assigned-branches.yml` が毎日掃除する（先端が7日より古く、開いている PR の無い `claude/*`。エージェントが消す必要はない）
- web のコンテナでは `core.hooksPath` を設定しない（割り当て枝への push が止まる）。`main` は `guard.mjs` が守る
- コミットの作者は `tkdev106`（`178723293+tkdev106@users.noreply.github.com`）に固定される。ローカルの git 設定はコンテナと一緒に消えるため、`.claude/hooks/session-start.sh` が開始のたびに入れ直す。手元の clone では `docs/workflow.md` 7章の手順で1度だけ入れる
- web のコンテナには `gh` が無い。PR の作成・CI の結果の確認・squash merge は GitHub の MCP ツール（`mcp__github__*`）で行う

## 作業の進め方

- 着手するタスクは `docs/backlog.md` から取る。無いものを勝手に始めず、まず行を足す提案をする
- 実装はシンプルな最小限にする。必要になるまで後方互換性・拡張の余地・汎用化は入れない（KISS）
- 要件にない機能を足さない。範囲は `docs/requirements.md` の FR / NFR
- 実装の前に、対象コンテキストの `docs/domain-model.md` の該当集約と不変条件を読み、実物（`apps/api/src/` と `apps/api/test/`）を見る
- アーキテクチャ上の判断を変えるときは `docs/adr.md` に新しい ADR を追記して提案する。既存の ADR は書き換えず状態を「置き換え済み」に改め、旧 ADR への参照を同じ周で掃除する（手順の正は `docs/adr.md` の冒頭）。**エージェントが起こした ADR の状態は `提案`。`承認` に変えるのはユーザーだけ**
- 書く場所を分ける。**コードには How、テストには What、コミットメッセージには Why、コメントには Why not**。コードを読めばわかることをコメントに繰り返さない。コメントに書くのは、別のやり方を取らなかった理由と、振る舞いの根拠の番号（`// C-6: 充足判定は名称の完全一致` の形。`docs/testing.md` 6章）
- 文書とコメントには今の正しい状態だけを書き、変更の経緯は書かない（経緯はコミットと PR に残る）
- ドメイン層とユースケース層は実行環境にもプロバイダにも依存しないため、未決事項を待たずに着手できる
