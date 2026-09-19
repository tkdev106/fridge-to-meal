/**
 * `apps/api` への出口の型（B-22 設計 5章 / 4章）。
 *
 * **ここは画面ではない。** 経路の継ぎ目であり、置き場を `api/` と名づけないのは
 * `api 層` がサーバ側の層の名だからである（規則1 / 先行 `session/README.md`）。
 *
 * **`Response` と `fetch` の型を口に出さない。** `apps/web/test` は `types: []` /
 * `lib: ES2022` で DOM の型を持たないため、差し替える出口は**構造型**で表す
 * （先行 `JwksResponse` / `FetchJwks`。`HouseholdAuthenticatorImpl.ts`）。
 */

/** 応答のうち、この層が読む2つだけ（設計 5章）。 */
export type HttpResponse = { readonly ok: boolean; json(): Promise<unknown> };

/** 差し替える出口。既定は実行環境の `fetch`（組むのは `main.tsx` だけ）。 */
export type HttpFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<HttpResponse>;
