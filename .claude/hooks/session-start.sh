#!/usr/bin/env bash
# Claude Code on the web 用のセットアップ。
# コンテナは毎回まっさらな clone から始まるため、依存が無いと pnpm test も pnpm lint も動かない。
# ローカルの対話セッションでは何もしない（$CLAUDE_CODE_REMOTE が true のときだけ走る）。
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# packageManager フィールドがあるので corepack が版を合わせる
if ! command -v pnpm > /dev/null 2>&1; then
  corepack enable pnpm
fi

# --frozen-lockfile ではなく通常の install。
# コンテナ状態はフック完了後にキャッシュされるので、再実行時は差分だけで済む。
pnpm install

# `pnpm test:db` の相手を立てる（ADR-030）。Docker Hub がこの環境の egress で塞がれており
# `pnpm db:up` は通らないが、素の PostgreSQL はイメージに入っている。
# **サーバはセッションをまたいで生き残らない**ため、開始のたびに立て直す。
# **落ちても続行する** — DB が無くても pnpm verify 側は動くので、ここで setup ごと倒さない。
bash tools/start-local-postgres.sh || echo "local postgres: 立てられなかった。test:db は CI で見る" >&2

# コミットの作者を固定する（docs/workflow.md 7章）。
# ローカルの git 設定はコンテナと一緒に消えるため、開始のたびに入れ直す。
git config user.name "tkdev106"
git config user.email "178723293+tkdev106@users.noreply.github.com"
# コミットメッセージの形式（docs/workflow.md 7章）。core.hooksPath は web では設定しない —
# ハーネスが割り当てる claude/… の枝への push が止まる（CLAUDE.md「Claude Code on the web で作業するとき」）。
git config commit.template .gitmessage

echo "setup done: $(node -v) / pnpm $(pnpm -v)"
