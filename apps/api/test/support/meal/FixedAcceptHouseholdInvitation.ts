import type { AcceptHouseholdInvitation } from '../../../src/contexts/meal/usecase/AcceptHouseholdInvitation.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 招待で参加する口の代役（B-74 5周目 / `docs/testing.md` 4章「ユースケースを差し替える」）。
 *
 * 決まった応答を返し、**受け取った世帯とトークンを状態として覚える**だけのもの。`vi.fn()` で
 * 呼び出しを数えず、記憶上の実装の状態として観察する（同 2章）。形は先行 `FixedLeaveHousehold` の写しである。
 *
 * **値を返さない口**なので、成功は印だけを置く（`{ succeeds: true }`）。応答は
 * 「成功の印」か「投げる例外」の**どちらか一方**である。**覚えるのは投げる前**にする
 * （同 2章）。本物のユースケースの型をそのまま名乗るので、**api 層が期待する形が本物と
 * 食い違っていれば型検査で落ちる。**
 */
export type AcceptHouseholdInvitationResponse =
  { readonly succeeds: true } | { readonly throws: Error };

export class FixedAcceptHouseholdInvitation {
  readonly #response: AcceptHouseholdInvitationResponse;
  readonly #received: { householdId: HouseholdId; token: string }[] = [];

  constructor(response: AcceptHouseholdInvitationResponse) {
    this.#response = response;
  }

  /** 最後に渡された世帯。まだ一度も呼ばれていなければ `null`（C-9）。 */
  get receivedHouseholdId(): HouseholdId | null {
    return this.#received.at(-1)?.householdId ?? null;
  }

  /** 最後に渡されたトークン。まだ一度も呼ばれていなければ `null`。 */
  get receivedToken(): string | null {
    return this.#received.at(-1)?.token ?? null;
  }

  readonly accept: AcceptHouseholdInvitation = async (householdId, token) => {
    // **記録は投げるより先である**（`docs/testing.md` 2章）。
    this.#received.push({ householdId, token });

    if ('throws' in this.#response) throw this.#response.throws;
  };
}
