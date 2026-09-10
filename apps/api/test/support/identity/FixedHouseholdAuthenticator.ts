import type { HouseholdAuthenticator } from '../../../src/contexts/identity/domain/port/HouseholdAuthenticator.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 呼ばれるたびに、あらかじめ決めた応答を順に返す記憶上の認証器（B-07e 設計書 4章）。
 *
 * 本物は署名の検証を行うため、そのままではユースケースのテストが外の都合に縛られる。
 * `vi.fn()` で呼び出し回数を数えず、**記憶上の実装の状態として観察する**
 * （`docs/testing.md` 2章）。持つ状態は「返す世帯 / 投げる例外」「呼ばれた回数」
 * 「受け取ったアクセストークン」の3つだけである。
 *
 * 用意した数より多く呼ばれたら投げる。**足りないまま緑にしない**ため。
 */
export type 認証器の応答 = { readonly 返す世帯: HouseholdId } | { readonly 投げる例外: Error };

export class 記憶上の世帯認証器 implements HouseholdAuthenticator {
  readonly #応答たち: readonly 認証器の応答[];
  readonly #受け取ったアクセストークンたち: string[] = [];

  constructor(...応答たち: readonly 認証器の応答[]) {
    this.#応答たち = 応答たち;
  }

  /** 何度委ねられたか。**呼ばれないこと**が要件のときだけ見る（`docs/testing.md` 2章）。 */
  get 呼ばれた回数(): number {
    return this.#受け取ったアクセストークンたち.length;
  }

  /** 最後に委ねられたアクセストークン。まだ一度も呼ばれていなければ `null`。 */
  get 受け取ったアクセストークン(): string | null {
    return this.#受け取ったアクセストークンたち.at(-1) ?? null;
  }

  async authenticate(accessToken: string): Promise<HouseholdId> {
    const 応答 = this.#応答たち[this.#受け取ったアクセストークンたち.length];
    this.#受け取ったアクセストークンたち.push(accessToken);

    if (応答 === undefined) {
      throw new Error(`用意した応答が尽きた（用意したのは ${this.#応答たち.length} 件）`);
    }
    if ('投げる例外' in 応答) throw 応答.投げる例外;
    return 応答.返す世帯;
  }
}
