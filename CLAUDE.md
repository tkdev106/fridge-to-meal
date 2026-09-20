# fridge-to-meal

冷蔵庫の在庫を登録し、その在庫で作れる献立を提案する個人向け Web アプリ。
目的は「今日何作ろう」を考える手間をなくすこと。**在庫管理は手段であって目的ではない。**

> **現状（2026-09-19）: 実装フェーズ。在庫（pantry）コンテキストの縦切りが domain → usecase →
> infrastructure → api → composition root（`apps/api/src/main.ts`）まで通っている。** 在庫の4経路と
> 世帯の認証器が結線され、Hyperdrive の binding も置かれた（B-09）。web はログインの門まで通り（B-35）、
> **在庫一覧をサーバから取れるようになった**（B-22。CORS と api の基点もここで決めた。ADR-048）。
> **画面からの登録もサーバへ届く**（B-24。断りの `rule` から画面の文言を選ぶのもここで決めた。ADR-032 決定3）。
> **行のスワイプで削除もできる**（B-23。ADR-027 が残した「404 をどう読むか」の宿題をここで決めた。ADR-050）。
> 実装の現在地は下の「実装の現在地」、次にやることは `docs/backlog.md`。

---

## Claude Code on the web で作業するとき

web のセッションは `claude/<slug>-<生成された識別子>` という枝を**ハーネスが割り当てて**始まる。
この名前は `docs/workflow.md` 1章の規則（`claude` を含めない・生成された識別子を入れない）に
反し、`guard.mjs` と `pre-push` がどちらも断る名前である。**両方を満たす進め方は次のとおり。**

- **PR は `<type>/<slug>` の枝から出す。** `/next` の手順どおり `git switch -c <type>/<slug>` で
  切り直し、そちらを `origin` に push して PR にする。割り当てられた `claude/…` の枝から PR を出さない
- 割り当てられた枝は、セッションの指示に従って成果を退避する先としてだけ使う。**PR の head ではないので
  マージ時の自動削除では消えない。** `.github/workflows/cleanup-assigned-branches.yml` が毎日、先端が
  7日より古く、開いている PR の無い `claude/*` を消す。エージェントが消す必要はない
- web のコンテナでは `core.hooksPath` を設定しない（設定すると割り当て枝への push が止まり、
  セッションが成果を出せなくなる）。`main` は `guard.mjs` が守る
- **コミットの作者は `tkdev106` に固定される**（メールは `178723293+tkdev106@users.noreply.github.com`）。
  `.claude/hooks/session-start.sh` がセッション開始のたびに入れ直す — **ローカルの git 設定はコンテナと
  一緒に消える**ため、1度きりの設定では足りない。**web に限った話ではない** — 手元の clone では
  `docs/workflow.md` 7章 の手順で1度だけ入れる
- web のコンテナには **`gh` が無い。** PR の作成・CI の結果の確認・squash merge は
  GitHub の MCP ツール（`mcp__github__*`）で行う。`/next` の手順にどちらの書き方も置いてある

## 迷ったらここを見る

