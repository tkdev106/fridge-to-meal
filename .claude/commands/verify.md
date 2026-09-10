---
description: "pnpm verify（と test:db）を走らせ、落ちた層だけを報告する"
---

# /verify — 完了の定義を機械的に確認する

```
pnpm verify
```

`format:check` → `lint`（ESLint + dependency-cruiser）→ `typecheck` → `test` → `test:hooks` → `build`
の順に走る。**Docker を要さない。**

**完了の定義はもう1本ある** — `pnpm test:db`（ローカル Postgres に対するテスト。先に
`pnpm db:up`、Docker が使えなければ **`pnpm db:up:native`** が要る。ADR-030）。
**両方が緑であることが** PR を出す条件であり、マージの条件になる（`docs/workflow.md` 2章）。
**どちらでも相手を立てられないときに限り、CI の結果をもって判断する。緑を装わない**
（ADR-029 の結果6）。**ローカルは 16、CI は 17。正は CI である**（ADR-030 の結果1）。

## 報告の形式

```
| 層 | 結果 |
| --- | --- |
| lint:code / lint:deps | ✅ / ❌ |
| typecheck | ✅ / ❌ |
| test | ✅ / ❌ |
| test:hooks | ✅ / ❌ |
| build | ✅ / ❌ |
```

落ちた層については、**エラーの出力そのもの**と、原因の判断を添える。緑なら1行でよい。

## 直すときの制約

- **テストを skip・無効化・削除して緑にしない。** 落ちたテストは直すか、直せない理由を報告する
- `lint:deps` が落ちたら、**まず `docs/adr.md` A章の表を読む。** 規則を緩めて表を放置しない
  （`.dependency-cruiser.cjs` と表は1対1で対応している）
- `lint:code` の禁止語エラーは、設定の除外ではなく**語の言い換え**で直す（`docs/domain-model.md` 第3章）
- 同じ失敗を2回直せなかったら止めて報告する
