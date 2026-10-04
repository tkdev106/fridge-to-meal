/**
 * 持ち越し中の招待のトークンの継ぎ目（`src/householdInvitation/PendingHouseholdInvitation.ts`）の
 * **記憶上の実装**（B-77 設計 4章。先行 `FixedConnectivity`）。
 *
 * **`vi.fn()` を使わない**（`docs/testing.md` 2章）。トークンは自分の状態として持ち、テストは
 * `read()` で今の値を観る — 門が「どの結末でトークンを消し、どの結末で残すか」（設計 規則9）は
 * 呼ばれた回数ではなく、残っている値で確かめる。
 */

import type { PendingHouseholdInvitation } from '../../../src/householdInvitation/PendingHouseholdInvitation.js';

export class FixedPendingHouseholdInvitation implements PendingHouseholdInvitation {
  #token: string | null;

  /** 持ち越した状態で始めるトークン。既定は持ち越していない（`null`）。 */
  constructor(initialToken: string | null = null) {
    this.#token = initialToken;
  }

  read(): string | null {
    return this.#token;
  }

  save(token: string): void {
    this.#token = token;
  }

  clear(): void {
    this.#token = null;
  }
}