| 知りたいこと | ファイル |
| --- | --- |
| 何を作るか（機能要件・非機能要件・コスト設計） | `docs/requirements.md` |
| どう表現するか（ドメインモデル・用語・不変条件・確定事項） | `docs/domain-model.md` |
| なぜその作りなのか（アーキテクチャ決定 ADR-001〜051） | `docs/adr.md` |
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
| `pantry`（在庫） | `StockItem` 集約、`Amount` / `ExpiryDate` / `IngredientId` / `StockItemId`、`StockItemRepository`«if»、`StockItemIdGenerator`«if» | `RegisterStockItem` / `ListStockItems` / `UpdateStockItem` / `DeleteStockItem`、`StockItemDto` | `StockItemRepositoryImpl`（Drizzle）、`db/schema.ts`、`db/HouseholdTransaction.ts`（`set local role` とクレーム） | `StockItemRoutes`、`RuleViolationStatus` | **縦に一本通り、`main.ts` で結線されている**（B-09）。4経路は接頭辞なしで根に置かれる（`POST /stock-items` 等） |
| `meal`（献立） | `Meal` / `Suggestion` 集約、`MealIngredient` / `MealCoverage` / `CookableMeal` / `Amount` / `CookingStep` / `CookingRecord` / `DateTime` / `MealId` / `StockItem` / `ExpiryDate` / `PantrySnapshot` / `SuggestionEntry` / `SuggestionId` / `GeneratedMeal`（value）、`MealCoverageService` / `CookableMealFinder`、`MealGenerator`«if» / `SuggestionIdGenerator`«if» / `MealIdGenerator`«if»、`MealRepository`«if» / `SuggestionRepository`«if»、`MealRuleViolation` | `SuggestMeals`（**再利用と生成の両方**）／ `SuggestNewMeals`（**FR-36 の明示操作**） | — | — | **提案の経路が一本通った。** 在庫が前回の提案から変わっていなければ保存済みの提案をそのまま返し（C-7）、変わっていれば作れる献立を C-11 で除いて上位3件を提案にする。**0件のときは `MealGenerator` を呼び、既存と同じ名称の生成結果は既存を参照する**（C-4）。**ただし期限切れを落とした在庫が2件に満たなければ呼ばず、在庫が足りない結末を返す**（S-4 / ADR-040 / ADR-041。結末は `outcome` で判別する戻り値）。**直近24時間の生成が10回に達している回も呼ばず、上限に達した結末を返す**（S-7 / NFR-C2 / ADR-049。数えるのは生成の由来を持つ保存済みの提案で、「1日」は遡る24時間の窓）。**`SuggestNewMeals` は FR-36 の明示操作の入口**（B-32 / ADR-050）— 再利用せず必ず生成を呼び、**C-7 の短絡も通らない**（根拠は FR-21「再生成は明示的な操作でのみ行う」）。**上書きするのはその2つだけで、在庫の下限も1日の上限もこの入口に当たる**（ADR-049 結果7）。本体は `SuggestMeals` と共有し、写しを作らない。**背後の腐敗防止層はプロバイダ待ち**（ADR-019）。在庫品と期限は献立側にも起こしてあり、在庫品は名称・分量・期限の3項目（ADR-036 / ADR-037） |
| `identity`（世帯） | `HouseholdAuthenticator`«if»、`IdentityRuleViolation` | `IdentifyHousehold` | `HouseholdAuthenticatorImpl`（**JWKS で ES256 を検証**。鍵は `kid` で引き、`alg` が設定と一致するものだけに絞る。**最初の検証で1度だけ取りに行って保持し、失敗した取得は捨てる**） | — | **実環境と噛み合った**（B-07f で実測、B-07g で実装。ADR-043）。**取得の失敗と設定の空は `IdentityRuleViolation` に包まない** — 包むと 401 に化け、サーバ側の不備を利用者のせいにする（ADR-045）。**`main.ts` で結線されている**（B-09）— 認証器は環境1つにつき1つで、要求ごとに作り直さない（ADR-043 結果2） |
| `catalog`（食材） | — | — | — | — | `.gitkeep` のみ。食材マスタの初期データが判断待ち |
| `shared/domain` | `HouseholdId` | | | | |

