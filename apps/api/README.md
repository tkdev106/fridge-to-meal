# @fridge-to-meal/api

Hono on Cloudflare Workers。ドメイン層とユースケース層はここに置かれる（ADR-015）。
ディレクトリの意味は `src/README.md`。

## TypeScript のプロジェクト構成

型検査の単位が2つに分かれている。

| ファイル | 対象 | 出力先 |
| --- | --- | --- |
| `tsconfig.json` | `src/**` | `dist/` |
| `tsconfig.test.json` | `test/**` | `dist-test/`（git 管理外） |

**分けているのは、本体の `rootDir` を `src` に固定するためである。** ここに `test/**` を
足すと `rootDir` が `.` に上がり、`dist/` の中に `src/` と `test/` が並ぶ形に変わる。

どちらもルートの `tsconfig.json` から参照しており、**`pnpm typecheck` は両方を検査する。**
テストだけを検査したいときは `pnpm exec tsc --build apps/api/tsconfig.test.json`。

### 効いていることの確かめ方

テストの型検査が外れていても、テストは通ってしまう（vitest は型を見ない）。壊れたことに
気づけるよう、確かめ方を残しておく。

```
# ブランド型を要求する引数に、生の文字列を渡してみる
#   amount: amountOf('2本')  →  amount: '2本'
pnpm typecheck
# error TS2322: Type 'string' is not assignable to type 'Amount'. が出れば効いている
```

出力は emit される。**型検査だけを目的にしているが、composite なプロジェクトは emit を
止められない**ためで、`dist-test/` の中身に意味はない。
