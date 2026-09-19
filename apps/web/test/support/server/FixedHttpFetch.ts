import type { HttpFetch, HttpResponse } from '../../../src/server/HttpFetch.js';

/**
 * 届ける応答1つぶん（B-22 設計 規則9 / 7章）。
 *
 * 規則9 が畳む失敗のうち、`ok` が偽・本体が読めない・`stockItems` が配列でないの3つは
 * 「応答の形」で表せる。**出口が投げる**失敗（オフライン・到達不能・CORS で塞がれた）だけは
 * 応答が無いので `throws` で表す。先行は `apps/api/test/support/identity/FixedFetchJwks.ts`。
 */
export type HttpDelivery =
  /** 本体をそのまま `json()` の結果として届ける。`ok` も選べる。 */
  | { readonly ok: boolean; readonly body: unknown }
  /** 本体が JSON として読めない応答を届ける（`json()` が失敗する）。 */
  | { readonly ok: boolean; readonly unreadableBody: true }
  /** 取りに行けない。渡した例外をそのまま投げる。 */
  | { readonly throws: Error };

/** 出口が受け取った要求1つぶん。**url とヘッダだけを記録する**（規則6・8 が見るもの）。 */
export type ReceivedRequest = {
  readonly url: string;
  readonly headers: Record<string, string>;
};

/**
 * 決まった応答を届ける記憶上の実装（`docs/testing.md` 2章・5章）。
 *
 * 本物は `fetch` でネットワークに出るため、そのままではテストが外の都合に縛られる。
 * `vi.mock` と `vi.fn()` を使わず、**受け取った要求を自分の状態として持つ** —
 * 観察するのは戻り値と、この記録だけである。
 *
 * **要求の回数を仕様にするのは「要求を出さないこと」が要件の1件だけ**（規則7。
 * `docs/testing.md` 2章が認める例外）。それ以外のケースで件数を断定しない。
 */
export class FixedHttpFetch {
  /**
   * 呼ばれた順に届ける応答。**尽きたあとは最後のものを繰り返す**（先行 `FixedFetchJwks`）。
   */
  readonly #deliveries: readonly HttpDelivery[];
  readonly #receivedRequests: ReceivedRequest[] = [];

  constructor(...deliveries: readonly HttpDelivery[]) {
    if (deliveries.length === 0) {
      throw new Error('届ける応答を1件以上渡す');
    }

    this.#deliveries = deliveries;
  }

  /** 受け取った要求を、受け取った順に。 */
  get receivedRequests(): readonly ReceivedRequest[] {
    return this.#receivedRequests;
  }

  readonly httpFetch: HttpFetch = async (url, init) => {
    const delivery =
      this.#deliveries[Math.min(this.#receivedRequests.length, this.#deliveries.length - 1)];

    // **記録は投げるより先である**（`docs/testing.md` 2章）。要求が出たことは、
    // そのあと投げても事実であり、規則7 の「要求を出さない」はここを見て確かめる。
    this.#receivedRequests.push({ url, headers: { ...init.headers } });

    if (delivery === undefined) {
      throw new Error('届ける応答が1件も無い');
    }
    if ('throws' in delivery) {
      throw delivery.throws;
    }

    return responseOf(delivery);
  };
}

/** 届ける応答を、この層が読む2つだけの形に写す（設計 5章 `HttpResponse`）。 */
function responseOf(delivery: Exclude<HttpDelivery, { readonly throws: Error }>): HttpResponse {
  if ('unreadableBody' in delivery) {
    return {
      ok: delivery.ok,
      json: async () => {
        throw new Error('応答の本体が読めない');
      },
    };
  }

  return { ok: delivery.ok, json: async () => delivery.body };
}