| 場所 | 現在地 |
| --- | --- |
| `apps/api/src/main.ts` | composition root。`createApp(deps)`（Hono の組み立て）/ `composeDependencies(env, ports)`（**実装クラスの `new` はこの関数の中だけ**）/ default export（Workers の入口。同じ `env` には同じ組み立てを返す）の3口。在庫のユースケースは1要求1トランザクションで包み、`StockItemRepositoryImpl` はトランザクションの中で生成する。`AccessTokenVerification` の3値は `SUPABASE_URL` から導く（`jwksUri` = `<url>/auth/v1/.well-known/jwks.json`、`issuer` = `<url>/auth/v1`、`audience` = `authenticated`）。**鍵が引けない・設定が空は 500 で 401 にならない**ことを `test/main.test.ts` が層をまたいで押さえる（ADR-045 結果4） |
| `apps/web/src/` | **`App.tsx` は門である**（B-35）— `Session.subscribe` の3値で「何も出さない／ログイン／今の画面」を出し分ける。`main.tsx` が `new SessionImpl(sessionConfigOf(import.meta.env))` と、在庫の2つの口（`listStockItems` / `registerStockItem`。基点とトークンの組は1つ）を**ここだけで**組み立て `App` に渡す。ログイン／サインアップの画面とログアウトは `features/identity/`（ログアウトの位置は暫定。ADR-046 結果4）。**在庫一覧はサーバから取る**（B-22）— `PantryList` は「読み込み中／取れた／取れなかった」の3値を受け取り、門が効果1つで取りに行く（サインイン済みのときだけ1度。自動で再試行しない）。**サーバへの継ぎ目は `server/`**（B-22 / B-24。`ApiBaseUrl` / `HttpFetch` / `StockItemRequests`）。**登録もここを通って `POST /stock-items` に届く**（B-24）— 結末は「通った／断られた（`rule` つき）／失敗」の3つで、**文言を選ぶ表は画面の側**（`features/pantry/RegisterFailureNotice.ts`。ADR-032 決定3）。登録が通ったら門が一覧を取り直す（web で列に足さない）。**削除は行のスワイプで届く**（B-23）— 判断は `SwipeGesture.ts`（向きは問わず、縦の動きのほうが大きければ読まない。依存は足していない）と `DeleteFailureNotice.ts`（**`delete.notFound` を「すでに消えている」と読み、案内を出さない**。ADR-027 の宿題を ADR-050 が引き取った）にあり、消えたと読めた回は門が一覧を取り直す（**取り直しがその読みの検めである**）。**`session/` にセッションの継ぎ目がある**（B-34。`Session` / `SessionConfig` / `SessionImpl`）。**コンポーネントは jsdom 上で描いて確かめられる**（ADR-052）— 道具の継ぎ目は `test/support/dom/` で、いま描いているのは `PantryList` だけである（残りは B-40）。手元で動かすには `apps/web/.env.local` に `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_API_BASE_URL` の3つが要る（無ければ起動時に `Error` で落ちる） |
| `packages/contract/src/` | `pantry.ts`（在庫 API の型）と `error.ts` |
| `supabase/migrations/` | `stock_items` 表と RLS。`meta/` は drizzle-kit の生成物 |
| `apps/api/test/` | 単体（`contexts/`）・契約（`contract/`）・DB（`db/`、`pnpm test:db`）・移行（`migrations/`）の4種。差し替え用の `Fixed*` / `InMemory*` は `test/support/` |
| `tools/prompt-trial/` | 献立生成プロンプトの試行ツール。**アプリ本体ではない。** 7パターンの試行と費用の実測は未実行 |

**識別子の流儀（ADR-039）:** **コード上の識別子はすべて英語。** export される名前も、ファイルの中だけで
使うローカルな変数・関数・型も英語で書く。**用語表にある概念は用語表の英語をそのまま使い、訳語を自分で
作らない**（`献立` → `meal`、`在庫スナップショット` → `pantrySnapshot`）。**禁止語は英語でも禁止。**

**コメントと doc は日本語のまま。** ADR 番号と確定事項を引いて設計の意図を記録しているのはこちらである。
**テストの `describe` は対象、`it` は振る舞いを日本語の文**で書く（`docs/testing.md` 6章）— 文字列であって
識別子ではない。

