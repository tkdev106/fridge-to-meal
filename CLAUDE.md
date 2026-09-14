# fridge-to-meal

冷蔵庫の在庫を登録し、その在庫で作れる献立を提案する個人向け Web アプリ。
目的は「今日何作ろう」を考える手間をなくすこと。**在庫管理は手段であって目的ではない。**

> **現状（2026-09-13）: 実装フェーズ。在庫（pantry）コンテキストの縦切りが domain → usecase →
> infrastructure → api まで通っている。** ただし `apps/api/src/main.ts`（composition root）には
> まだ `/health` しか結線されておらず、画面もサーバから在庫を取れていない。
> 実装の現在地は下の「実装の現在地」、次にやることは `docs/backlog.md`。

---

## このリポジトリの位置づけ — public の非公開コピー

このリポジトリ（`tatsuro-kawakami-lvgs/fridge-to-meal`、private）は、public の
`tkdev106/fridge-to-meal` から**履歴ごと複製した開発用のコピー**である。

| リモート | 先 | 扱い |
| --- | --- | --- |
| `origin` | `https://github.com/tatsuro-kawakami-lvgs/fridge-to-meal` | **ここで開発する。** push してよい唯一のリモート |
| `upstream` | `https://github.com/tkdev106/fridge-to-meal.git` | **読み取り専用。** fetch はしてよい。**push は絶対にしない** |

**upstream への push は3枚で止める。** どれも越えられるが、うっかり越えないために置く。

| 層 | 何をするか | 効く範囲 |
| --- | --- | --- |
| `git remote set-url --push upstream no_push` | push 先の URL を壊し、物理的に不可能にする | その clone だけ。**コンテナが消えると消える**ので clone のたびに打つ（`docs/workflow.md` 7章） |
| `.claude/hooks/guard.mjs` の `push-to-upstream` | エージェントの `git push upstream …` と `tkdev106/fridge-to-meal` を含む URL への push を拒否する | エージェントが打つコマンド |
| `.githooks/pre-push` | リモート名が `upstream`、または URL に `tkdev106/fridge-to-meal` を含む push をすべて断る | `core.hooksPath` を設定した作業ツリー |

**upstream からの取り込みは人が行う。エージェントはやらない。** `main` は PR 経由でしか
更新できない決まり（下の「ブランチ運用」）と、upstream の履歴をそのまま `main` に載せたい
要求とがぶつかるため、取り込みは 2枚のフックを承知のうえで越える人の操作になる。

```sh
git fetch upstream
git switch main && git merge --ff-only upstream/main   # ff できなければ止まって相談する
git push --no-verify origin main                        # pre-push を意図的に越える。人だけが打つ
```

**origin から upstream への反映（public に戻す方法）は未決。** 決めるまでは、このリポジトリで
起きたことは public に出ないものとして扱う。

**枝のコミットの作者は `tkdev106` に固定する**（メールは `178723293+tkdev106@users.noreply.github.com`）。
リポジトリローカルの設定で行い、エージェントのコンテナでは `.claude/hooks/session-start.sh` が
セッション開始のたびに入れ直す。

**これは枝のコミットにしか効かない。** GitHub の squash merge が `main` に作るコミットの作者は
**PR を開いたアカウント**になり、`git config` では変えられない（PR #1 で確認済み。枝は `tkdev106`、
`main` は `tatsuro-kawakami-lvgs`）。**これは受け入れる。** `main` の作者を揃える必要があるかは、
上の「origin から upstream への反映」を決めるときに一緒に決める — それまで、マージ方法を変えたり
PR を開くアカウントを持ち替えたりしない。

### Claude Code on the web で作業するとき

web のセッションは `claude/<slug>-<生成された識別子>` という枝を**ハーネスが割り当てて**始まる。
この名前は `docs/workflow.md` 1章の規則（`claude` を含めない・生成された識別子を入れない）に
反し、`guard.mjs` と `pre-push` がどちらも断る名前である。**両方を満たす進め方は次のとおり。**

