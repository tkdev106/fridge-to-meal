import type { HouseholdLeaver } from '../../../src/contexts/identity/domain/port/HouseholdLeaver.js';
import type { HouseholdMemberCounter } from '../../../src/contexts/identity/domain/port/HouseholdMemberCounter.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 世帯ごとの人数を覚えておく、記憶上の `HouseholdMemberCounter` と `HouseholdLeaver`
 * （B-75 設計書 4章・5章）。
 *
 * 本物は `private.household_member_count()` と `private.leave_household()` を呼ぶため、
 * そのままではユースケースのテストが DB に縛られる。`vi.fn()` で呼び出しを数えず、
 * **世帯ごとの人数という1つの状態として観察する**（`docs/testing.md` 2章）。抜けたかは
 * 人数を取り直して確かめる。
 *
 * 抜けると元の世帯の人数が1減る。人数が 1 以下の世帯では何もせず false を返す
 * （設計書 規則3 の写し）。抜けた先の新しい世帯は覚えない — 本題は元の世帯である。
 * 覚えていない世帯の人数は 0 と答える。
 */
export class InMemoryHouseholdMembers implements HouseholdMemberCounter, HouseholdLeaver {
  readonly #memberCounts: Map<HouseholdId, number>;

  constructor(memberCounts: readonly (readonly [HouseholdId, number])[] = []) {
    this.#memberCounts = new Map(memberCounts);
  }

  async count(householdId: HouseholdId): Promise<number> {
    return this.#memberCounts.get(householdId) ?? 0;
  }

  async leave(householdId: HouseholdId): Promise<boolean> {
    const memberCount = this.#memberCounts.get(householdId) ?? 0;
    if (memberCount < 2) return false;

    this.#memberCounts.set(householdId, memberCount - 1);
    return true;
  }
}
