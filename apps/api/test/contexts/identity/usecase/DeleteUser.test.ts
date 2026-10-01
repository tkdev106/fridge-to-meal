import { describe, expect, it } from 'vitest';
import type { UserDeleter } from '../../../../src/contexts/identity/domain/port/UserDeleter.js';
import { deleteUser } from '../../../../src/contexts/identity/usecase/DeleteUser.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryUserDeleter } from '../../../support/identity/InMemoryUserDeleter.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

/** 2世帯ぶんの利用者を持つ記憶上の口で、ユースケースを1つ組む。 */
function setUp() {
  const userDeleter = new InMemoryUserDeleter(ourHousehold, neighborHousehold);
  const runDelete = deleteUser({ userDeleter });

  return { runDelete, userDeleter };
}

describe('利用者を消す DeleteUser', () => {
  it('世帯を渡して利用者を消すと、その世帯の利用者は居なくなる', async () => {
    // B-56d 設計書 5章 / FR-27 / ADR-071 決定2: アカウントの削除は利用者まで消す。
    const { runDelete, userDeleter } = setUp();

    await runDelete(ourHousehold);

    expect(userDeleter.has(ourHousehold)).toBe(false);
  });

  it('利用者を消しても、他の世帯の利用者は残る', async () => {
    // C-9 / NFR-09: 消すのは引数の世帯の利用者だけである。
    const { runDelete, userDeleter } = setUp();

    await runDelete(ourHousehold);

    expect(userDeleter.has(neighborHousehold)).toBe(true);
  });

  it('利用者を消す口が投げた例外を包まずにそのまま伝える', async () => {
    // 設計書 規則6・7章1行目 / ADR-045: IdentityRuleViolation に包むと 401 に化ける。
    const failure = new Error('利用者を消せなかった');
    const failingUserDeleter: UserDeleter = {
      async delete() {
        throw failure;
      },
    };
    const runDelete = deleteUser({ userDeleter: failingUserDeleter });

    await expect(runDelete(ourHousehold)).rejects.toBe(failure);
  });
});
