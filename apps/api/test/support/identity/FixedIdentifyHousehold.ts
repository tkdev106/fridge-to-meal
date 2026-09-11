import { IdentityRuleViolation } from '../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';
import type { IdentifyHousehold } from '../../../src/contexts/identity/usecase/IdentifyHousehold.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 決まった世帯を返すか、決まった例外を投げる、世帯を定めるユースケースの代役
 * （B-08 設計書 4章・9章）。
 *
 * api 層は `identity` の何も import せず、`identifyHousehold` を関数として引数で受け取る
 * （ADR-032 の決定4）。テストからは**その関数に何が渡ったか**を状態として観察する —
 * `vi.fn()` で呼び出しを数えない（`docs/testing.md` 2章）。先行は
 * `FixedHouseholdAuthenticator.ts` の `認証器の応答` で、「返す値 か 投げる例外」の
 * どちらか一方を持つ形もそこから写している。
 */
export type 世帯の特定の応答 = { readonly 返す世帯: HouseholdId } | { readonly 投げる例外: Error };

export class 記憶上の世帯の特定 {
  readonly #応答: 世帯の特定の応答;
  readonly #受け取ったアクセストークンたち: string[] = [];

  constructor(応答: 世帯の特定の応答) {
    this.#応答 = 応答;
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

    // **本物の `IdentifyHousehold` と同じ契約の写し**（B-07e 規則9 / NFR-09）。
    // 中身が無いアクセストークンは委ねる前に断る。api がヘッダの無い要求に空文字を
    // 渡すこと（B-08 規則3）が 401 として観察できるのは、この1行があるためである。
    if (accessToken.trim() === '') {
      throw new IdentityRuleViolation('accessToken.missing', 'アクセストークンが提示されていない');
    }

    if ('投げる例外' in this.#応答) throw this.#応答.投げる例外;
    return this.#応答.返す世帯;
  };
}