- **PR は `<type>/<slug>` の枝から出す。** `/next` の手順どおり `git switch -c <type>/<slug>` で
  切り直し、そちらを `origin` に push して PR にする。割り当てられた `claude/…` の枝から PR を出さない
- 割り当てられた枝は、セッションの指示に従って成果を退避する先としてだけ使う。**PR の head ではないので
  マージ時の自動削除では消えない。** `.github/workflows/cleanup-assigned-branches.yml` が毎日、先端が
  7日より古く、開いている PR の無い `claude/*` を消す。エージェントが消す必要はない
- web のコンテナでは `core.hooksPath` を設定しない（設定すると割り当て枝への push が止まり、
  セッションが成果を出せなくなる）。`main` と upstream は `guard.mjs` が守る
- web のコンテナには `upstream` リモートが無い（`git remote -v` で確かめられる）。無いものに push は
  できないので、`no_push` の設定はここでは要らない
- web のコンテナには **`gh` が無い。** PR の作成・CI の結果の確認・squash merge は
  GitHub の MCP ツール（`mcp__github__*`）で行う。`/next` の手順にどちらの書き方も置いてある

## 迷ったらここを見る

| 知りたいこと | ファイル |
| --- | --- |
| 何を作るか（機能要件・非機能要件・コスト設計） | `docs/requirements.md` |
| どう表現するか（ドメインモデル・用語・不変条件・確定事項） | `docs/domain-model.md` |
| なぜその作りなのか（アーキテクチャ決定 ADR-001〜033） | `docs/adr.md` |
| LLM に何を渡し何を受け取るか（プロンプト全文・応答の検証規則） | `docs/prompt-design.md` |
| 画面に何をどう出すか（遷移・状態・再利用の見せ方） | `docs/screen-design.md` |
| どうテストするか（古典派・観察可能な振る舞い・TDD の1周） | `docs/testing.md` |
| どう進めるか（ブランチ運用・完了の定義・自律ループ） | `docs/workflow.md` |
| 次に何をやるか（ループの入力になるタスク一覧） | `docs/backlog.md` |
| 各層の置き場所の意味 | `apps/api/src/README.md` |

`docs/html/` は同じ内容の閲覧用 HTML だが、**Markdown に追いついていない**（backlog B-18）。
**正は Markdown。HTML だけを直さないこと。HTML を根拠に判断しないこと。**

---

## 実装の現在地

`docs/backlog.md` の先頭から順に進める前提で、**何が既にあるか**をここに置く。
着手前に必ず実物（`apps/api/src/`）を見ること — この節は要約であって正ではない。

| コンテキスト | domain | usecase | infrastructure | api | 備考 |
| --- | --- | --- | --- | --- | --- |
| `pantry`（在庫） | `StockItem` 集約、`Amount` / `ExpiryDate` / `IngredientId` / `StockItemId`、`StockItemRepository`«if»、`StockItemIdGenerator`«if» | `RegisterStockItem` / `ListStockItems` / `UpdateStockItem` / `DeleteStockItem`、`StockItemDto` | `StockItemRepositoryImpl`（Drizzle）、`db/schema.ts`、`db/HouseholdTransaction.ts`（`set local role` とクレーム） | `StockItemRoutes`、`RuleViolationStatus` | **縦に一本通っている。** ただし `main.ts` に未結線（B-09） |
| `meal`（献立） | `Meal` / `Suggestion` 集約、`MealIngredient` / `MealCoverage` / `CookableMeal` / `Amount` / `CookingStep` / `CookingRecord` / `DateTime` / `MealId` / `StockItem` / `ExpiryDate` / `PantrySnapshot` / `SuggestionEntry` / `SuggestionId` / `GeneratedMeal`（value）、`MealCoverageService` / `CookableMealFinder`、`MealGenerator`«if» / `SuggestionIdGenerator`«if»、`MealRepository`«if» / `SuggestionRepository`«if»、`MealRuleViolation` | `SuggestMeals`（**再利用の経路だけ**） | — | — | **再利用だけが usecase まで伸びた。** `SuggestMeals` は作れる献立を C-11 で除いて上位3件を提案にし保存するが、**0件のときは `null` を返すだけで、生成は B-28**（`MealGenerator` の背後の腐敗防止層はプロバイダ待ち。ADR-019）。在庫品と期限は献立側にも起こしてあり、在庫品は名称・分量・期限の3項目（ADR-036 / ADR-037） |
| `identity`（世帯） | `HouseholdAuthenticator`«if»、`IdentityRuleViolation` | `IdentifyHousehold` | `HouseholdAuthenticatorImpl`（JWT を HS256 で検証。ADR-031 `提案`） | — | 実環境の署名方式は未確認（B-07f） |
| `catalog`（食材） | — | — | — | — | `.gitkeep` のみ。食材マスタの初期データが判断待ち |
| `shared/domain` | `HouseholdId` | | | | |

