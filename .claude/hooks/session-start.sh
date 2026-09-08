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

echo "setup done: $(node -v) / pnpm $(pnpm -v)"
