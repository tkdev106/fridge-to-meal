import type { UserDeleter } from '../../../src/contexts/identity/domain/port/UserDeleter.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 居る利用者を世帯の集合として覚えておく、記憶上の `UserDeleter`（B-56d 設計書 5章）。
 *
 * 本物は `auth.users` の行を消すため、そのままではユースケースのテストが DB に縛られる。
 * `vi.fn()` で呼び出しを数えず、**居る利用者という状態として観察する**（`docs/testing.md` 2章）。
 * 持つ状態は居る利用者の集合だけである。
 *
 * 居ない世帯を消しても投げない（設計書 規則7。存在を確かめない）。
 */
export class InMemoryUserDeleter implements UserDeleter {
  readonly #users: Set<HouseholdId>;

  constructor(...users: readonly HouseholdId[]) {
    this.#users = new Set(users);
  }

  /** その世帯の利用者が居るか。 */
  has(householdId: HouseholdId): boolean {
    return this.#users.has(householdId);
  }

  async delete(householdId: HouseholdId): Promise<void> {
    this.#users.delete(householdId);
  }
}
