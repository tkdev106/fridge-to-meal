# 献立生成プロンプトの試行ツール

`docs/prompt-design.md` の第9章（試行）と第10章（費用の実測）を実行するためのもの。

> **これはアプリ本体ではない。** `apps/` の外に置いてあり、オニオンアーキテクチャの依存ルール（ADR-001）の対象外。
> プロンプトを固めてプロバイダを決める（ADR-019）ための使い捨ての道具である。
> **プロンプトの正は `docs/prompt-design.md`。** ここの `lib/prompt.mjs` は文書の写しであり、ずれたら直すのはこちら。

## 必要なもの

Node.js 18 以上（`fetch` を使う）。依存パッケージなし。`npm install` は不要。

API キーは環境変数から読む。使うプロバイダのぶんだけあればよい。

```
ANTHROPIC_API_KEY / GOOGLE_API_KEY / OPENAI_API_KEY
```

## まず動作を確かめる（API キー不要）

```sh
node tools/prompt-trial/run.mjs --self-test              # 検証規則が壊れていないか
node tools/prompt-trial/run.mjs --dry-run                # 全パターンのプロンプトを表示
node tools/prompt-trial/run.mjs --dry-run --patterns P-5 # 1つだけ
```

## 入力トークンの実測（第10章）

生成せずに測るので、費用はほぼかからない。

```sh
node tools/prompt-trial/run.mjs --count-tokens --model claude-opus-5
```

## 試行（第9章）

```sh
# 設計上の推奨: 7パターン × 3回
node tools/prompt-trial/run.mjs --provider anthropic --model claude-opus-5 --runs 3

# 避けたい献立の件数を振って Q-6 を決める
node tools/prompt-trial/run.mjs --patterns P-5 --avoid 0  --runs 3
node tools/prompt-trial/run.mjs --patterns P-5 --avoid 20 --runs 3
node tools/prompt-trial/run.mjs --patterns P-5 --avoid 50 --runs 3

# 構造化出力の有無で比べる（ADR-019 の比較軸1）
node tools/prompt-trial/run.mjs --patterns P-1 --runs 3
node tools/prompt-trial/run.mjs --patterns P-1 --runs 3 --structured

# 他のプロバイダに同じプロンプトを投げる
node tools/prompt-trial/run.mjs --provider google --model gemini-2.5-flash --runs 3
node tools/prompt-trial/run.mjs --provider openai --model gpt-5.6-luna    --runs 3
```

結果は `tools/prompt-trial/runs/<日時>_<プロバイダ>_<モデル>/` に出る。

| ファイル | 中身 |
| --- | --- |
| `summary.md` | 第9.3章の記録様式の表 |
| `results.json` | 全試行の構造化データ |
| `raw/<パターン>_<回>.json` | 応答の生データを含む1件分 |

**生の応答は必ず残る。** 後からプロバイダを比べるとき、要約した数値だけでは判断できないため。

## 自動で測るもの・測らないもの

`lib/score.mjs` が測るのは第9.2章のうち機械的に判定できるものだけ。

| 測る | 測らない（人が見る） |
| --- | --- |
| 検証通過率、材料名の完全一致率、表記ゆれの疑い、種別の倒し込み回数、調味料の件数（うち固定リスト外）、期限の遵守、調理法の分散、不足材料の件数、名称が完全一致した重複、トークン、応答時間、費用 | **意味的な重複**（表記の違う同じ献立）、**「今日これを作るか」と思えるか**、**リストにない調味料が正しく `seasoning` になっているか** |

「表記ゆれの疑い」は、在庫の名称と完全一致しないが部分一致する主材料の件数。**D-3 が崩れた兆候**であり、P-7 で効く。

「種別の倒し込み」は、固定リストに載る調味料が `main` と申告され、検証側で `seasoning` に倒された件数（D-1 の保険が働いた回数）。**多いなら規則5の書き方を疑う。**

「調味料(うちリスト外)」の括弧の中が、**ADR-023 の利点がそのまま出ている数**である。ここが0のままなら、固定リストで足りていたことになる。

## プロバイダごとの注意

| プロバイダ | 注意 |
| --- | --- |
| anthropic | **Claude Opus 5 / Sonnet 5 は `temperature` を受け付けない**（400 になる）。`--temperature` は無視される。多様性は避けたい献立の一覧で作る |
| anthropic | `--effort` の既定は `low`。生成は難しい仕事ではないので、既定を上げると出力トークンと費用が増える |
| google | `responseSchema` は OpenAPI 由来のため `additionalProperties` を落として送っている |
| openai | `--structured` は `response_format: json_schema` の strict モードを使う |

公式 SDK ではなく素の HTTP を使っているのは、**3社を同じ形で比べるため**と、このリポジトリにまだ `package.json` がないため。アプリ本体（`apps/api`）は各社の公式 SDK を使ってよい。

## 単価

`lib/pricing.mjs` に、実際に試すモデルの公式単価を**自分で入れてから**使う。未登録のモデルは `summary.md` の円の欄が「-」になるだけで、試行そのものは動く。
