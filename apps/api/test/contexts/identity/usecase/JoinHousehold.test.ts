import { describe, expect, it } from 'vitest';
import type { HouseholdJoiner } from '../../../../src/contexts/identity/domain/port/HouseholdJoiner.js';
import { joinHousehold } from '../../../../src/contexts/identity/usecase/JoinHousehold.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryHouseholdMembers } from '../../../support/identity/InMemoryHouseholdMembers.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');
const unrelatedHousehold = householdIdOf('88888888-8888-4888-8888-888888888888');

/**
 * 世帯ごとの人数を置き、ユースケースを1つ組む。招待は同じ偽物で作り、参加したかは
 * 人数を取り直して見る。
 */
function setUp(memberCounts: readonly (readonly [HouseholdId, number])[]) {
  const householdMembers = new InMemoryHouseholdMembers(memberCounts);
  const runJoin = joinHousehold({ householdJoiner: householdMembers });

  return { runJoin, householdMembers };
}

describe('招待で世帯に参加する JoinHousehold', () => {
  it('使える招待なら断られずに参加できる', async () => {
    // 設計書 規則6 / FR-45: 出口が joined を返したら何も返さずに終える。
    const { runJoin, householdMembers } = setUp([
      [ourHousehold, 1],
      [neighborHousehold, 1],
    ]);
    const token = await householdMembers.create(neighborHousehold);

    await expect(runJoin(ourHousehold, token)).resolves.toBeUndefined();
  });

  it('参加すると、招待の世帯の人数が1増える', async () => {
    // 設計書 規則6 / ADR-087 決定5: 参加した利用者は招待の世帯の人数に入る。
    const { runJoin, householdMembers } = setUp([
      [ourHousehold, 1],
      [neighborHousehold, 1],
    ]);
    const token = await householdMembers.create(neighborHousehold);

    await runJoin(ourHousehold, token);

    await expect(householdMembers.count(neighborHousehold)).resolves.toBe(2);
  });

  it('使えない招待で参加しようとすると IdentityRuleViolation の joinHousehold.invalidInvitation で断る', async () => {
    // 設計書 規則4・11・7章4行目 / ADR-087 決定4: 無い・切れた・使用済みを区別しない。
    const { runJoin } = setUp([[ourHousehold, 1]]);

    await expect(runJoin(ourHousehold, 'invitation-unknown')).rejects.toMatchObject({
      name: 'IdentityRuleViolation',
      rule: 'joinHousehold.invalidInvitation',
    });
  });

  it('既に居る世帯の招待で参加しようとすると IdentityRuleViolation の joinHousehold.alreadyMember で断る', async () => {
    // 設計書 規則5・11・7章5行目 / ADR-087 決定5。
    const { runJoin, householdMembers } = setUp([[ourHousehold, 2]]);
    const token = await householdMembers.create(ourHousehold);

    await expect(runJoin(ourHousehold, token)).rejects.toMatchObject({
      name: 'IdentityRuleViolation',
      rule: 'joinHousehold.alreadyMember',
    });
  });

  it('参加しても関係しない世帯の人数は変わらない', async () => {
    // C-9: 動くのは引数の世帯と招待の世帯だけである。
    const { runJoin, householdMembers } = setUp([
      [ourHousehold, 1],
      [neighborHousehold, 1],
      [unrelatedHousehold, 2],
    ]);
    const token = await householdMembers.create(neighborHousehold);

    await runJoin(ourHousehold, token);

    await expect(householdMembers.count(unrelatedHousehold)).resolves.toBe(2);
  });

  it('参加する口が投げた例外を包まずにそのまま伝え、IdentityRuleViolation にしない', async () => {
    // 設計書 7章6行目 / ADR-045: IdentityRuleViolation に包むと 401 に化ける。
    const failure = new Error('参加できなかった');
    const failingJoiner: HouseholdJoiner = {
      async join() {
        throw failure;
      },
    };
    const runJoin = joinHousehold({ householdJoiner: failingJoiner });

    await expect(runJoin(ourHousehold, 'invitation-1')).rejects.toBe(failure);
  });
});
