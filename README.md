# fridge-to-meal

冷蔵庫の在庫を登録し、**その在庫で作れる献立を提案する**個人向け Web アプリ。

平日の夕方に「今日何作ろう」を考えるのが面倒くさい — この一点を解消することが目的です。
レシピサイトは「作りたい料理」から探す作りになっていて、「今あるもので何が作れるか」の方向には向いていません。

> **現状（2026-09-13）: 実装フェーズ。** 要件定義・ドメインモデル・アーキテクチャ決定（ADR-001〜045）は済み。
> 在庫（pantry）コンテキストはドメイン層から API 層まで縦に一本通っていますが、composition root への結線と
> 画面からの取得はこれから。何がどこまであるかは [`CLAUDE.md`](CLAUDE.md) の「実装の現在地」、
> 次にやることは [`docs/backlog.md`](docs/backlog.md) を見てください。

## このリポジトリについて

このリポジトリ（`tatsuro-kawakami-lvgs/fridge-to-meal`、private）は、public の
[`tkdev106/fridge-to-meal`](https://github.com/tkdev106/fridge-to-meal) を履歴ごと複製した**非公開の開発用コピー**です。

| リモート | 役割 |
| --- | --- |
| `origin` | 開発の場。push してよい唯一のリモート |
| `upstream` | 元の public リポジトリ。**読み取り専用。push しない** — ローカル設定・エージェントのガード・git フックの3枚で止めています |

upstream からの取り込みは人が手で行い、public への反映方法は未決です。詳細は [`CLAUDE.md`](CLAUDE.md) の「このリポジトリの位置づけ」。

## 特徴として設計しているもの

- **在庫を起点にした献立提案** — 期限が近い食材を優先して使う献立が上位に来る
- **提案した献立は残る** — 「以前見た献立」「つくった献立」として後から辿れる
- **手持ちの献立を先に使う** — 今日の在庫でそのまま作れる献立があれば、LLM を呼ばずにそれを提案する。使い続けるほど1回あたりの費用と待ち時間が下がる
- **PWA** — ホーム画面に追加して、台所ですぐ開ける

## ドキュメント

| 文書 | 内容 |
| --- | --- |
| [`docs/requirements.md`](docs/requirements.md) | 要件定義。何を作るか、何を作らないか |
| [`docs/domain-model.md`](docs/domain-model.md) | ドメインモデル。サブドメイン分類・ユビキタス言語・集約と不変条件 |
| [`docs/adr.md`](docs/adr.md) | アーキテクチャ決定録。ADR-001〜045 |
| [`docs/prompt-design.md`](docs/prompt-design.md) | 献立生成のプロンプト設計。ポートの契約・プロンプト全文・応答の検証規則・試行の設計 |
| [`docs/screen-design.md`](docs/screen-design.md) | 画面設計。画面遷移・各画面の状態・再利用の見せ方 |
| [`docs/testing.md`](docs/testing.md) | テスト方針。古典派・観察可能な振る舞い・TDD の1周 |
| [`docs/workflow.md`](docs/workflow.md) | 開発ワークフロー。ブランチ運用・完了の定義・自律ループ |
| [`docs/backlog.md`](docs/backlog.md) | 次にやることの一覧。自律ループの入力 |

`docs/html/` に同じ内容の閲覧用 HTML がありますが、**Markdown に追いついていません**（backlog B-18）。**正は Markdown です。**

AI エージェントで作業する場合は [`CLAUDE.md`](CLAUDE.md) を参照してください。

## 技術スタック

| 領域 | 採用 |
| --- | --- |
| フロントエンド | React 19 + Vite 8（SPA・PWA） |
| サーバサイド | Hono on Cloudflare Workers |
| DB・認証 | Supabase（Postgres + Auth）。DB アクセスは Drizzle ORM（supabase-js は使わない） |
| LLM | 未決（プロンプト設計を固めてから比較して決める） |

## 動かす

Node 22 以上と pnpm 10 が要ります（`packageManager` フィールドがあるので corepack が版を合わせます）。

```sh
pnpm install

# clone 後に1度だけ（すべてローカル設定で git には入らない）
git remote add upstream https://github.com/tkdev106/fridge-to-meal.git   # 元リポジトリ（読み取り専用）
git remote set-url --push upstream no_push                                # 誤 push を物理的に不可能にする
git config user.name "tkdev106"                                           # コミットの作者を固定する
git config user.email "178723293+tkdev106@users.noreply.github.com"
git config commit.template .gitmessage                                    # コミットの形式
git config core.hooksPath .githooks                                       # main と upstream への push を止める

pnpm verify        # 完了の定義の片方。format:check → lint → typecheck → test → test:hooks → build
pnpm db:up         # ローカル Postgres を起こす（Docker）
pnpm db:up:native  # Docker が使えないときはこちら（素の PostgreSQL。ADR-030）
pnpm test:db       # もう片方。ローカル Postgres に対する RLS のテスト
pnpm dev           # web (:5173) と api (:8787)
pnpm test
pnpm lint          # 依存ルールと禁止語の検査を含む
pnpm typecheck
```

アーキテクチャはオニオン構成。コンテキストごとに垂直にディレクトリを切り、ドメイン層とインフラ層は依存関係逆転で結ぶ。
将来のネイティブアプリ化に備え、ユースケース層はプレゼンテーション層に依存しません。
層ごとの置き場所は [`apps/api/src/README.md`](apps/api/src/README.md)。

## これからやること

正は [`docs/backlog.md`](docs/backlog.md) です。ここはその見出しだけ。

1. **在庫の画面をつなぐ** — 登録画面（B-12）とサーバからの一覧取得（B-22）
2. **献立集約を置く** — `Meal`（B-14a）と作れる献立 `CookableMeal`（B-14b）、`MealGenerator` ポート（B-15）
3. **献立生成のプロンプトを試行する** — 設計は [`docs/prompt-design.md`](docs/prompt-design.md) に完了、道具は [`tools/prompt-trial/`](tools/prompt-trial/)。7つの在庫パターンでの試行・費用の実測・プロバイダ比較（ADR-019）が未実行
4. **起動時の画面をどれにするか決める** — [`docs/screen-design.md`](docs/screen-design.md) 論点1。判断待ち
