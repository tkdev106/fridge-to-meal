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
 * `FixedHouseholdAuthenticator.ts` の `AuthenticatorResponse` で、「返す値 か 投げる例外」の
 * どちらか一方を持つ形もそこから写している。
 */
export type IdentifyHouseholdResponse =
  { readonly returns: HouseholdId } | { readonly throws: Error };

export class FixedIdentifyHousehold {
  readonly #response: IdentifyHouseholdResponse;
  readonly #receivedAccessTokens: string[] = [];

  constructor(response: IdentifyHouseholdResponse) {
    this.#response = response;
  }

  /** 何度委ねられたか。**呼ばれないこと**が要件のときだけ見る（`docs/testing.md` 2章）。 */
  get callCount(): number {
    return this.#receivedAccessTokens.length;
  }

  /** 最後に委ねられたアクセストークン。まだ一度も呼ばれていなければ `null`。 */
  get receivedAccessToken(): string | null {
    return this.#receivedAccessTokens.at(-1) ?? null;
  }

  readonly identify: IdentifyHousehold = async (accessToken) => {
    this.#receivedAccessTokens.push(accessToken);

    // **本物の `IdentifyHousehold` と同じ契約の写し**（B-07e 規則9 / NFR-09）。
    // 中身が無いアクセストークンは委ねる前に断る。api がヘッダの無い要求に空文字を
    // 渡すこと（B-08 規則3）が 401 として観察できるのは、この1行があるためである。
    if (accessToken.trim() === '') {
      throw new IdentityRuleViolation('accessToken.missing', 'アクセストークンが提示されていない');
    }

    if ('throws' in this.#response) throw this.#response.throws;
    return this.#response.returns;
  };
}
