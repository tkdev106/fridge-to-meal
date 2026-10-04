import type { CreateHouseholdInvitation } from '../../../src/contexts/identity/usecase/CreateHouseholdInvitation.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 招待を作る口の代役（B-74 5周目 / `docs/testing.md` 4章「ユースケースを差し替える」）。
 *
 * 決まった応答を返し、**受け取った世帯を状態として覚える**だけのもの。`vi.fn()` で呼び出しを
 * 数えず、記憶上の実装の状態として観察する（同 2章）。形は先行 `FixedCountHouseholdMembers` の写しである。
 *
 * 応答は「返すトークン」か「投げる例外」の**どちらか一方**である。**世帯を覚えるのは投げる前**にする
 * （同 2章）。本物のユースケースの型をそのまま名乗るので、**api 層が期待する形が本物と
 * 食い違っていれば型検査で落ちる。**
 */
export type CreateHouseholdInvitationResponse =
  { readonly returns: string } | { readonly throws: Error };

export class FixedCreateHouseholdInvitation {
  readonly #response: CreateHouseholdInvitationResponse;
  readonly #receivedHouseholdIds: HouseholdId[] = [];

  constructor(response: CreateHouseholdInvitationResponse) {
    this.#response = response;
  }

  /** 最後に渡された世帯。まだ一度も呼ばれていなければ `null`（C-9）。 */
  get receivedHouseholdId(): HouseholdId | null {
    return this.#receivedHouseholdIds.at(-1) ?? null;
  }

  readonly create: CreateHouseholdInvitation = async (householdId) => {
    // **記録は投げるより先である**（`docs/testing.md` 2章）。
    this.#receivedHouseholdIds.push(householdId);

    if ('throws' in this.#response) throw this.#response.throws;
    return this.#response.returns;
  };
}
