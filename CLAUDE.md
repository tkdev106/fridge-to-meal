# fridge-to-meal

冷蔵庫の在庫を登録し、その在庫で作れる献立を提案する個人向け Web アプリ。
目的は「今日何作ろう」を考える手間をなくすこと。**在庫管理は手段であって目的ではない。**

> **現状: 設計フェーズ。実装コードはまだ1行も存在しない。**

## 迷ったらここを見る

| 知りたいこと | ファイル |
| --- | --- |
| 何を作るか（機能要件・非機能要件・コスト設計） | `docs/requirements.md` |
| どう表現するか（ドメインモデル・用語・不変条件・確定事項） | `docs/domain-model.md` |
| なぜその作りなのか（アーキテクチャ決定 ADR-001〜024） | `docs/adr.md` |
| LLM に何を渡し何を受け取るか（プロンプト全文・応答の検証規則） | `docs/prompt-design.md` |
| 画面に何をどう出すか（遷移・状態・再利用の見せ方） | `docs/screen-design.md` |
| どう進めるか（ブランチ運用・完了の定義・自律ループ） | `docs/workflow.md` |
| 次に何をやるか（ループの入力になるタスク一覧） | `docs/backlog.md` |

`docs/html/` は同じ内容の閲覧用 HTML。**正は Markdown。HTML だけを直さないこと。**

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
| 在庫スナップショット | `PantrySnapshot` | 生成時点の在庫の複製。以後不変 |
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

守るべき具体的なこと:

- **`usecase/` は `domain/` の兄弟であって、下ではない。** `contexts/meal/usecase/` が正しく、`contexts/meal/domain/usecase/` は誤り。
- **ユースケースの引数と戻り値にフレームワーク由来の型を入れない。** `Request` / `Response` / `Context` が1つでも現れたら、その層は Web に固定される（ADR-003）。DTO だけを受け渡す。
- **`new DbMealRepository()` を書いてよいのは `apps/api/src/main.ts` だけ。** 他所で実装クラスを直接生成しない。
- **ドメイン層に LLM・プロンプト・JSON・モデル名・SQL という語を出さない。** 外部との変換は `infrastructure/` の腐敗防止層が担う（ADR-005）。
- **`householdId` はリポジトリの全メソッドで必須引数。** 世帯をまたぐ取得を型として不可能にする（C-9）。

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

---

## ブランチ運用と自律ループ

詳細は `docs/workflow.md`。**AI がループで開発することを前提にした運用**であり、
人が1コマンドずつ見ていないことが以下すべての理由である。

**トランクベース開発。`main` が唯一の幹。**

- 作業ブランチ1本 = 1 PR = 1タスク。**寿命に上限は設けない。** `develop` / `release/*` は作らない
- 種別は変更の内容で選ぶ（`feat/` `fix/` `docs/` …）。**機能追加のブランチに限る運用ではない**
- `<type>/<slug>` で切り、**squash merge** で入れる。マージしたら枝を消す
- **`main` への直接 push は禁止。** `.claude/hooks/guard.mjs`（エージェント）と
  `.githooks/pre-push`（git）の2枚で止める。**GitHub のブランチ保護は private + 現行プランでは
  効かない**ため、この2枚が実質の防御であり、どちらも越えられることを前提にする
- 未完成の機能も**マージを止めない。** 画面に出すかどうかだけを feature flag で制御する（ADR-024）。
  既定は無効、読み出しは `apps/web/src/features.ts` の1か所、分岐はプレゼンテーション層のみ

**完了の定義は `pnpm verify` が緑になること。** PR を出す条件であり、マージの条件でもある。
**テストを skip・無効化して緑にしない。**

**ループの1周は `/next`。** 入力は `docs/backlog.md`、出力は PR。以下に当たったら
**進めずに止まり、ドラフト PR を push して、何が決まれば進むかを1つの質問にして終える。**

- 確定事項 C-1〜C-16 を破る必要が出た
- 未決事項の決定が必要になった
- FR / NFR に無い機能が必要になった
- 依存パッケージの追加が必要になった
- 同じ検証失敗を2回直せなかった

黙って止まらない。黙って進めない。

## 技術スタック

| 領域 | 採用 | 根拠 |
| --- | --- | --- |
| フロントエンド | React + Vite（SPA・PWA） | ADR-014。Next.js は**採用しない** — サーバアクション類が ADR-003 と衝突するため |
| サーバサイド | Hono on Cloudflare Workers | ADR-015。ドメイン層とユースケース層はここに置かれる |
| DB・認証 | Supabase（Postgres + Auth） | ADR-020 |
| LLM | **未決** | ADR-019 |

実装上の必須事項:

