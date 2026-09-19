/**
 * `VITE_API_BASE_URL` の読み取りと正規化（B-22 設計 5章 / 規則4・5 / 7章1行目）。
 *
 * **ここは画面ではない。** 経路の継ぎ目の内側にある（規則1）。
 */

/**
 * 読む名前は1つだけ（規則4 / 先行 `sessionConfigOf` 規則11）。
 *
 * **`VITE_` の付かない名前（`API_BASE_URL`）は読まない** — あちらはサーバ専用の置き場の
 * 流儀であり、同じ値が web に来ている保証がない。バンドルに載るのは `VITE_` の付いた
 * ものだけなので、名前の違いがそのまま置き場の違いである。
 */
const BASE_URL_NAME = 'VITE_API_BASE_URL';

/**
 * 前後の空白を落としてから末尾の `/` を落とす（規則5）。**順序を取り違えない** —
 * 空白が外側にあるうちは末尾が `/` に見えないため、`'  https://…/  '` の `/` が残る。
 * 連続した `/` はまとめて落とす。叩く先は `` `${baseUrl}/stock-items` `` の1つだけで
 * （規則6）、`/` が残ると区切りが二重になる。
 *
 * 正規化の手は URL の形をした設定の先行（`apps/api/src/main.ts` の
 * `accessTokenVerificationOf`）と同じものである。
 */
function normalized(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/**
 * 渡された記録だけを読んで基点を作る（規則4）。`import.meta.env` を自分で読まない —
 * 読むとテストが環境に左右される（`docs/testing.md` 5章）。読ませる相手は `main.tsx` が決める。
 *
 * 前後の空白と末尾の `/` を落としてから返す（規則5）。落とした結果が空、または名前が
 * 未設定なら素の `Error` で断り、**message には名前までしか載せない**（値は書かない。
 * ADR-045 結果2 / 先行 `sessionConfigOf` 規則12）。
 *
 * **未設定・空文字・空白だけ・`/` だけを1つの断りに畳む。** どれも「基点が無い」ことに
 * 変わりはなく、受け止め手もいない（設定の欠落は利用者が入力を直しても解消しない）。
 * 専用の例外型を起こさないのも同じ理由である（ADR-045 決定1）。誰も包み直さないので、
 * この message がそのまま開発者の目に届き、**名前が出ることで足す値に気づける。**
 *
 * @throws Error `VITE_API_BASE_URL` が未設定・空・空白だけ、または落とした結果が空のとき（7章1行目）
 */
export function apiBaseUrlOf(vars: Readonly<Record<string, string | undefined>>): string {
  const value = vars[BASE_URL_NAME];
  const baseUrl = value === undefined ? '' : normalized(value);

  if (baseUrl === '') {
    throw new Error(`${BASE_URL_NAME} が設定されていない`);
  }

  return baseUrl;
}
