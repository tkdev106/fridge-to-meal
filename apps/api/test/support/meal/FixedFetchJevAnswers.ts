import type {
  FetchJevAnswers,
  JevAnswersRequest,
  JevAnswersResponse,
} from '../../../src/contexts/meal/infrastructure/GeneratedMealCheckerImpl.js';

/**
 * 届ける応答1つぶん（B-78 設計書 4章）。
 *
 * 7章の失敗は「応答の形」で表せる — 2xx でない / 本体が読めない / 本体が届かない。**送れない**
 * 失敗と**応答が届かない**失敗だけは応答が無いので、`throws` と `hangs` で表す
 * （先行 `FixedFetchGenerateContent`）。
 */
export type JevAnswersDelivery =
  /** 本体をそのまま `json()` の結果として届ける。 */
  | { readonly ok: boolean; readonly status: number; readonly body: unknown }
  /** 本体が読めない応答を届ける（`json()` が渡した例外を投げる）。 */
  | { readonly ok: boolean; readonly status: number; readonly jsonThrows: Error }
  /** 送れない。渡した例外をそのまま投げる。 */
  | { readonly throws: Error }
  /** 応答が届かない。要求の `signal` が中断されたら、その理由で断る（本物の `fetch` と同じ）。 */
  | { readonly hangs: true }
  /**
   * 応答の頭は届くが、本体を読み終えない。`json()` は要求の `signal` が中断されたら、その理由で
   * 断る（本物の `fetch` と同じ）。
   */
  | { readonly jsonHangs: true };

/** 受け取った要求1件。本体は文字列のまま残し、見るときにテストの側で `JSON.parse` する。 */
export type ReceivedJevAnswers = {
  readonly url: string;
  readonly request: JevAnswersRequest;
};

/** 問いの鍵ごとの確率から、Jev の答えの本体（`answers.<鍵>.noul`）を組む。 */
export function answersOf(noulByKey: Readonly<Record<string, unknown>>): unknown {
  return {
    answers: Object.fromEntries(Object.entries(noulByKey).map(([key, noul]) => [key, { noul }])),
  };
}

/** 2xx で本体を届ける応答。 */
export function okDeliveryOf(body: unknown): JevAnswersDelivery {
  return { ok: true, status: 200, body };
}

/**
 * 確かめの要求を受け取って記録し、決めた応答を届ける記憶上の実装（B-78 設計書 4章）。
 *
 * 本物は `fetch` でネットワークに出るため、そのままではテストが外の都合に縛られる
 * （`docs/testing.md` 5章）。`vi.fn()` で呼び出し回数を数えず、**記憶上の実装の状態として
 * 観察する**（同2章）。先行は `FixedFetchGenerateContent`。
 */
export class FixedFetchJevAnswers {
  /**
   * 呼ばれた順に届ける応答。尽きたあとは最後のものを繰り返す。既定は答えの無い本体で、
   * 要求の形だけを見るテストが応答の中身に縛られないようにする。
   */
  #deliveries: readonly JevAnswersDelivery[] = [okDeliveryOf(answersOf({}))];
  readonly #received: ReceivedJevAnswers[] = [];

  /** 応答を**呼ばれた順に**届ける形で組む。 */
  static delivering(...deliveries: readonly JevAnswersDelivery[]): FixedFetchJevAnswers {
    if (deliveries.length === 0) {
      throw new Error('届ける応答を1件以上渡す');
    }

    const fixedFetchJevAnswers = new FixedFetchJevAnswers();
    fixedFetchJevAnswers.#deliveries = deliveries;
    return fixedFetchJevAnswers;
  }

  /** 何度送られたか。**送らないこと**が要件のときだけ見る（B-78 規則2・7）。 */
  get callCount(): number {
    return this.#received.length;
  }

  /** 受け取った要求を、受け取った順に。 */
  get received(): readonly ReceivedJevAnswers[] {
    return this.#received;
  }

  readonly fetchJevAnswers: FetchJevAnswers = async (url, request) => {
    const delivery = this.#deliveries[Math.min(this.callCount, this.#deliveries.length - 1)];

    // **数えるのは投げるより先である**（`docs/testing.md` 2章）。
    this.#received.push({ url, request });

    if (delivery === undefined) {
      throw new Error('届ける応答が1件も無い');
    }
    if ('throws' in delivery) {
      throw delivery.throws;
    }
    if ('hangs' in delivery) {
      return untilAborted(request.signal);
    }
    if ('jsonHangs' in delivery) {
      return { ok: true, status: 200, json: () => untilAborted(request.signal) };
    }
    if ('jsonThrows' in delivery) {
      return {
        ok: delivery.ok,
        status: delivery.status,
        json: async () => {
          throw delivery.jsonThrows;
        },
      };
    }

    const response: JevAnswersResponse = {
      ok: delivery.ok,
      status: delivery.status,
      json: async () => delivery.body,
    };
    return response;
  };
}

/** 中断されるまで決着しない約束。中断されたらその理由で断る。 */
function untilAborted(signal: JevAnswersRequest['signal']): Promise<never> {
  return new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => {
      reject(signal.reason);
    });
  });
}
