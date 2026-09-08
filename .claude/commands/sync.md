---
description: "作業中の短命ブランチに main を取り込む"
---

# /sync — トランクを取り込む

短命ブランチの出発点が古くなったときに使う。トランクベース開発では、そもそも
**1日以内にマージすることで同期の必要を減らす**（`docs/workflow.md`）。
このコマンドを繰り返し使いたくなったら、それはブランチが長すぎるという合図である。

## 手順

1. 未コミットの変更があれば `git stash push` で退避する（何を退避したか報告する）
2. `git fetch origin main`
3. `git merge origin/main`（**自分以外が触りうるブランチで履歴を書き換えない**）
4. コンフリクトを解消する
   - `pnpm-lock.yaml` は手で直さず、`main` 側を採用して `pnpm install` で作り直す
   - **両側が同じロジックを変更していて、どちらを採っても挙動が変わる場合は止めて聞く**
5. 退避したものを戻す（`git stash pop`）
6. `pnpm verify`
7. 結果を報告する。コンフリクトがあった場合は、どのファイルでどう解消したかを添える

## 禁止

- `main` 上での作業（`main` への push はフックが拒否する）
- force push（積み直しが必要なら `--force-with-lease --force-if-includes`）
- `git reset --hard` による「やり直し」
