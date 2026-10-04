import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { UserDeleterImpl } from '../../src/contexts/identity/infrastructure/UserDeleterImpl.js';
import { createStockItem } from '../../src/contexts/pantry/domain/entity/StockItem.js';
import { stockItemIdOf } from '../../src/contexts/pantry/domain/value/StockItemId.js';
import { StockItemRepositoryImpl } from '../../src/contexts/pantry/infrastructure/StockItemRepositoryImpl.js';
import { householdIdOf } from '../../src/shared/domain/HouseholdId.js';
import { withHouseholdTransaction } from '../../src/shared/infrastructure/db/HouseholdTransaction.js';
import { countUser, insertUser } from '../support/db/AuthUsers.js';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import { insertHouseholdMember } from '../support/db/HouseholdMembers.js';

/**
 * `withHouseholdTransaction` が、渡された利用者から世帯を引いて本体に渡すこと
 * （B-73 設計 規則5・6・8・11 / ADR-087 決定1・2 / C-9）。**`pnpm test:db` でだけ走る。**
 *
 * 繋ぐのは `authenticator` だけ。所有者（`postgres`）の接続を使うと行レベルセキュリティが
 * 素通りし、**世帯の分離が無くても緑になる。** 利用者と参加の行は役を切り替える前の
 * `authenticator` で置く（`AuthUsers.ts` / `HouseholdMembers.ts`）。
 *
 * **識別子はケースごとに固有の固定値を使い、使い回さない。** 先頭の並び（`b73c`）で
 * 他のファイルと分けてある。**後片付けはしない。**
 */

const joinedUser = 'b73c0000-0001-4000-8000-000000000001';
const joinedHousehold = householdIdOf('b73c0000-0001-4000-8000-000000000002');

const loneUser = 'b73c0000-0002-4000-8000-000000000001';

const registeringUser = 'b73c0000-0003-4000-8000-000000000001';
const registeredHousehold = householdIdOf('b73c0000-0003-4000-8000-000000000002');
const registeredStockItemId = stockItemIdOf('b73c0000-0003-4000-8000-0000000000f1');

const deletingUser = 'b73c0000-0004-4000-8000-000000000001';
const ownerOfJoinedHousehold = 'b73c0000-0004-4000-8000-000000000002';

// 1本の接続で複数のトランザクションを張る（先行 `stockItemRepository.test.ts`）。
const connection = postgres(APP_CONNECTION_STRING, { max: 1 });
const db = drizzle(connection);

// 利用者と参加の行を置く・数える接続。役を切り替えずに `authenticator` のまま使う。
const rowConnection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await connection.end();
  await rowConnection.end();
});

/** 利用者を置き、その利用者を世帯に参加させる。本題ではない下ごしらえ。 */
async function joinHousehold(userId: string, householdId: string): Promise<void> {
  await insertUser(rowConnection, userId);
  await insertHouseholdMember(rowConnection, { userId, householdId });
}

describe('withHouseholdTransaction（利用者から世帯を引く）', () => {
  it('参加の行がある利用者を渡すと、本体には参加先の世帯が渡る', async () => {
    // 規則8 / ADR-087 決定2: 本体に渡るのは、同じトランザクションで引いた参加先の世帯である。
    await joinHousehold(joinedUser, joinedHousehold);

    const received = await withHouseholdTransaction(db, joinedUser, async (_tx, householdId) =>
      Promise.resolve(householdId),
    );

    expect(received).toBe('b73c0000-0001-4000-8000-000000000002');
  });

  it('参加の行が無い利用者を渡すと、本体には利用者自身の ID が世帯として渡る', async () => {
    // 規則5・6 / ADR-087 決定1: 参加していない利用者の世帯は、今と同じ自分の ID である。
    const received = await withHouseholdTransaction(db, loneUser, async (_tx, householdId) =>
      Promise.resolve(householdId),
    );

    expect(received).toBe('b73c0000-0002-4000-8000-000000000001');
  });

  it('参加の行がある利用者の本体で登録した在庫品は、参加先の世帯の在庫品として持ち主から読める', async () => {
    // 規則8 / C-9: 受け取った世帯で書いた行は参加先の世帯のものになり、持ち主のトランザクションから見える。
    await joinHousehold(registeringUser, registeredHousehold);
    await withHouseholdTransaction(db, registeringUser, (tx, householdId) =>
      new StockItemRepositoryImpl(tx).save(
        householdId,
        createStockItem({
          id: registeredStockItemId,
          householdId,
          name: 'にんじん',
          ingredientId: null,
          amount: null,
          expiryDate: null,
          useForMeals: true,
        }),
      ),
    );

    const readByOwner = await withHouseholdTransaction(db, registeredHousehold, (tx, householdId) =>
      new StockItemRepositoryImpl(tx).findById(householdId, registeredStockItemId),
    );

    expect(readByOwner).toMatchObject({
      id: 'b73c0000-0003-4000-8000-0000000000f1',
      householdId: 'b73c0000-0003-4000-8000-000000000002',
    });
  });

  it('参加した利用者の本体でアカウントを消すと、消えるのは利用者本人で、参加先の持ち主は残る', async () => {
    // 規則8・11 / ADR-087 決定2・6: 消す相手はクレームの利用者（auth.uid()）であり、引いた世帯ではない。
    await insertUser(rowConnection, ownerOfJoinedHousehold);
    await joinHousehold(deletingUser, ownerOfJoinedHousehold);

    await withHouseholdTransaction(db, deletingUser, (tx, householdId) =>
      new UserDeleterImpl(tx).delete(householdId),
    );

    await expect(
      Promise.all([
        countUser(rowConnection, deletingUser),
        countUser(rowConnection, ownerOfJoinedHousehold),
      ]),
    ).resolves.toEqual([0, 1]);
  });
});
