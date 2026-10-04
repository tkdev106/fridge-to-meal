import type {
  FetchGenerateContent,
  GenerateContentRequest,
  GenerateContentResponse,
} from '../../../src/contexts/meal/infrastructure/MealGeneratorImpl.js';

/**
 * 届ける応答1つぶん（B-72 設計書 7章）。
 *
 * 7章の失敗は「応答の形」で表せる — 2xx でない / 本体が読めない。**送れない**失敗だけは
 * 応答が無いので `throws` で表す。渡した例外がそのまま出ていくことを呼び出し側が `toBe` で
 * 断定できるよう、例外は呼び出し側が作って握る（先行 `FixedFetchJwks`）。
 */
export type GenerateContentDelivery =
  /** 本体をそのまま `json()` の結果として届ける。 */
  | { readonly ok: boolean; readonly status: number; readonly body: unknown }
  /** 本体が読めない応答を届ける（`json()` が渡した例外を投げる）。 */
  | { readonly ok: boolean; readonly status: number; readonly jsonThrows: Error }
  /** 送れない。渡した例外をそのまま投げる。 */
  | { readonly throws: Error }
  /** 応答が届かない。要求の `signal` が中断されたら、その理由で断る（本物の `fetch` と同じ）。 */
  | { readonly hangs: true };

/** 受け取った要求1件。本体は文字列のまま残し、見るときにテストの側で `JSON.parse` する。 */
export type ReceivedGenerateContent = {
  readonly url: string;
  readonly request: GenerateContentRequest;
};

/** 献立1件ぶんの本文（4章「出力する JSON の形式」に沿う）。 */
export type GeneratedMealText = {
  readonly title: string;
  readonly ingredients: readonly { name: string; amount: string; kind: string }[];
  readonly steps: readonly string[];
};

/** 正しい献立1件。既定の応答の中身であり、本題でないケースはこれで通す。 */
export const validMealText: GeneratedMealText = {
  title: '豚こま肉の生姜焼き',
  ingredients: [
    { name: '豚こま肉', amount: '300g', kind: 'main' },
    { name: '醤油', amount: '大さじ2', kind: 'seasoning' },
  ],
  steps: ['豚こま肉を色が変わるまで3分ほど炒める。', '醤油を加えて2分ほど煮からめる。'],
};

/** 本文（`{"meals":[...]}` の文字列）を組む。 */
export function mealsTextOf(meals: readonly GeneratedMealText[]): string {
  return JSON.stringify({ meals });
}

/**
 * Gemini の応答の封筒（`candidates[0].content.parts[].text` と `finishReason`）を組む。
 *
 * 部分は文字列か、`thought` を付けた部分を渡せる。`finishReason` を `undefined` にすると
 * キーごと落とす（欠落のケース）。
 */
export function envelopeOf(
  parts: readonly (string | { readonly text: string; readonly thought?: boolean })[],
  // 既定引数にすると `undefined` を明示しても 'STOP' に化けるので、渡されたかどうかで分ける。
  ...finishReasonArgument: [finishReason?: string | undefined]
): unknown {
  const finishReason = finishReasonArgument.length === 0 ? 'STOP' : finishReasonArgument[0];
  const candidate: Record<string, unknown> = {
    content: {
      role: 'model',
      parts: parts.map((part) => (typeof part === 'string' ? { text: part } : part)),
    },
  };
  if (finishReason !== undefined) {
    candidate['finishReason'] = finishReason;
  }
  return { candidates: [candidate] };
}

/** 2xx で封筒を届ける応答。 */
export function okDeliveryOf(body: unknown): GenerateContentDelivery {
  return { ok: true, status: 200, body };
}

/**
 * 生成の要求を受け取って記録し、決めた応答を届ける記憶上の実装（B-72 設計書 4章）。
 *
 * 本物は `fetch` でネットワークに出るため、そのままではテストが外の都合に縛られる
 * （`docs/testing.md` 5章）。`vi.fn()` で呼び出し回数を数えず、**記憶上の実装の状態として
 * 観察する**（同2章）。先行は `test/support/identity/FixedFetchJwks.ts`。
 */
export class FixedFetchGenerateContent {
  /** 呼ばれた順に届ける応答。尽きたあとは最後のものを繰り返す。 */
  #deliveries: readonly GenerateContentDelivery[] = [
    okDeliveryOf(envelopeOf([mealsTextOf([validMealText])])),
  ];
  readonly #received: ReceivedGenerateContent[] = [];

  /** 応答を**呼ばれた順に**届ける形で組む。 */
  static delivering(...deliveries: readonly GenerateContentDelivery[]): FixedFetchGenerateContent {
    if (deliveries.length === 0) {
      throw new Error('届ける応答を1件以上渡す');
    }

    const fixedFetchGenerateContent = new FixedFetchGenerateContent();
    fixedFetchGenerateContent.#deliveries = deliveries;
    return fixedFetchGenerateContent;
  }

  /** 何度送られたか。**送らないこと**・**送り直さないこと**が要件のときだけ見る。 */
  get callCount(): number {
    return this.#received.length;
  }

  /** 受け取った要求を、受け取った順に。 */
  get received(): readonly ReceivedGenerateContent[] {
    return this.#received;
  }

  readonly fetchGenerateContent: FetchGenerateContent = async (url, request) => {
    const delivery = this.#deliveries[Math.min(this.callCount, this.#deliveries.length - 1)];

    // **数えるのは投げるより先である**（`docs/testing.md` 2章）。送られたことは、
    // そのあと投げても事実である。
    this.#received.push({ url, request });

    if (delivery === undefined) {
      throw new Error('届ける応答が1件も無い');
    }
    if ('throws' in delivery) {
      throw delivery.throws;
    }
    if ('hangs' in delivery) {
      const { signal } = request;
      return new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(signal.reason);
        });
      });
    }

    return responseOf(delivery);
  };
}

/** 届ける応答を、この層が読む3つだけの形に写す（設計書5章 `GenerateContentResponse`）。 */
function responseOf(
  delivery: Exclude<GenerateContentDelivery, { readonly throws: Error } | { readonly hangs: true }>,
): GenerateContentResponse {
  if ('jsonThrows' in delivery) {
    return {
      ok: delivery.ok,
      status: delivery.status,
      json: async () => {
        throw delivery.jsonThrows;
      },
    };
  }

  return { ok: delivery.ok, status: delivery.status, json: async () => delivery.body };
}