**移行は済んだ**（B-30a〜d）。`apps/api/src` / `apps/api/test` / `.claude/hooks/` / `apps/web` の
どこにも日本語の識別子は残っていない。**新しく書くコードもこの流儀に揃える** —
`packages/contract` と `tools/` はもともと英語だけである。

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
- **ドメイン層に LLM・プロンプト・JSON・モデル名・SQL を持ち込まない。** 禁じているのは**手段への依存**であって語そのものではない — 型・識別子・ロジックがそれらを知ってはならない。**設計の意図を記録するコメントに語が現れるのは可**（`pantry/domain/value/Amount.ts` が ADR-010 の理由を写している）。**上の「1. 用語表にない語をコードに書かない」の禁止語とは扱いが違う** — あちらは同義語の混在を断つためにコメントも含めて語そのものを禁じ、`pnpm lint:code` が機械的に検査する。外部との変換は `infrastructure/` の腐敗防止層が担う（ADR-005）。
- **`householdId` はリポジトリの全メソッドで必須引数。** 世帯をまたぐ取得を型として不可能にする（C-9）。
- **リポジトリの口が並び順を約束するのは、一部しか返さないときだけ。** 全件返す口は約束しない — 並べ替えはユースケース層の仕事で、画面の要求をリポジトリに焼き付けない（先行 `StockItemRepository.findByHousehold`）。**`limit` で絞る口は約束する** — どの行を取るかが順序で決まるため、順序を約束しない `limit` は意味を持たない（ADR-038）。
- **api 層は世帯と識別子の型をユースケースから導出し、規則違反は例外の `name` で見分ける**（ADR-032）。
- **`@supabase/*` を import してよいのは `apps/web/src/session/` だけ。** 画面（`features/` も `App.tsx` も `main.tsx` も）は継ぎ目の型だけを見る — ADR-046 結果1 が認めた「認証だけは web が Supabase を直接見る」という**例外の範囲を1ディレクトリに閉じる**（ADR-046 決定3）。在庫と献立は従来どおり API だけを通る。

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
| DB・認証 | Supabase（Postgres + Auth）。**DB アクセスは Drizzle**（`drizzle-orm` + `postgres`）。**サーバの DB アクセスに supabase-js は使わない** — この禁止は `apps/api` の問い合わせに限る（ADR-029 決定1 は「認証と Postgres そのものは Supabase のまま使う」と続けている） | ADR-029（ADR-020 を置き換え） |
| web のログイン | **`@supabase/supabase-js` を `apps/web` に置き、メールとパスワードでサインインする。** セッションは継ぎ目1つの背後に閉じ、**画面はライブラリの型を見ない。** **継ぎ目は `apps/web/src/session/` に置かれた**（B-34）。**画面（`features/identity/`）と結線（`main.tsx`）も置かれた**（B-35）。失敗の種別は分けておらず、画面の断りの文言は原因を断定しない | ADR-046 |
| Workers → Postgres の経路 | **Cloudflare Hyperdrive 経由。** origin は Supabase の直接接続（`db.<ref>.supabase.co:5432`）。Supavisor は使わない。**問い合わせキャッシュは切る** | ADR-042 / ADR-044 |
| アクセストークンの検証 | **JWKS（ES256）。** 共有秘密は使わない | ADR-043（ADR-031 を置き換え） |
| LLM | **未決** | ADR-019 |
| 検証 | Vitest 5 / ESLint 10 + typescript-eslint / dependency-cruiser / Prettier。**画面のコンポーネントは jsdom + `@testing-library/react` で描いて観察する**（既定の環境は `node` のまま。要る回だけ `// @vitest-environment jsdom` を宣言する） | `docs/testing.md` / `docs/workflow.md` 2章 / ADR-052 |

実装上の必須事項:

- **Supabase の Postgres には `authenticated` ロールで繋ぐ。`service_role` キーと、表の所有者ロールの接続文字列を使わない。** どちらも RLS を迂回してしまい、Supabase を選んだ理由（世帯分離の安全網）が消える。
- **1リクエスト1トランザクションとし、その中で `set local role` と `set local request.jwt.claims` を張る。`local` を落とさない。** 接続プーラは接続を貸し回すため、セッションに残した設定は他人のリクエストに漏れる。**クレームを張り忘れた問い合わせは0行になる**（他世帯が見えるのではない）。実装は `contexts/pantry/infrastructure/db/HouseholdTransaction.ts`（`shared/` への移動は B-17）。
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
apps/web/                  React + Vite（PWA）— API のクライアント
  src/session/             セッションの継ぎ目。**ここは画面ではない**（ADR-046 決定3）。@supabase/* を import してよい唯一の場所
  src/features/pantry/     画面もコンテキスト単位で切る（PantryList / PantrySections / RemainingDays）
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

`apps/api/.dev.vars`（gitignore 済み）に置く。**これはサーバ側の置き場である。**

```
SUPABASE_URL=...          # 認証（Supabase Auth）用。DB アクセスには使わない
SUPABASE_ANON_KEY=...     # 同上
```

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

**`service_role` キーと、表の所有者ロールの接続文字列を使わない**（どちらも RLS を迂回する。鍵の3分類は上の表）。**接続に使うロールは、表を持たない非所有者のログインロールを別に作る** — 実 Supabase の `postgres` は表の所有者であり、`authenticator` は PostgREST が使っているため、どちらも使わない（B-07f で確認）。

**ローカル Postgres の接続先は秘密でない**ため `.dev.vars` に置かず、`docker-compose.yml` と CI、
`apps/api/package.json` の `dev` スクリプトから渡す（`apps/api/test/support/db/ConnectionStrings.ts` が
127.0.0.1:55432 を固定で持つ）。

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
