# 開発ワークフロー

このリポジトリは **AI エージェントがループで自律的に開発を進める**ことを前提に運用する。
本書は「どう進めるか」を定める。何を作るかは `docs/requirements.md`、どう表現するかは
`docs/domain-model.md`、なぜその作りなのかは `docs/adr.md` が担う。

人間が1コマンドずつ見ていないという前提が、以下すべての設計理由である。

---

## 1. ブランチ運用: トランクベース開発

**`main` がトランクであり、常にリリース可能な唯一の幹。** 枝は必ず幹に戻る。
並行して育てる第二の幹を作らない。

| 決めごと | 内容 |
| --- | --- |
| 幹 | `main` の1本のみ。`develop` / `release/*` は作らない |
| 枝 | feature ブランチ1本 = 1 PR = 1タスク。**寿命に上限は設けない** |
| 命名 | `<type>/<slug>`。type は Conventional Commits と揃える（`feat/` `fix/` `docs/` `refactor/` `test/` `chore/`） |
| 統合 | PR → CI グリーン → **squash merge**。マージ後にブランチを削除する |
| 直接 push | **禁止。** `main` への push はフック（`.claude/hooks/guard.mjs`）が機械的に拒否する |
| 同期 | 枝が古くなったら `main` を取り込む（`/sync`）。取り込みは普通の作業であって、失敗の合図ではない |
| 未完成の機能 | **マージを止めない。`main` に入れ、画面に出すかどうかだけを feature flag で制御する**（ADR-024） |

**マージの条件は「完成したか」ではなく「壊していないか」。** 前者は人の判断を待つが、
後者は `pnpm verify` で機械的に決まる。ループが自分で完了を判断できるのはこの形のときだけで、
未完成をブランチで抱えると、判断がマージのたびに人へ戻ってしまう。

**フックは自分のエージェントしか止められない。** `main` を本当に守るのは GitHub 側の
ブランチ保護である。リポジトリの設定で「`main` への直接 push を禁止」「PR に CI（`verify`）の
成功を必須」を有効にすること。**これは手作業で1度だけ必要**（リポジトリ設定なので git に入らない）。

**コンフリクトが出たら:** `main` を取り込んで解消する。他人（自分の別セッションを含む）の
ブランチで履歴を書き換えない。`pnpm-lock.yaml` は手で直さず `pnpm install` で作り直す。

### 未完成の機能は feature flag で隠す（ADR-024）

画面に出せる状態でなくてもマージする。隠すのはブランチではなくフラグの役目。

| 決めごと | 内容 |
| --- | --- |
| 既定 | **無効。** 指定を忘れた環境が「未完成が見えている」側に倒れないようにする |
| 実体 | ビルド時の環境変数 `VITE_FEATURE_<機能名>` |
| 読み出し | `apps/web/src/features.ts` の1か所だけ。他所で `import.meta.env` を直接読まない |
| 分岐の位置 | **プレゼンテーション層のみ。** ユースケース層とドメイン層はフラグを知らない |
| 寿命 | 恒久設定ではない。**既定で有効になった時点でフラグと分岐を消す** |

```ts
// apps/web/src/features.ts
export const features = {
  pantryList: import.meta.env.VITE_FEATURE_PANTRY_LIST === 'true',
} as const;
```

**フラグを作る PR では、`docs/backlog.md` に「そのフラグを消す」タスクを同時に足す。**
放置されたフラグは死んだ分岐になり、次の実装の判断を狂わせる。

テストはフラグを介さず、ユースケース層とドメイン層を直接呼ぶ。**画面に到達できないことと、
検証されていないことは別である。**

## 2. 完了の定義

```
pnpm verify
```

これが緑であることが、PR を出す条件であり、マージの条件でもある。中身は
`pnpm lint`（ESLint + dependency-cruiser）→ `pnpm typecheck` → `pnpm test`（vitest）→
`pnpm test:hooks`（フックの回帰テスト）→ `pnpm build` の順。CI（`.github/workflows/ci.yml`）は
PR と `main` への push で同じものを走らせる。

**テストを飛ばす・無効にする・`skip` するのは禁止。** 落ちたテストは直すか、直せない理由を
PR に書いて止まる。

## 3. 自律ループ

```
/loop /next
```

`/next` が1周分（タスク1件 → 実装 → 検証 → PR → マージ）を担う。ループの入力は
`docs/backlog.md`、出力は PR。周と周のあいだの状態はすべて git 上にある — セッションが
落ちてもコンテナが消えても、`main` と backlog を読めば次の周が再開できる。

**ループを止める条件**（勝手に決めずユーザーに投げる）:

- 確定事項 **C-1〜C-16**（`docs/domain-model.md` 第7章）を破る必要が出た
- **未決事項**の決定が必要になった（LLM プロバイダ / 食材マスタの初期データ / 献立の保持期間 /
  賞味期限と消費期限の区別 / Supabase 無料プランの一時停止対応）
- `docs/requirements.md` の FR / NFR に無い機能が必要になった
- 依存パッケージの追加が必要になった
- **同じ検証失敗を2回直せなかった**

止まるときは、そこまでの成果をドラフト PR として push し、「何が決まれば進むか」を
1つの質問にして終える。黙って止まらない。黙って進めない。

## 4. 安全装置

自律ループでは許可プロンプトが機能しない（応答する人がいない）。そのため
**戻せない操作だけをフックで機械的に拒否し、それ以外は通す**という方針をとる。

| 場所 | 役割 |
| --- | --- |
| `.claude/hooks/guard.mjs` | `PreToolUse(Bash)`。`main` への直接 push・force push・`reset --hard`・`clean -f`・`branch -D`・`stash drop`・`git add -A`／`git add .`・`.dev.vars` や `.env` の読み出し・環境変数のダンプを拒否する |
| `.claude/hooks/guard.test.mjs` | 上の回帰テスト。`pnpm test:hooks` で走る。ガードが黙って効かなくなるのが最悪のため、拒否側と許可側の両方を固定している |
| `.claude/settings.json` | `permissions.deny` で秘密ファイルの Read/Edit を止め、`allow` に検証・git の常用コマンドを並べてプロンプトを消している |
| `.claude/hooks/session-start.sh` | Claude Code on the web のセッション開始時に `pnpm install`。依存が無いと検証が動かないため |

`git add -A` を禁じているのは、`.dev.vars` や生成物の混入が **push されるまで気づけない**ため。
コミットに入れるファイルは毎回明示する。

## 5. コマンド

| コマンド | 用途 |
| --- | --- |
| `/next` | ループ1周。backlog の先頭タスクを1件、PR 1本にして `main` に入れる |
| `/verify` | `pnpm verify` を走らせ、落ちた層だけを報告する |
| `/sync` | 作業中のブランチに `main` を取り込む |
| `/address` | PR のレビュー指摘を精査し、妥当なものだけ直す |

## 6. コミット

- **staged になっているものからコミットを作る。** コミットを整えるために stage を足し引きしない
- 1コミット1目的。Conventional Commits の型を混ぜない（`.gitmessage` がテンプレート。
  `git config commit.template .gitmessage` を clone 後に1度だけ実行する）
- メッセージは会話ではなく `git diff --staged` から書く。**やらなかったこと・見送ったことは書かない**
- 「なぜ」をコミットに、「なぜそうしなかったか」をコメントに、「何を」をテストに、「どうやって」をコードに置く
