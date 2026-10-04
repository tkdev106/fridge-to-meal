import { describe, expect, it } from 'vitest';
import type { HouseholdLeaver } from '../../../../src/contexts/identity/domain/port/HouseholdLeaver.js';
import { leaveHousehold } from '../../../../src/contexts/identity/usecase/LeaveHousehold.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryHouseholdMembers } from '../../../support/identity/InMemoryHouseholdMembers.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

/** 世帯ごとの人数を置き、ユースケースを1つ組む。抜けたかは同じ偽物の人数を取り直して見る。 */
function setUp(memberCounts: readonly (readonly [HouseholdId, number])[]) {
  const householdMembers = new InMemoryHouseholdMembers(memberCounts);
  const runLeave = leaveHousehold({ householdLeaver: householdMembers });

  return { runLeave, householdMembers };
}

describe('世帯を抜ける LeaveHousehold', () => {
  it('他のメンバーが居る世帯からは断られずに抜けられる', async () => {
    // 設計書 規則3・6 / FR-46: 人数が 2 以上なら抜けられる。
    const { runLeave } = setUp([[ourHousehold, 2]]);

    await expect(runLeave(ourHousehold)).resolves.toBeUndefined();
  });

  it('抜けると、元の世帯の人数が1減る', async () => {
    // 設計書 規則3 / ADR-087 決定6: 抜けた利用者は元の世帯の人数に入らない。
    const { runLeave, householdMembers } = setUp([[ourHousehold, 2]]);

    await runLeave(ourHousehold);

    await expect(householdMembers.count(ourHousehold)).resolves.toBe(1);
  });

  it('自分しか居ない世帯で抜けようとすると IdentityRuleViolation の leaveHousehold.alone で断る', async () => {
    // 設計書 規則6・7章1行目 / FR-46: 出口が false を返したら断る。判定は DB の関数の1か所に置く。
    const { runLeave } = setUp([[ourHousehold, 1]]);

    await expect(runLeave(ourHousehold)).rejects.toMatchObject({
      name: 'IdentityRuleViolation',
      rule: 'leaveHousehold.alone',
    });
  });

  it('抜けても他の世帯の人数は変わらない', async () => {
    // C-9 / 設計書 規則3: 動くのは引数の世帯だけである。
    const { runLeave, householdMembers } = setUp([
      [ourHousehold, 2],
      [neighborHousehold, 2],
    ]);

    await runLeave(ourHousehold);

    await expect(householdMembers.count(neighborHousehold)).resolves.toBe(2);
  });

  it('抜ける口が投げた例外を包まずにそのまま伝える', async () => {
    // 設計書 7章3行目 / ADR-045: IdentityRuleViolation に包むと 401 に化ける。
    const failure = new Error('世帯を抜けられなかった');
    const failingLeaver: HouseholdLeaver = {
      async leave() {
        throw failure;
      },
    };
    const runLeave = leaveHousehold({ householdLeaver: failingLeaver });

    await expect(runLeave(ourHousehold)).rejects.toBe(failure);
  });
});
