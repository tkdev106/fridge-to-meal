# fridge-to-meal

冷蔵庫の在庫を登録し、**その在庫で作れる献立を提案する**個人向け Web アプリ。

平日の夕方に「今日何作ろう」を考えるのが面倒くさい — この一点を解消することが目的です。
レシピサイトは「作りたい料理」から探す作りになっていて、「今あるもので何が作れるか」の方向には向いていません。

> **現状: 設計フェーズ。** 要件定義・ドメインモデル・アーキテクチャ決定まで完了し、実装はこれから。

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
| [`docs/adr.md`](docs/adr.md) | アーキテクチャ決定録。ADR-001〜024 |
| [`docs/prompt-design.md`](docs/prompt-design.md) | 献立生成のプロンプト設計。ポートの契約・プロンプト全文・応答の検証規則・試行の設計 |
| [`docs/screen-design.md`](docs/screen-design.md) | 画面設計。画面遷移・各画面の状態・再利用の見せ方 |
| [`docs/testing.md`](docs/testing.md) | テスト方針。古典派・観察可能な振る舞い・TDD の1周 |
| [`docs/workflow.md`](docs/workflow.md) | 開発ワークフロー。ブランチ運用・完了の定義・自律ループ |
| [`docs/backlog.md`](docs/backlog.md) | 次にやることの一覧。自律ループの入力 |

`docs/html/` に同じ内容の閲覧用 HTML があります（図が読みやすい版）。**正は Markdown です。**

AI エージェントで作業する場合は [`CLAUDE.md`](CLAUDE.md) を参照してください。

## 技術スタック

| 領域 | 採用 |
| --- | --- |
| フロントエンド | React + Vite（SPA・PWA） |
| サーバサイド | Hono on Cloudflare Workers |
| DB・認証 | Supabase（Postgres + Auth） |
| LLM | 未決（プロンプト設計を固めてから比較して決める） |

## 動かす

Node 22 以上と pnpm が要ります。

```sh
pnpm install
git config commit.template .gitmessage   # 1度だけ
git config core.hooksPath .githooks      # 1度だけ。main への push を止める
pnpm verify     # 完了の定義。lint → typecheck → test → test:hooks → build
pnpm dev        # web (:5173) と api (:8787)
pnpm test
pnpm lint       # 依存ルールと禁止語の検査を含む
pnpm typecheck
```

アーキテクチャはオニオン構成。コンテキストごとに垂直にディレクトリを切り、ドメイン層とインフラ層は依存関係逆転で結ぶ。
将来のネイティブアプリ化に備え、ユースケース層はプレゼンテーション層に依存しません。

## これからやること

1. **献立生成のプロンプト設計** — 設計は [`docs/prompt-design.md`](docs/prompt-design.md) に完了。試行ツールは [`tools/prompt-trial/`](tools/prompt-trial/)。残るのは実行:
   - 7つの在庫パターンでの試行（同書 第9章）
   - `count_tokens` による費用の実測（同書 第10章）
   - 同じプロンプトを投げての LLM プロバイダ比較（同書 第11章、ADR-019）
2. **主要画面のワイヤーフレーム作成** — [`docs/screen-design.md`](docs/screen-design.md) に一巡。起動時の画面をどれにするかだけ判断待ち
3. ~~開発環境のセットアップ~~ — 完了。コマンドは [`CLAUDE.md`](CLAUDE.md) のコマンド節
4. ドメイン層とユースケース層の実装着手 — 着手順は [`docs/backlog.md`](docs/backlog.md)
