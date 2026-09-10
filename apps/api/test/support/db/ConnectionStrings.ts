/**
 * ローカル Postgres への接続文字列（B-07d 設計 5章・規則9）。
 *
 * **環境変数で上書きしない。** ローカルの接続先は秘密でなく（`.dev.vars` に置かない理由と
 * 同じ）、`apps/api/tsconfig.test.json` は `types: []` で `process` を持たないためでもある。
 * ポートは **55432** — 手元の 5432 と衝突させない。ポートを変えるときは
 * `docker-compose.yml`・`tools/start-local-postgres.sh`・ここの**3か所**を直す
 * （Docker を使わない経路が増えた。ADR-030）。
 *
 * `search_path` を両方に明示するのは、`supabase/migrations/*.sql` が無修飾で表を作るため
 * （解決を既定値に委ねない。設計 規則9）。
 */
const 接続先 = '127.0.0.1:55432/postgres?options=-c%20search_path%3Dpublic';

/**
 * 表の所有者（`postgres`）。**適用専用**（設計 規則3）。
 * superuser と所有者は行レベルセキュリティを素通りするため、**テスト本体から使わない** —
 * 使うと RLS が無くても緑になる。
 */
export const 所有者の接続文字列 = `postgres://postgres:postgres@${接続先}`;

/**
 * アプリが繋ぐ役（`authenticator`。login・noinherit・非所有者）。
 * テスト本体はこちらだけを使い、トランザクションの中で `authenticated` に切り替える
 * （ADR-029 決定3(b)(c)）。
 */
export const アプリの接続文字列 = `postgres://authenticator:authenticator@${接続先}`;
