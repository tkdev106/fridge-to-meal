# fridge-to-meal

冷蔵庫の在庫を登録し、**その在庫で作れる献立を提案する**個人向け Web アプリ。

平日の夕方に「今日何作ろう」を考えるのが面倒くさい — この一点を解消することが目的です。
レシピサイトは「作りたい料理」から探す作りになっていて、「今あるもので何が作れるか」の方向には向いていません。
在庫管理は手段であって目的ではありません。

## できること

- **在庫を登録する** — 食材名・分量・期限を入れる。食材名は以前入れた名前から補完される。行をなぞるか `…` から編集・削除できる
- **献立の提案を受ける** — 今の在庫から献立を最大3件出す。期限が近い食材を使う献立が上に来る
- **手持ちの献立を先に使う** — 今日の在庫でそのまま作れる献立が既にあれば、生成せずにそれを出す。使い続けるほど1回あたりの費用と待ち時間が下がる
- **新しい献立を求める** — 明示して頼んだときだけ AI（Gemini）が新しい献立を作る。画面を開いただけでは生成しない
- **献立の詳細を見る** — 材料ごとに今の在庫で足りるか、手順、注意表示を出す。「作った」を記録できる（在庫は自動で減らさない）
- **履歴を辿る** — 「以前見た献立」と「作った献立」を日ごとに見返せる
- **アカウント** — メールとパスワードで作成・ログインする。データは世帯ごとに分かれ、設定からアカウントとデータをまとめて消せる
- **PWA** — ホーム画面に追加して台所ですぐ開ける。オフラインの間は閲覧だけできる

画面は献立・冷蔵庫・履歴の3つのタブで、スマートフォンでは下のタブ、PC では左のサイドナビで切り替えます。

## 技術スタック

| 領域 | 採用 |
| --- | --- |
| フロントエンド | React 19 + Vite 8（SPA・PWA） |
| サーバサイド | Hono on Cloudflare Workers |
| DB・認証 | Supabase（Postgres + Auth）。DB アクセスは Drizzle ORM、Workers からは Hyperdrive 経由 |
| 献立の生成 | Gemini（`gemini-3.5-flash-lite`） |

アーキテクチャはオニオン構成です。コンテキスト（在庫・献立・世帯）ごとに垂直にディレクトリを切り、
ドメイン層とインフラ層は依存関係逆転で結びます。ユースケース層はプレゼンテーション層に依存しません。

## ドキュメント

| 文書 | 内容 |
| --- | --- |
| [`docs/requirements.md`](docs/requirements.md) | 要件定義。何を作るか、何を作らないか |
| [`docs/domain-model.md`](docs/domain-model.md) | ドメインモデル。ユビキタス言語・集約と不変条件 |
| [`docs/adr.md`](docs/adr.md) | アーキテクチャ決定録 |
| [`docs/architecture.md`](docs/architecture.md) | 技術スタック・ディレクトリ構成・環境変数 |
| [`docs/prompt-design.md`](docs/prompt-design.md) | 献立生成のプロンプト設計と応答の検証規則 |
| [`docs/screen-design.md`](docs/screen-design.md) / [`docs/design/`](docs/design/) | 画面設計と画面デザイン |
| [`docs/testing.md`](docs/testing.md) | テスト方針 |
| [`docs/workflow.md`](docs/workflow.md) | 開発ワークフロー |

## 動かす

Node 22 以上と pnpm 10 が要ります。clone 後に1度だけやる設定は [`docs/workflow.md`](docs/workflow.md) 7章、
環境変数は [`docs/architecture.md`](docs/architecture.md) にあります。

```sh
pnpm install
pnpm db:up         # ローカル Postgres を起こす（Docker が使えなければ pnpm db:up:native）
pnpm dev           # web (:5173) と api (:8787)
pnpm verify        # format:check → lint → typecheck → test → test:hooks → build
pnpm test:db       # ローカル Postgres に対する RLS とリポジトリ実装のテスト
```

AI エージェントで作業する場合は [`CLAUDE.md`](CLAUDE.md) を参照してください。
