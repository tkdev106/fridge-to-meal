import type { IdentifyHousehold } from '../../../src/contexts/identity/usecase/IdentifyHousehold.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 決まった世帯を返す、世帯を定めるユースケースの代役（B-08 設計書 4章・9章）。
 *
 * api 層は `identity` の何も import せず、`identifyHousehold` を関数として引数で受け取る
 * （ADR-032 の決定4）。テストからは**その関数に何が渡ったか**を状態として観察する —
 * `vi.fn()` で呼び出しを数えない（`docs/testing.md` 2章）。先行は
 * `FixedHouseholdAuthenticator.ts` で、持つ状態は「返す世帯」「受け取ったアクセストークン」だけである。
 */
export class 記憶上の世帯の特定 {
  readonly #返す世帯: HouseholdId;
  readonly #受け取ったアクセストークンたち: string[] = [];

  constructor(返す世帯: HouseholdId) {
    this.#返す世帯 = 返す世帯;
  }

  /** 何度委ねられたか。**呼ばれないこと**が要件のときだけ見る（`docs/testing.md` 2章）。 */
  get 呼ばれた回数(): number {
    return this.#受け取ったアクセストークンたち.length;
  }

  /** 最後に委ねられたアクセストークン。まだ一度も呼ばれていなければ `null`。 */
  get 受け取ったアクセストークン(): string | null {
    return this.#受け取ったアクセストークンたち.at(-1) ?? null;
  }

  readonly 世帯を定める: IdentifyHousehold = async (accessToken) => {
    this.#受け取ったアクセストークンたち.push(accessToken);
    return this.#返す世帯;
  };
}