- **Supabase には利用者の JWT で問い合わせる。`service_role` キーを使わない。** RLS を迂回してしまい、Supabase を選んだ理由（世帯分離の安全網）が消える。
- **Workers から Supabase へは supabase-js（HTTP 経由）で接続する。** Postgres への直接 TCP 接続はエッジ実行と相性が悪い。
- **LLM の API キーはクライアントに置かない。** 生成の呼び出しは必ずサーバ経由（NFR-10）。
- **Workers の実行時間・CPU 制限に LLM 呼び出しが収まるか、実装初期に確認する。** 収まらなければストリーミングか非同期化に切り替える。

## ディレクトリ構成

```
.claude/                   エージェントの作業環境
  settings.json            許可・拒否とフックの登録（settings.local.json は各自のもので git 管理外）
  hooks/guard.mjs          戻せない操作の拒否。guard.test.mjs が回帰テスト
  hooks/session-start.sh   web セッション開始時の pnpm install
  commands/                /next（ループ1周）/verify /sync /address
  agents/design-writer     タスク1件を実装できる設計書に落とす書き手
  agents/design-reviewer   差分を設計文書と突き合わせる読み手
.githooks/pre-push         main への push を git の側で止める（要 core.hooksPath）
apps/web/                  React + Vite（PWA）— API のクライアント
  src/features/meal/       画面もコンテキスト単位で切る
  src/features/pantry/
apps/api/                  Hono on Cloudflare Workers
  src/contexts/meal/       ← コアドメイン
    domain/
      entity/  value/  service/  repository/«if»  port/«if»  error/
    usecase/
    infrastructure/        ← 腐敗防止層はここ
    api/
  src/contexts/pantry/     同じ5つのディレクトリ
  src/contexts/catalog/
  src/contexts/identity/
  src/shared/domain/
  src/main.ts              composition root
packages/contract/         API の型定義。web と api で共有
```

「ドメイン」が2つの意味で使われる点に注意。**業務領域としてのドメイン**（献立・在庫）は `contexts/meal/` — コンテキストの単位。**層としてのドメイン層**は `contexts/meal/domain/`。

## コマンド

前提: **Node 22 以上**と **pnpm**。初回は `pnpm install`。

```
pnpm verify       # 完了の定義。lint → typecheck → test → test:hooks → build
pnpm dev          # web (:5173) と api (:8787) を同時起動
pnpm test         # vitest。ドメイン層とユースケース層のテスト
pnpm test:hooks   # .claude/hooks のガードの回帰テスト（node --test）
pnpm typecheck    # tsc --build。全ワークスペース
pnpm lint         # lint:code と lint:deps の両方
pnpm build        # contract → apps の順にビルド
pnpm format       # prettier。docs/ と tools/ は対象外
```

**`pnpm verify` が緑にならないものを PR にしない。** CI（`.github/workflows/ci.yml`）が
PR と `main` への push で同じものを走らせる。

**`pnpm lint` は2つに分かれる。**

| コマンド | 中身 |
| --- | --- |
| `pnpm lint:code` | ESLint。型の指摘に加えて、**禁止語（`Recipe` / `Menu` 等）を識別子に書くとエラーにする** |
| `pnpm lint:deps` | dependency-cruiser。**上の依存ルールの表を機械的に検査する** |

依存ルールは `.dependency-cruiser.cjs` にあり、**この文書の表と1対1で対応している。**
表を変えたらそちらも変えること。**規則を緩めて表を放置しない。**

個別のワークスペースだけ動かすとき:

```
pnpm --filter @fridge-to-meal/api dev      # wrangler dev
pnpm --filter @fridge-to-meal/web dev      # vite
pnpm --filter @fridge-to-meal/web build
```

### 環境変数

`apps/api/.dev.vars`（gitignore 済み）に置く。**クライアント側には置かない。**

```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

**`service_role` キーは使わない**（RLS を迂回する）。**LLM の API キーもサーバ側だけ**（NFR-10）。

## 作業の進め方

- **着手するタスクは `docs/backlog.md` から取る。** ここに無いものを勝手に始めない。
  必要になったら、まず backlog に行を足す提案をする。
- **実装を始める前に、対象コンテキストの `docs/domain-model.md` の該当集約と不変条件を読む。**
- **アーキテクチャ上の判断を変える必要が出たら、`docs/adr.md` に新しい ADR を追記して提案する。** 既存の ADR は書き換えず、状態を「置き換え済み」に改める。
  **エージェントが起こした ADR の状態は `提案`。`承認` に変えるのはユーザーだけ。**
- **要件にない機能を足さない。** `docs/requirements.md` の FR / NFR が範囲。
- ドメイン層とユースケース層は実行環境にもプロバイダにも依存しないため、**未決事項を待たずに着手できる。**
- 依存ルールは lint での機械的な強制を推奨（ESLint の import 制限 / dependency-cruiser）。セットアップ時に導入すること。