| 場所 | 現在地 |
| --- | --- |
| `apps/api/src/main.ts` | `GET /health` だけ。**実装クラスの `new` はまだ1つもない** |
| `apps/web/src/` | `App.tsx` が `PantryList` に常に0件を渡す。サーバ取得は B-22、登録画面は B-12 |
| `packages/contract/src/` | `pantry.ts`（在庫 API の型）と `error.ts` |
| `supabase/migrations/` | `stock_items` 表と RLS。`meta/` は drizzle-kit の生成物 |
| `apps/api/test/` | 単体（`contexts/`）・契約（`contract/`）・DB（`db/`、`pnpm test:db`）・移行（`migrations/`）の4種。差し替え用の `Fixed*` / `InMemory*` は `test/support/` |
| `tools/prompt-trial/` | 献立生成プロンプトの試行ツール。**アプリ本体ではない。** 7パターンの試行と費用の実測は未実行 |

**識別子の流儀（実物から読み取れる規則。合わせること）:** export される名前（用語表の型・クラス・
ユースケース・ファイル名）は**英語**で用語表どおり。ファイルの中だけで使うローカルな変数・関数・型は
**日本語**で書かれている（`検証済みクレーム`、`断り方にした例外`、`世帯にする`、`在庫の規則違反の状態コード` など。
`apps/api/src` のローカル名の約4分の3）。テストの `describe` は対象、`it` は振る舞いを日本語の文で書く
（`docs/testing.md`）。**1ファイルの中で流儀を混ぜない。**

---

## 絶対に守る4つのこと

### 1. 用語表にない語をコードに書かない

同義語の混在がこのプロジェクトで最も曖昧性を生む。日本語とコード上の識別子は1対1で固定されている。

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

**禁止語 — コード・UI・仕様のどこにも使わない:**
`レシピ` / `Recipe` / `メニュー` / `Menu` / `候補` / `料理` / `ストック` / `アイテム` / `フード` / `献立案` / `MealIdea`

> `Recipe` は将来の自前レシピ DB のために**予約済み**（ADR-018）。今は使わない。

### 2. 依存は外から内へ。`domain/` は何も import しない

| 依存する側 ↓ / される側 → | domain | usecase | infrastructure | api |
| --- | --- | --- | --- | --- |
| `domain/` | — | 禁止 | 禁止 | 禁止 |
| `usecase/` | 許可 | — | 禁止 | 禁止 |
| `infrastructure/` | 許可 | 禁止 | — | 禁止 |
| `api/` | 禁止 | 許可 | 禁止 | — |
| `main.ts`（composition root） | 許可 | 許可 | 許可 | 許可 |

コンテキストをまたぐ import は `usecase/` どうしだけ。相手の `domain/` を直接 import しない。
またぐ入力は相手の型ではなく名称などのプリミティブで受け取る（ADR-033）。

守るべき具体的なこと:

