---
description: "backlog の先頭タスクを1件だけ、作業ブランチ1本 + PR 1本で main に入れる（自律ループの1周）"
---

# /next — 自律ループの1周

`docs/backlog.md` の先頭タスクを**1件だけ**実装し、PR にして `main` に入れる。
1周で2件やらない。運用の根拠は `docs/workflow.md`。

引数がある場合はそれをタスクの指定として扱う（backlog の ID、または自然文）。

## 手順

1. **トランクと同期する**
   `git switch main && git pull --ff-only`
   未コミットの変更が残っていたら、そこで止めて何が残っているかを報告する。
2. **タスクを選ぶ**
   `docs/backlog.md` の「次にやること」から、依存が解決している最初の1件。
   「判断待ち」の行には着手しない。1 PR で説明できる大きさに収まらないなら、**実装ではなく
   backlog を分割する PR** を出す。それが今周の成果でよい。
3. **設計文書を先に読む**（実装より前）
   - `docs/domain-model.md` の該当集約・不変条件・第7章の確定事項
   - `docs/adr.md` の関連 ADR
   - 画面に触るなら `docs/screen-design.md`、生成に触るなら `docs/prompt-design.md`
4. **枝を切る**: `git switch -c <type>/<slug>`（type は Conventional Commits と揃える）
5. **テスト駆動で実装する: `/tdd` を呼ぶ。** `test-designer`（洗い出し）→ `test-writer`（赤）→
   `implementer`（緑）の3段。方針は `docs/testing.md`。**テストを先に書き、落ちることを
   確認してから実装に移る。** ドメイン層・ユースケース層は実 DB も実 API も使わない（ADR-002）。
   タスクが複数の振る舞いのかたまりに分かれるなら、**かたまりごとに1周**回す。
6. **実装で守るもの。** `CLAUDE.md` の4つの約束（用語表 / 依存の向き / C-1〜C-16 / 未決事項）。
   画面に出せない段階でもマージを止めない。**表示は feature flag で隠す**（ADR-024）。
   フラグを足したら、`docs/backlog.md` に**それを消すタスクを同時に足す**。
7. **`pnpm verify`** が緑になるまで直す。**同じ失敗を2回直せなかったら止める**（下記）。
   **テストを skip・無効化して緑にしない。**
8. **自己レビュー**: `git fetch origin main` の後、`design-reviewer` サブエージェントに
   `git diff origin/main...HEAD` を渡す（**ローカルの `main` は古いことがある**）。
   `/tdd` の中で済ませているなら、**その後に足した差分だけ**を対象にすればよい。
   指摘は直すか、直さない理由を PR に書く。
9. **コミット**: 入れるファイルを明示して stage し、`git diff --staged` からメッセージを書く。
   1コミット1目的。型を混ぜない。`.gitmessage` が形式。
10. **PR**: `git push -u origin <branch>` → `.github/PULL_REQUEST_TEMPLATE.md` に沿って作成。
11. **CI を待つ**（`gh pr checks --watch`）。赤なら直して push する。PR は開いたままでよい。
12. **squash merge** → `main` に戻る → `docs/backlog.md` の完了行を消す
    （次の周の最初のコミットに含めてよい）。

## 止まる条件

以下に当たったら**進めずに止まる**。そこまでの成果はドラフト PR として push し、
「何が決まれば進むか」を**1つの質問**にまとめて終える。

- 確定事項 C-1〜C-16 を破る必要が出た
- 未決事項の決定が必要になった（`docs/backlog.md` の「判断待ち」）
- `docs/requirements.md` の FR / NFR に無い機能が必要になった
- 依存パッケージの追加が必要になった
- 同じ検証失敗を2回直せなかった

黙って止まらない。黙って進めない。**要件にない機能を足さない。**
