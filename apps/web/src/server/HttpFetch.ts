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

/**
 * 出す要求のうち、この層が渡す3つだけ（B-24）。**`Request` も `RequestInit` も型として
 * 口に出さない** — `HttpResponse` と同じ理由である（冒頭）。
 *
 * **`method` と `body` は任意にしてある。** 省略を「`GET` で本体なし」と読むのは実行環境の
 * `fetch` の既定そのままであり、先行の `GET`（`listStockItems`）は `headers` だけを渡す形の
 * まま動く。**既定に任せた要求と、自分で `'GET'` と書いた要求を同じ形にしない** —
 * 書いたことが事実として残るほうが、テストから読める。
 */
export type HttpRequest = {
  /** 省略は `GET`。 */
  readonly method?: string;
  readonly headers: Record<string, string>;
  /**
   * 本体。**文字列にしてから渡す** — JSON への直列化は要求を組む側（`StockItemRequests.ts`）の
   * 仕事であり、出口は運ぶだけである。省略は本体なし。
   */
  readonly body?: string;
};

/** 差し替える出口。既定は実行環境の `fetch`（組むのは `main.tsx` だけ）。 */
export type HttpFetch = (url: string, init: HttpRequest) => Promise<HttpResponse>;
