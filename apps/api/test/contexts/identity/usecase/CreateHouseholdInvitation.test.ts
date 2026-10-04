import { describe, expect, it } from 'vitest';
import type { HouseholdInvitationCreator } from '../../../../src/contexts/identity/domain/port/HouseholdInvitationCreator.js';
import { createHouseholdInvitation } from '../../../../src/contexts/identity/usecase/CreateHouseholdInvitation.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryHouseholdMembers } from '../../../support/identity/InMemoryHouseholdMembers.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');
const unrelatedHousehold = householdIdOf('88888888-8888-4888-8888-888888888888');

describe('招待を作る CreateHouseholdInvitation', () => {
  it('招待を作ると、口が作ったトークンを返す', async () => {
    // 設計書 5章 / FR-44: 返すのは口が作ったトークンそのものである。
    const householdInvitationCreator: HouseholdInvitationCreator = {
      async create() {
        return 'invitation-from-port';
      },
    };
    const runCreate = createHouseholdInvitation({ householdInvitationCreator });

    await expect(runCreate(ourHousehold)).resolves.toBe('invitation-from-port');
  });

  it('作った招待で参加すると、渡した世帯の人数が増え、他の世帯の人数は変わらない', async () => {
    // 設計書 規則1 / FR-44 / C-9: 招待は渡した世帯のものとして作られる。
    const householdMembers = new InMemoryHouseholdMembers([
      [ourHousehold, 1],
      [neighborHousehold, 1],
      [unrelatedHousehold, 2],
    ]);
    const runCreate = createHouseholdInvitation({ householdInvitationCreator: householdMembers });

    const token = await runCreate(ourHousehold);
    await householdMembers.join(neighborHousehold, token);

    const counts = {
      ours: await householdMembers.count(ourHousehold),
      unrelated: await householdMembers.count(unrelatedHousehold),
    };
    expect(counts).toEqual({ ours: 2, unrelated: 2 });
  });

  it('招待を作る口が投げた例外を包まずにそのまま伝える', async () => {
    // 設計書 7章6行目 / ADR-045: IdentityRuleViolation に包むと 401 に化ける。
    const failure = new Error('招待を作れなかった');
    const failingCreator: HouseholdInvitationCreator = {
      async create() {
        throw failure;
      },
    };
    const runCreate = createHouseholdInvitation({ householdInvitationCreator: failingCreator });

    await expect(runCreate(ourHousehold)).rejects.toBe(failure);
  });
});