- **`usecase/` は `domain/` の兄弟であって、下ではない。** `contexts/meal/usecase/` が正しく、`contexts/meal/domain/usecase/` は誤り。
- **ユースケースの引数と戻り値にフレームワーク由来の型を入れない。** `Request` / `Response` / `Context` が1つでも現れたら、その層は Web に固定される（ADR-003）。DTO だけを受け渡す。
- **`new MealRepositoryImpl()` を書いてよいのは `apps/api/src/main.ts` だけ。** 他所で実装クラスを直接生成しない。
- **実装クラスは `<interface 名>Impl` と名づける。** `Db` / `Supabase` / `Drizzle` の接頭辞を付けない — 手段を名前に焼き付けると、差し替えるために interface を置いた意味が薄れる（ADR-029）。
- **ドメイン層に LLM・プロンプト・JSON・モデル名・SQL という語を出さない。** 外部との変換は `infrastructure/` の腐敗防止層が担う（ADR-005）。
- **`householdId` はリポジトリの全メソッドで必須引数。** 世帯をまたぐ取得を型として不可能にする（C-9）。
- **api 層は世帯と識別子の型をユースケースから導出し、規則違反は例外の `name` で見分ける**（ADR-032）。

これらは `pnpm lint:deps`（dependency-cruiser）と `pnpm lint:code`（ESLint の禁止語）が**機械的に検査する。**
規則を緩めて緑にしない。

### 3. 確定事項 C-1〜C-16 を勝手に変えない

`docs/domain-model.md` 第7章。実装の都合で破らないこと。とくに引っかかりやすいもの:

- **C-3** 献立は生成後に編集できない。追加されるのは調理記録のみ
- **C-5** 材料は `StockItemId` を持たず、文字列として複製する
- **C-6** 充足判定は食材名の**完全一致**（既知の割り切り。表記ゆれは吸収しない）
- **C-8** 「作った」を記録しても在庫は自動で減らさない
- **C-10** 再利用の対象は不足材料**0件**のものだけ。「ほぼ作れる」は使わない
- **C-12** 再利用の並び順は**決定的**でなければならない。同じ入力で順序が変わってはいけない

破る必要が出たら、**コードを書く前に相談する。**

### 4. 未決事項を勝手に決めない

| # | 未決の内容 |
| --- | --- |
| LLM プロバイダ | Claude / Gemini など。**意図的に未決**（ADR-019）。`MealGenerator` ポートの背後にあるので実装は進められる |
| 食材マスタの初期データ | 出所と件数。**再利用率がここに懸かっている**（C-6 経由） |
| 献立の保持期間 | 無制限か期限付きか。再利用は蓄積が多いほど効くため安易に消さない |
| 賞味期限と消費期限の区別 | MVP では単一の「期限」に統合している |
| Supabase 無料プランの一時停止対応 | 1週間アクセスがないと停止する |
| 起動時に開く画面 | 「献立」にしてよいか（`docs/screen-design.md` 論点1） |
| Workers → Postgres の接続経路と JWT の署名方式 | 実環境が要る（B-07f）。決まるまで ADR-029 / ADR-031 は `提案` のまま |

---

## ブランチ運用と自律ループ

詳細は `docs/workflow.md`。**AI がループで開発することを前提にした運用**であり、
人が1コマンドずつ見ていないことが以下すべての理由である。

**トランクベース開発。`main` が唯一の幹。**

- 作業ブランチ1本 = 1 PR = 1タスク。**寿命に上限は設けない。** `develop` / `release/*` は作らない
- 種別は変更の内容で選ぶ（`feat/` `fix/` `docs/` …）。**機能追加のブランチに限る運用ではない**
- `<type>/<slug>` で切り、**squash merge** で入れる
- **ブランチ名は名前だけで「何をする枝か」読めること。** `claude` を含めない（枝は「誰が書いたか」
  ではなく「何をする枝か」を表す）。生成された識別子（`from-2d5wji`）を入れない。
  タスクの番号だけ（`feat/b-08`）にしない — 3文字以上の英字の語が1つ以上要る。
  `guard.mjs`（枝を切る・改名する）と `.githooks/pre-push`（push する）の2枚が機械的に断る。
  **web のセッションでハーネスが割り当てる `claude/…` の枝の扱いは上の「Claude Code on the web で作業するとき」**
