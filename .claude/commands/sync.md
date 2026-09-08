---
description: "作業中のブランチに main を取り込む"
---

# /sync — トランクを取り込む

作業中のブランチの出発点が古くなったときに使う。**取り込みは普通の作業であって、
ブランチが長すぎるという合図ではない**（`docs/workflow.md`）。未完成のまま
マージできるようにしてあるのは、まさにこの取り込みを小さく保つためである（ADR-024）。

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
