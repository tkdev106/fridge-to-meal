import { describe, expect, it } from 'vitest';
import type { HouseholdMemberCounter } from '../../../../src/contexts/identity/domain/port/HouseholdMemberCounter.js';
import { countHouseholdMembers } from '../../../../src/contexts/identity/usecase/CountHouseholdMembers.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryHouseholdMembers } from '../../../support/identity/InMemoryHouseholdMembers.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

describe('世帯の人数を返す CountHouseholdMembers', () => {
  it('世帯を渡すと、その世帯の人数を返す', async () => {
    // B-75 設計書 5章 / FR-47: 人数は `HouseholdMember` の数である。
    const householdMemberCounter = new InMemoryHouseholdMembers([[ourHousehold, 2]]);
    const runCount = countHouseholdMembers({ householdMemberCounter });

    await expect(runCount(ourHousehold)).resolves.toBe(2);
  });

  it('他の世帯の人数を数えない', async () => {
    // C-9 / NFR-09: 数えるのは引数の世帯だけである。
    const householdMemberCounter = new InMemoryHouseholdMembers([
      [ourHousehold, 1],
      [neighborHousehold, 3],
    ]);
    const runCount = countHouseholdMembers({ householdMemberCounter });

    await expect(runCount(ourHousehold)).resolves.toBe(1);
  });

  it('人数を数える口が投げた例外を包まずにそのまま伝える', async () => {
    // 設計書 7章3行目 / ADR-045: IdentityRuleViolation に包むと 401 に化ける。
    const failure = new Error('人数を数えられなかった');
    const failingCounter: HouseholdMemberCounter = {
      async count() {
        throw failure;
      },
    };
    const runCount = countHouseholdMembers({ householdMemberCounter: failingCounter });

    await expect(runCount(ourHousehold)).rejects.toBe(failure);
  });
});