- **`main` への直接 push は禁止。** `.claude/hooks/guard.mjs`（エージェント）と
  `.githooks/pre-push`（git）の2枚で止める。**GitHub のブランチ保護は private + 現行プランでは
  効かない**ため、この2枚が実質の防御であり、どちらも越えられることを前提にする
- **`upstream` への push は禁止。** 同じ2枚に `no_push` を足した3枚で止める（上の「位置づけ」）
- 未完成の機能も**マージを止めない。** 画面に出せない段階でも `main` に入れる
- **feature flag は置かない。** 本番の配信先がまだ無く、未完成を隠して見せない相手が居ない。
  隠す仕組みを置くと、それ自体の保守（消し忘れ・畳み込み・lint での縛り）が仕事になる。
  **未完成の画面はそのまま出してよい** — `pnpm dev` で見えることは、むしろ確かめる助けになる。
  **本番へ配信する日が来たらこの規則を見直す** — そのとき改めて ADR を起こして決める

**完了の定義は `pnpm verify` と `pnpm test:db` の両方が緑になること。** PR を出す条件であり、マージの条件でもある。
**テストを skip・無効化して緑にしない。**

**実装の前に設計書を書く。** `design-writer` が backlog のタスク1件を `z-ai/design/<ID>.md` に落とし、
実装の3段はそれを入力に取る。**設計書にテストケースの一覧は書かない** — 洗い出しは `test-designer` の仕事。

**実装はテストから作る。** `/tdd` が1件ぶんの `test-designer`（洗い出し）→ `test-writer`（赤）→
`implementer`（緑）を回す。方針は `docs/testing.md` — **古典派**をとり、単体テストでは
**観察可能な振る舞い**だけを検証する（`vi.fn()` で呼び出し回数を数えない）。
リファクタリング耐性と実行の速さは、そこに書かれた制約で担保する。

**ループの1周は `/next`。** 入力は `docs/backlog.md`、出力は PR。以下に当たったら
**進めずに止まり、ドラフト PR を push して、何が決まれば進むかを1つの質問にして終える。**

- 確定事項 C-1〜C-16 を破る必要が出た
- 未決事項の決定が必要になった
- FR / NFR に無い機能が必要になった
- 依存パッケージの追加が必要になった
- 同じ検証失敗を2回直せなかった
- `implementer` が「テストが仕様として誤っている」と報告した

黙って止まらない。黙って進めない。

## 技術スタック

| 領域 | 採用 | 根拠 |
| --- | --- | --- |
| フロントエンド | React 19 + Vite 8（SPA・PWA） | ADR-014。Next.js は**採用しない** — サーバアクション類が ADR-003 と衝突するため |
| サーバサイド | Hono on Cloudflare Workers | ADR-015。ドメイン層とユースケース層はここに置かれる |
| DB・認証 | Supabase（Postgres + Auth）。**DB アクセスは Drizzle**（`drizzle-orm` + `postgres`）。**supabase-js は使わない** | ADR-029（ADR-020 を置き換え） |
| LLM | **未決** | ADR-019 |
| 検証 | Vitest 5 / ESLint 10 + typescript-eslint / dependency-cruiser / Prettier | `docs/testing.md` / `docs/workflow.md` 2章 |

実装上の必須事項:

