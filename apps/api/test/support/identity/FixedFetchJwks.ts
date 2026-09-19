import type {
  FetchJwks,
  JwksResponse,
} from '../../../src/contexts/identity/infrastructure/HouseholdAuthenticatorImpl.js';
import { publicAccessTokenKey } from './AccessSigning.js';

/**
 * 届ける応答1つぶん（B-07g 設計書 規則7）。
 *
 * 規則7 が列挙する失敗はどれも「応答の形」で表せる — `ok` でない / 本体が読めない /
 * `keys` が無い・配列でない・空。**取りに行けない**失敗だけは応答が無いので、
 * `throws` で表す。**渡した例外がそのまま出ていく**ことを呼び出し側が `toBe` で
 * 断定できるよう、例外は呼び出し側が作って握る（規則7b）。
 */
export type JwksDelivery =
  /** 本体をそのまま `json()` の結果として届ける。`ok` も選べる。 */
  | { readonly ok: boolean; readonly body: unknown }
  /** 本体が読めない応答を届ける（`json()` が失敗する）。 */
  | { readonly ok: boolean; readonly unreadableBody: true }
  /** 取りに行けない。渡した例外をそのまま投げる。 */
  | { readonly throws: Error };

/**
 * 決まった鍵の列を JWKS として届ける記憶上の実装（B-07g 設計書 4章・8章(c)）。
 *
 * 本物は `fetch` でネットワークに出るため、そのままではテストが外の都合に縛られる
 * （`docs/testing.md` 5章）。**届ける鍵は構築時に渡せる** — 鍵の `alg` を変えたり落としたりする
 * ケース（規則2b）が、鍵の側を差し替えて観察するためである。**応答の形そのものを選ぶときは
 * `FixedFetchJwks.delivering(...)`** を使う（規則7 の失敗と、その次の検証）。
 *
 * `vi.fn()` で呼び出し回数を数えず、**記憶上の実装の状態として観察する**
 * （`docs/testing.md` 2章）。先行は `FixedIdentifyHousehold.ts` で、
 * 関数型のポートを `readonly` の属性として持つ形もそこから写している。
 */
export class FixedFetchJwks {
  /**
   * 呼ばれた順に届ける応答。**尽きたあとは最後のものを繰り返す** —
   * 鍵を渡す形（1周目からの形）が「毎回同じ応答」を前提にしているためである。
   */
  #deliveries: readonly JwksDelivery[];
  readonly #receivedJwksUris: string[] = [];

  /** 届ける鍵を渡す形。`ok: true` で `{ keys }` を**毎回**届ける。 */
  constructor(keys: readonly unknown[] = [publicAccessTokenKey]) {
    this.#deliveries = [{ ok: true, body: { keys: [...keys] } }];
  }

  /**
   * 応答を**呼ばれた順に**届ける形で組む（規則7。1度目は失敗、2度目は正しい応答）。
   *
   * 応答の列は構築のあとに書き換えないので、ここで1度だけ入れる。
   */
  static delivering(...deliveries: readonly JwksDelivery[]): FixedFetchJwks {
    if (deliveries.length === 0) {
      throw new Error('届ける応答を1件以上渡す');
    }

    const fixedFetchJwks = new FixedFetchJwks();
    fixedFetchJwks.#deliveries = deliveries;
    return fixedFetchJwks;
  }

  /** 何度取りに行かれたか。**取りに行かないこと**が要件のときだけ見る（`docs/testing.md` 2章）。 */
  get callCount(): number {
    return this.#receivedJwksUris.length;
  }

  readonly fetchJwks: FetchJwks = async (jwksUri) => {
    const delivery = this.#deliveries[Math.min(this.callCount, this.#deliveries.length - 1)];

    // **数えるのは投げるより先である**（`docs/testing.md` 2章）。取りに行かれたことは、
    // そのあと投げても事実であり、規則5 の「取りに行く前に断る」はここを見て確かめる。
    this.#receivedJwksUris.push(jwksUri);

    if (delivery === undefined) {
      throw new Error('届ける応答が1件も無い');
    }
    if ('throws' in delivery) {
      throw delivery.throws;
    }

    return responseOf(delivery);
  };
}

/** 届ける応答を、この層が読む2つだけの形に写す（設計書5章 `JwksResponse`）。 */
function responseOf(delivery: Exclude<JwksDelivery, { readonly throws: Error }>): JwksResponse {
  if ('unreadableBody' in delivery) {
    return {
      ok: delivery.ok,
      json: async () => {
        throw new Error('JWKS の本体が読めない');
      },
    };
  }

  return { ok: delivery.ok, json: async () => delivery.body };
}
