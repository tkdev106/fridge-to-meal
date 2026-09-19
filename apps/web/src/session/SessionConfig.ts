/**
 * `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` の読み取り（B-34 設計 5章 / 6章 規則10〜12 / 7章1行目）。
 *
 * **ここは画面ではない。** 継ぎ目（`Session`）の内側にある（ADR-046 決定3）。
 * 画面はこの型を組み立てず、値も見ない。
 */

/** 継ぎ目が要する設定2つ（5章）。 */
export type SessionConfig = {
  readonly url: string;
  readonly anonKey: string;
};

/**
 * 読む名前は2つだけ（規則11 / ADR-046 決定4・結果2）。
 *
 * **`VITE_` の付かない名前（`SUPABASE_URL` / `SUPABASE_ANON_KEY`）は読まない** — あちらは
 * `apps/api/.dev.vars` に置くサーバ専用の値であり、同じ値が web に来ている保証がない。
 * バンドルに載るのは `VITE_` の付いたものだけなので、名前の違いがそのまま置き場の違いである。
 */
const URL_NAME = 'VITE_SUPABASE_URL';
const ANON_KEY_NAME = 'VITE_SUPABASE_ANON_KEY';

/**
 * 名前1つぶんの値を取り出す。未設定（`undefined`）と空文字は**同じに扱って断る**（規則12 /
 * ADR-043 決定3）— 空を通すと、欠けたことに気づかないまま anon のような値で繋ぎにいく。
 *
 * **空白だけの値は断らず、そのまま返す**（規則12 後半 / 先行 `StockItemFormValues` 規則4）。
 * 値の正規化を画面側に持ち込まない。
 *
 * 断り方は素の `Error` で、**専用の例外型を起こさない**（ADR-045 決定1）。設定の欠落は
 * 利用者が入力を直しても解消しない失敗であり、受け止め手がいない。
 * **message には名前までしか載せない**（ADR-045 結果2 / 7章1行目）— URL も鍵も値そのものは
 * 書かない。誰も包み直さないので、この message がそのまま開発者の目に届く。
 */
function requiredValue(vars: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = vars[name];

  if (value === undefined || value === '') {
    throw new Error(`${name} が設定されていない`);
  }

  return value;
}

/**
 * 渡された記録だけを読んで設定を作る（規則10）。`import.meta.env` を自分で読まない —
 * 読むとテストが環境に左右される（`docs/testing.md` 5章）。読ませる相手は結線する側が決める。
 *
 * 引数の型を必須プロパティ2つにしないのは、`import.meta.env` をそのまま渡せなくなるため（5章）。
 *
 * @throws Error 2つの名前のどちらかが未設定、または空文字のとき（7章1行目）
 */
export function sessionConfigOf(vars: Readonly<Record<string, string | undefined>>): SessionConfig {
  return {
    url: requiredValue(vars, URL_NAME),
    anonKey: requiredValue(vars, ANON_KEY_NAME),
  };
}
