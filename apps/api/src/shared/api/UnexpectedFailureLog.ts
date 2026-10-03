/**
 * 500 `unexpected` に畳む失敗を、サーバ側のログに1行だけ残す（ADR-080）。応答には原因を出さない
 * （応答の本体は各経路が持つ）。ここが決めるのは**ログに何を載せ、何を載せないか**だけである。
 *
 * 載せるのは失敗の種類（`name`）と、原因の見当がつく最小限の情報だけにする:
 * - 外から来た例外のうち、**DB ドライバの問い合わせの失敗**（`cause` を持つ例外。`name` は
 *   `Error` のままで見分けられない）は `message` を載せない。ドライバは `message` に SQL 全文と束縛した値を組み立てて入れる — 世帯の
 *   識別子・食材名・手順がそのままログに入る。代わりに原因（`cause`）の `name` と `code`（接続の
 *   失敗や制約違反の分類）だけを載せる。
 * - それ以外の `Error` は `name` と `message` を載せる。自前の例外の `message` は、どの設定が空か
 *   などの名前しか載せない規律で書かれている（ADR-045 結果2）。
 * - スタックは載せない。`Error` でない値は型の名前だけを載せる。
 *
 * 世帯の識別子・アクセストークン・鍵・要求の本体は、どの経路でも受け取らない。
 */
export function logUnexpectedFailure(
  thrown: unknown,
  write: (line: string) => void = (line) => {
    console.error(line);
  },
): void {
  write(`api.unexpected ${describeFailure(thrown)}`);
}

/** ログに載せる文字列にする。テストが値の漏れを確かめる入口でもある。 */
export function describeFailure(thrown: unknown): string {
  if (!(thrown instanceof Error)) return typeof thrown;
  // ドライバの問い合わせの失敗は `name` が `Error` のままで（実測。`DrizzleQueryError` ではない）、
  // `message` に SQL と値を持ち、原因を `cause` に持つ。**`cause` を持つ例外は `message` を載せない。**
  if (thrown.cause !== undefined) return `${thrown.name} cause=${describeCause(thrown.cause)}`;
  return `${thrown.name}: ${thrown.message}`;
}

/** 原因からは `name` と `code` だけを取る。`message` には値が入りうるので読まない。 */
function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) return typeof cause;
  const code: unknown = (cause as { code?: unknown }).code;
  return typeof code === 'string' ? `${cause.name} code=${code}` : cause.name;
}