- **Supabase の Postgres には `authenticated` ロールで繋ぐ。`service_role` キーと、表の所有者ロールの接続文字列を使わない。** どちらも RLS を迂回してしまい、Supabase を選んだ理由（世帯分離の安全網）が消える。
- **1リクエスト1トランザクションとし、その中で `set local role` と `set local request.jwt.claims` を張る。`local` を落とさない。** 接続プーラは接続を貸し回すため、セッションに残した設定は他人のリクエストに漏れる。**クレームを張り忘れた問い合わせは0行になる**（他世帯が見えるのではない）。実装は `contexts/pantry/infrastructure/db/HouseholdTransaction.ts`（`shared/` への移動は B-17）。
- **受け取った JWT はサーバ側で検証してからクレームに張る。** PostgREST を通らなくなったため、署名と有効期限の検証はアプリの責務である。検証せずに `sub` を張ることは、任意の世帯になりすませることと同じ（ADR-029 の結果2）。実装は `contexts/identity/infrastructure/HouseholdAuthenticatorImpl.ts`。
- **Workers から Postgres へ直接繋ぐ形になったため、接続経路（Hyperdrive の要否）を実装初期に確かめる**（ADR-029 の結果3 / B-07f。**このコンテナでは確かめられない**）。
- **LLM の API キーはクライアントに置かない。** 生成の呼び出しは必ずサーバ経由（NFR-10）。
- **Workers の実行時間・CPU 制限に LLM 呼び出しが収まるか、実装初期に確認する。** 収まらなければストリーミングか非同期化に切り替える。

## ディレクトリ構成

```
.claude/                   エージェントの作業環境
  settings.json            許可・拒否とフックの登録（settings.local.json は各自のもので git 管理外）
  hooks/guard.mjs          戻せない操作・main と upstream への push の拒否。guard.test.mjs が回帰テスト
  hooks/session-start.sh   web セッション開始時の pnpm install・ローカル Postgres の起動・コミット作者とメッセージ形式の設定
  commands/                /next（ループ1周）/tdd（テスト駆動で1件）/verify /sync /address
  agents/design-writer     タスク1件を設計書に落とす。実装の3段はこれを入力に取る
  agents/test-designer     観察可能な振る舞いを洗い出し、テストケース一覧を作る
  agents/test-writer       一覧をテストにし、落ちること（赤）を確認する
  agents/implementer       テストを変えずに緑にする
  agents/design-reviewer   差分を設計文書と突き合わせる読み手
.githooks/pre-push         main と upstream への push を git の側で止める（要 core.hooksPath）。pre-push.test.mjs が回帰テスト
.github/workflows/ci.yml   PR と main への push で pnpm verify と pnpm test:db を別ジョブで回す
.github/workflows/cleanup-assigned-branches.yml  web セッションが残す claude/* の枝を毎日掃除する
apps/web/                  React + Vite（PWA）— API のクライアント
  src/features/pantry/     画面もコンテキスト単位で切る（PantryList / PantrySections / RemainingDays）
  src/features/meal/
  test/                    画面ロジックの単体テスト
apps/api/                  Hono on Cloudflare Workers
  src/contexts/meal/       ← コアドメイン
    domain/
      entity/  value/  service/  repository/«if»  port/«if»  error/
    usecase/
    infrastructure/        ← 腐敗防止層はここ
    api/
  src/contexts/pantry/     同じ5つのディレクトリ。infrastructure/db/ に Drizzle の schema とトランザクション helper
  src/contexts/catalog/
  src/contexts/identity/
  src/shared/domain/
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
docs/                      設計文書。正は Markdown、html/ は追いついていない
```

「ドメイン」が2つの意味で使われる点に注意。**業務領域としてのドメイン**（献立・在庫）は `contexts/meal/` — コンテキストの単位。**層としてのドメイン層**は `contexts/meal/domain/`。

## コマンド

前提: **Node 22 以上**と **pnpm 10**（`packageManager` フィールドがあるので corepack が版を合わせる）。初回は `pnpm install`。

```
pnpm verify       # 完了の定義の片方。**Docker を要さない**。format:check → lint → typecheck → test → test:hooks → build
pnpm test:db      # もう片方。ローカル Postgres に対する RLS とリポジトリ実装のテスト
pnpm db:up        # その相手を Docker で立てる
pnpm db:up:native # Docker が使えないときはこちら（素の PostgreSQL。ADR-030）。エージェントのコンテナはこれ
pnpm dev          # web (:5173) と api (:8787) を同時起動
pnpm test         # vitest。ドメイン層とユースケース層のテスト
pnpm test:hooks   # guard.mjs と pre-push の回帰テスト（node --test）
pnpm typecheck    # tsc --build。全ワークスペース（テストの tsconfig も含む）
pnpm lint         # lint:code と lint:deps の両方
pnpm build        # contract → apps の順にビルド
pnpm format       # prettier。docs/ と tools/ は対象外
```

