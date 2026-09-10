#!/usr/bin/env bash
# Docker を使わずに `pnpm test:db` の相手を立てる（ADR-030）。
#
# `docker-compose.yml` と同じものを素の PostgreSQL で用意する — 127.0.0.1:55432 に
# 待ち受け、`supabase/local/init.sql` の役と `auth.uid()` を持ったクラスタ。
# **接続先は `apps/api/test/support/db/ConnectionStrings.ts` がハードコードしている**ため、
# リポジトリ側の設定は要らない。
#
# **何度実行してもよい。** 既に 55432 が塞がっていれば何もせずに終わる（Docker で
# 立てた Postgres が居る場合もそのまま使う）。
#
# **PostgreSQL が入っていない環境では、失敗ではなく「立てられなかった」として終わる。**
# セッション開始のフックから呼ばれるため、ここで落ちると pnpm install ごと巻き添えになる。
#
# 変数名を ASCII にしているのは bash の制約であって、方針の例外ではない
# （TypeScript 側の日本語識別子はそのまま）。
set -euo pipefail

PORT=55432
PGDATA="${FRIDGE_TO_MEAL_PGDATA:-/tmp/fridge-to-meal-pgdata}"
PGLOG="$PGDATA.log"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INIT_SQL="$REPO_ROOT/supabase/local/init.sql"

# すでに誰かが待ち受けているなら、それを使う。Docker の Postgres でも同じことである。
if (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then
  echo "local postgres: 127.0.0.1:$PORT は既に待ち受けている。何もしない"
  exit 0
fi

# 版を固定しない。イメージに入っている中でいちばん新しいものを使う。
# CI と compose は 17 で、ここが 16 になることがある（ADR-030 の結果）。
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$PGBIN" ] || [ ! -x "$PGBIN/initdb" ]; then
  echo "local postgres: PostgreSQL が見つからないので立てない（pnpm db:up で Docker を使う）" >&2
  exit 0
fi

# postgres は root では起動しない。パッケージが作る postgres ユーザで動かす。
RUN_AS=""
if [ "$(id -u)" -eq 0 ]; then
  RUN_AS=postgres
  if ! id "$RUN_AS" > /dev/null 2>&1; then
    echo "local postgres: postgres ユーザが無いので立てない" >&2
    exit 0
  fi
fi

run_as() {
  if [ -n "$RUN_AS" ]; then
    su "$RUN_AS" -c "$1"
  else
    bash -c "$1"
  fi
}

# 初期化は1度だけ。役と auth.uid() はクラスタに属し、public スキーマを作り直しても消えない
# （作り直しは pnpm test:db の globalSetup が毎回行う）。
INITIALIZED=false
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  rm -rf "$PGDATA"
  mkdir -p "$PGDATA"
  [ -n "$RUN_AS" ] && chown "$RUN_AS:$RUN_AS" "$PGDATA"

  # -A trust。**ローカルの接続先は秘密でない**ため（ConnectionStrings.ts の言うとおり）、
  # 接続文字列のパスワードは素通りしてよい。この Postgres を外に出さないこと。
  run_as "$PGBIN/initdb -D '$PGDATA' -A trust -U postgres" > /dev/null
  INITIALIZED=true
fi

run_as "$PGBIN/pg_ctl -D '$PGDATA' -o '-p $PORT -c listen_addresses=127.0.0.1' -l '$PGLOG' start -w" > /dev/null

# compose では initdb のフックが流している SQL。クラスタを作った直後だけ流す。
if [ "$INITIALIZED" = true ]; then
  "$PGBIN/psql" -h 127.0.0.1 -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$INIT_SQL"
fi

echo "local postgres: $("$PGBIN/postgres" --version) が 127.0.0.1:$PORT で待ち受け中"
