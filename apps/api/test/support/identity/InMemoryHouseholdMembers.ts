import type { HouseholdInvitationCreator } from '../../../src/contexts/identity/domain/port/HouseholdInvitationCreator.js';
import type {
  HouseholdJoiner,
  JoinOutcome,
} from '../../../src/contexts/identity/domain/port/HouseholdJoiner.js';
import type { HouseholdLeaver } from '../../../src/contexts/identity/domain/port/HouseholdLeaver.js';
import type { HouseholdMemberCounter } from '../../../src/contexts/identity/domain/port/HouseholdMemberCounter.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 世帯ごとの人数と招待を覚えておく、記憶上の `HouseholdMemberCounter` / `HouseholdLeaver` /
 * `HouseholdInvitationCreator` / `HouseholdJoiner`（B-75 設計書 4章・5章 / B-74 設計書 4章・5章）。
 *
 * 本物は `private.household_member_count()` / `private.leave_household()` /
 * `private.create_household_invitation()` / `private.join_household()` を呼ぶため、そのままでは
 * ユースケースのテストが DB に縛られる。`vi.fn()` で呼び出しを数えず、**世帯ごとの人数という
 * 1つの状態として観察する**（`docs/testing.md` 2章）。抜けたか・参加したかは人数を取り直して確かめる。
 *
 * 抜けると元の世帯の人数が1減る。人数が 1 以下の世帯では何もせず false を返す
 * （B-75 設計書 規則3 の写し）。抜けた先の新しい世帯は覚えない — 本題は元の世帯である。
 * 覚えていない世帯の人数は 0 と答える。
 *
 * 招待は作るたびに新しいトークンを発行する（B-74 設計書 規則2）。トークンは発行順の決まった
 * 文字列で、乱数を読まない（`docs/testing.md` 5章）。参加は B-74 設計書 規則4〜6 の写しである —
 * 覚えていないトークン・メンバーの居ない世帯の招待は `invalidInvitation`、招待の世帯が引数の
 * 世帯と同じなら `alreadyMember` で何も変えず、それ以外は招待を消し、招待の世帯の人数を1増やし、
 * 引数の世帯の人数を1減らす（0 より下げない）。
 */
export class InMemoryHouseholdMembers
  implements HouseholdMemberCounter, HouseholdLeaver, HouseholdInvitationCreator, HouseholdJoiner
{
  readonly #memberCounts: Map<HouseholdId, number>;
  readonly #invitations = new Map<string, HouseholdId>();
  #issuedInvitationCount = 0;

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

  async create(householdId: HouseholdId): Promise<string> {
    this.#issuedInvitationCount += 1;
    const token = `invitation-${this.#issuedInvitationCount}`;
    this.#invitations.set(token, householdId);
    return token;
  }

  async join(householdId: HouseholdId, token: string): Promise<JoinOutcome> {
    const invitedHousehold = this.#invitations.get(token);
    if (invitedHousehold === undefined) return 'invalidInvitation';

    const invitedMemberCount = this.#memberCounts.get(invitedHousehold) ?? 0;
    if (invitedMemberCount < 1) return 'invalidInvitation';
    if (invitedHousehold === householdId) return 'alreadyMember';

    this.#invitations.delete(token);
    this.#memberCounts.set(invitedHousehold, invitedMemberCount + 1);
    const memberCount = this.#memberCounts.get(householdId) ?? 0;
    this.#memberCounts.set(householdId, Math.max(memberCount - 1, 0));
    return 'joined';
  }
}