**`pnpm verify` と `pnpm test:db` が緑にならないものを PR にしない。** CI（`.github/workflows/ci.yml`）が
PR と `main` への push で同じものを走らせる。

**`pnpm lint` は2つに分かれる。**

| コマンド | 中身 |
| --- | --- |
| `pnpm lint:code` | ESLint。型の指摘に加えて、**禁止語（`Recipe` / `Menu` 等）を識別子に書くとエラーにする** |
| `pnpm lint:deps` | dependency-cruiser。**上の依存ルールの表を機械的に検査する** |

依存ルールは `.dependency-cruiser.cjs` にあり、**この文書の表と1対1で対応している。**
表を変えたらそちらも変えること。**規則を緩めて表を放置しない。**

**ワークスペースの package は `exports` に `source` 条件を持つ**（`packages/contract/package.json`）。
`lint:deps` はこれでソースを解決する。ビルド成果物を経由すると2つ壊れる — `dist` の無いクローン
（CI）では `lint` が `build` より先に走るため「存在しないモジュール」で落ち、`dist` があるときは
`exclude` に当たって**辺がグラフから消え、規則が当たらないまま緑になる**。
**新しい package を足すときも `source` を書く。**

個別のワークスペースだけ動かすとき:

```
pnpm --filter @fridge-to-meal/api dev      # wrangler dev
pnpm --filter @fridge-to-meal/web dev      # vite
pnpm --filter @fridge-to-meal/web build
```

### 環境変数

`apps/api/.dev.vars`（gitignore 済み）に置く。**クライアント側には置かない。**

```
DATABASE_URL=...          # Postgres への接続。authenticated に切り替えられる非所有者ロール
SUPABASE_URL=...          # 認証（Supabase Auth）用。DB アクセスには使わない
SUPABASE_ANON_KEY=...     # 同上
SUPABASE_JWT_SECRET=...   # 受け取った JWT の検証に使う（共有秘密 HS256 を前提とする。ADR-031 `提案`。実環境の署名方式は B-07f で確かめる）
```

**`service_role` キーと、表の所有者ロールの接続文字列を使わない**（どちらも RLS を迂回する）。**`DATABASE_URL` は秘密である** — クライアントにも `apps/web` のビルド環境にも置かない。**LLM の API キーもサーバ側だけ**（NFR-10）。

**ローカル Postgres の接続先は秘密でない**ため `.dev.vars` に置かず、`docker-compose.yml` と CI から渡す
（`apps/api/test/support/db/ConnectionStrings.ts` が 127.0.0.1:55432 を固定で持つ）。

## 作業の進め方

- **着手するタスクは `docs/backlog.md` から取る。** ここに無いものを勝手に始めない。
  必要になったら、まず backlog に行を足す提案をする。
- **実装を始める前に、対象コンテキストの `docs/domain-model.md` の該当集約と不変条件を読む。**
  そして**実物を見る** — 上の「実装の現在地」は要約であり、`apps/api/src/` と `apps/api/test/` が正。
- **アーキテクチャ上の判断を変える必要が出たら、`docs/adr.md` に新しい ADR を追記して提案する。** 既存の ADR は書き換えず、状態を「置き換え済み」に改める。
  **手順はそこで終わりではない** — 旧 ADR への参照を同じ周で掃除するところまでが1組である。**正は `docs/adr.md` の冒頭**（ここに写さない）。
  **エージェントが起こした ADR の状態は `提案`。`承認` に変えるのはユーザーだけ。**
- **要件にない機能を足さない。** `docs/requirements.md` の FR / NFR が範囲。
- ドメイン層とユースケース層は実行環境にもプロバイダにも依存しないため、**未決事項を待たずに着手できる。**
- 依存ルールと禁止語は lint が機械的に強制している（導入済み）。**緩めたくなったら、それは ADR の話。**
