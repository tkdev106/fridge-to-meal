import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { HouseholdMemberCounterImpl } from '../../src/contexts/identity/infrastructure/HouseholdMemberCounterImpl.js';
import { UserDeleterImpl } from '../../src/contexts/identity/infrastructure/UserDeleterImpl.js';
import { countHouseholdMembers } from '../../src/contexts/identity/usecase/CountHouseholdMembers.js';
import type { DeleteUser } from '../../src/contexts/identity/usecase/DeleteUser.js';
import { deleteUser } from '../../src/contexts/identity/usecase/DeleteUser.js';
import { MealRepositoryImpl } from '../../src/contexts/meal/infrastructure/MealRepositoryImpl.js';
import { SuggestionRepositoryImpl } from '../../src/contexts/meal/infrastructure/SuggestionRepositoryImpl.js';
import { deleteHouseholdData } from '../../src/contexts/meal/usecase/DeleteHouseholdData.js';
import { StockItemRepositoryImpl } from '../../src/contexts/pantry/infrastructure/StockItemRepositoryImpl.js';
import { deleteHouseholdStockItems } from '../../src/contexts/pantry/usecase/DeleteHouseholdStockItems.js';
import type { HouseholdId } from '../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../src/shared/domain/HouseholdId.js';
import type { HouseholdTransaction } from '../../src/shared/infrastructure/db/HouseholdTransaction.js';
import { withHouseholdTransaction } from '../../src/shared/infrastructure/db/HouseholdTransaction.js';
import { countUser, insertUser } from '../support/db/AuthUsers.js';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import { insertHouseholdMember } from '../support/db/HouseholdMembers.js';
import type { HouseholdRowCounts } from '../support/db/HouseholdRows.js';
import { countHouseholdRows } from '../support/db/HouseholdRows.js';
import { insertChildRow, insertMeal } from '../support/db/MealRows.js';
import { insertSuggestion, insertSuggestionChildRow } from '../support/db/SuggestionRows.js';
import { withTransaction } from '../support/db/WithTransaction.js';

/**
 * 世帯のデータを消すユースケースを、ローカル Postgres の上で1トランザクションに包んで回す
 * （B-56a 規則8 / ADR-029 決定3(a) / ADR-059）。**`pnpm test:db` でだけ走る。**
 *
 * 本題は巻き戻しである。途中の口が投げたら、それより前に消した行も戻り、1行も消えない。
 * 単体テストでは記憶上の実装に巻き戻しが無いので、ここで本物のトランザクションを通して見る。
 *
 * 繋ぐのは `authenticator` だけ（所有者で繋ぐと RLS が素通りする。先行 `mealRepository.test.ts`）。
 * **世帯 ID と識別子はケースごとに固有の固定値を使い、使い回さない。** 先頭の並び（`b56a2000`）で
 * 他のファイルと分けてある。**後片付けはしない。**
 */

const rolledBackHousehold = householdIdOf('b56a2000-0001-4000-8000-000000000001');
const rolledBackMealId = 'b56a2000-0001-4000-8000-0000000000a1';
const rolledBackSuggestionId = 'b56a2000-0001-4000-8000-0000000000b1';

// B-56d: 利用者の削除が投げたときの巻き戻し。先頭の並び（`b56d2000`）で分けてある。
const userDeletionFailedHousehold = householdIdOf('b56d2000-0001-4000-8000-000000000001');
const userDeletionFailedMealId = 'b56d2000-0001-4000-8000-0000000000a1';
const userDeletionFailedSuggestionId = 'b56d2000-0001-4000-8000-0000000000b1';
const userDeletionFailedStockItemId = 'b56d2000-0001-4000-8000-0000000000c1';

// B-75b: 他のメンバーが居る世帯のアカウント削除。先頭の並び（`b75b2000`）で分けてある。
// 世帯 ID は作った人（参加の行なし）の利用者 ID と同じ（ADR-087 決定1）。
const sharedHouseholdCreator = 'b75b2000-0001-4000-8000-000000000001';
const sharedHouseholdMember = 'b75b2000-0001-4000-8000-000000000002';
const sharedMealId = 'b75b2000-0001-4000-8000-0000000000a1';
const sharedSuggestionId = 'b75b2000-0001-4000-8000-0000000000b1';
const sharedStockItemId = 'b75b2000-0001-4000-8000-0000000000c1';
const deletedMemberCreator = 'b75b2000-0002-4000-8000-000000000001';
const deletedMember = 'b75b2000-0002-4000-8000-000000000002';
const threeMemberCreator = 'b75b2000-0003-4000-8000-000000000001';
const leavingOfThreeMember = 'b75b2000-0003-4000-8000-000000000002';
const remainingOfThreeMember = 'b75b2000-0003-4000-8000-000000000003';
const failingDeletionCreator = 'b75b2000-0004-4000-8000-000000000001';
const failingDeletionMember = 'b75b2000-0004-4000-8000-000000000002';

// 1本の接続で複数のトランザクションを張る（先行 `mealRepository.test.ts`）。
const connection = postgres(APP_CONNECTION_STRING, { max: 1 });
const db = drizzle(connection);

// 行を直接置く・数える接続。`MealRows` / `SuggestionRows` は postgres の `TransactionSql` を取るため、
// drizzle の handle とは別に持つ。
const rowConnection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await connection.end();
  await rowConnection.end();
});

/** 置いた行数。献立と子3表・提案と子2表に1行ずつ。在庫の2表には置かない。 */
const placedRows: HouseholdRowCounts = {
  stock_items: 0,
  stock_item_names: 0,
  meals: 1,
  meal_ingredients: 1,
  cooking_steps: 1,
  cooking_records: 1,
  suggestions: 1,
  suggestion_entries: 1,
  pantry_snapshot_stock_items: 1,
};

/** 9表すべてに1行ずつ置いた行数（B-56d）。 */
const placedRowsInAllTables: HouseholdRowCounts = {
  stock_items: 1,
  stock_item_names: 1,
  meals: 1,
  meal_ingredients: 1,
  cooking_steps: 1,
  cooking_records: 1,
  suggestions: 1,
  suggestion_entries: 1,
  pantry_snapshot_stock_items: 1,
};

describe('世帯のデータを消すユースケース（1トランザクションの巻き戻し）', () => {
  it('途中の口が投げたら、世帯の献立も提案も1行も消えない', async () => {
    // B-56a 規則8 / ADR-029 決定3(a): 提案 → 献立 → 在庫の順に呼ぶので（規則6）、在庫の口が
    // 投げた時点で提案と献立は消えている。それが巻き戻しで戻ることを見る。
    await withTransaction(rowConnection, rolledBackHousehold, async (tx) => {
      const props = { mealId: rolledBackMealId, householdId: rolledBackHousehold };
      await insertMeal(tx, props);
      await insertChildRow(tx, 'meal_ingredients', props);
      await insertChildRow(tx, 'cooking_steps', props);
      await insertChildRow(tx, 'cooking_records', props);
      const suggestionProps = {
        suggestionId: rolledBackSuggestionId,
        householdId: rolledBackHousehold,
        mealId: rolledBackMealId,
      };
      await insertSuggestion(tx, suggestionProps);
      await insertSuggestionChildRow(tx, 'suggestion_entries', suggestionProps);
      await insertSuggestionChildRow(tx, 'pantry_snapshot_stock_items', suggestionProps);
    });
    const failure = new Error('在庫を消せなかった');

    const execution = withHouseholdTransaction(db, rolledBackHousehold, (tx) =>
      deleteHouseholdData({
        countHouseholdMembers: countHouseholdMembers({
          householdMemberCounter: new HouseholdMemberCounterImpl(tx),
        }),
        deleteHouseholdStockItems: async () => {
          throw failure;
        },
        deleteUser: deleteUser({ userDeleter: new UserDeleterImpl(tx) }),
        mealRepository: new MealRepositoryImpl(tx),
        suggestionRepository: new SuggestionRepositoryImpl(tx),
      })(rolledBackHousehold),
    );

    await expect(execution).rejects.toBe(failure);
    await expect(
      withTransaction(rowConnection, rolledBackHousehold, (tx) =>
        countHouseholdRows(tx, rolledBackHousehold),
      ),
    ).resolves.toEqual(placedRows);
  });

  it('利用者を消す口が投げたら、世帯の献立も提案も1行も消えない', async () => {
    // B-56d 設計書 規則5・6 / ADR-071 決定2: 利用者は最後に消すので、投げた時点で9表の行は
    // 消えている。それが巻き戻しで戻り、データだけ消えて利用者が残る状態を作らない。
    await withTransaction(rowConnection, userDeletionFailedHousehold, async (tx) => {
      await tx`
        insert into stock_items (id, household_id, name)
        values (${userDeletionFailedStockItemId}, ${userDeletionFailedHousehold}, 'にんじん')
      `;
      await tx`
        insert into stock_item_names (household_id, name)
        values (${userDeletionFailedHousehold}, 'にんじん')
      `;
      const props = { mealId: userDeletionFailedMealId, householdId: userDeletionFailedHousehold };
      await insertMeal(tx, props);
      await insertChildRow(tx, 'meal_ingredients', props);
      await insertChildRow(tx, 'cooking_steps', props);
      await insertChildRow(tx, 'cooking_records', props);
      const suggestionProps = {
        suggestionId: userDeletionFailedSuggestionId,
        householdId: userDeletionFailedHousehold,
        mealId: userDeletionFailedMealId,
      };
      await insertSuggestion(tx, suggestionProps);
      await insertSuggestionChildRow(tx, 'suggestion_entries', suggestionProps);
      await insertSuggestionChildRow(tx, 'pantry_snapshot_stock_items', suggestionProps);
    });
    const failure = new Error('利用者を消せなかった');

    const execution = withHouseholdTransaction(db, userDeletionFailedHousehold, (tx) =>
      deleteHouseholdData({
        countHouseholdMembers: countHouseholdMembers({
          householdMemberCounter: new HouseholdMemberCounterImpl(tx),
        }),
        deleteHouseholdStockItems: deleteHouseholdStockItems({
          stockItemRepository: new StockItemRepositoryImpl(tx),
        }),
        deleteUser: async () => {
          throw failure;
        },
        mealRepository: new MealRepositoryImpl(tx),
        suggestionRepository: new SuggestionRepositoryImpl(tx),
      })(userDeletionFailedHousehold),
    );

    await expect(execution).rejects.toBe(failure);
    await expect(
      withTransaction(rowConnection, userDeletionFailedHousehold, (tx) =>
        countHouseholdRows(tx, userDeletionFailedHousehold),
      ),
    ).resolves.toEqual(placedRowsInAllTables);
  });
});

/**
 * 作った人と参加者を置く（B-75b）。作った人は参加の行を持たず、参加者には作った人の世帯への
 * 参加の行を置く（先行 `householdMembership.test.ts`）。役を切り替える前の `authenticator` で置く。
 */
async function placeHousehold(creator: string, members: readonly string[]): Promise<void> {
  await insertUser(rowConnection, creator);
  for (const member of members) {
    await insertUser(rowConnection, member);
    await insertHouseholdMember(rowConnection, { userId: member, householdId: creator });
  }
}

/**
 * 本物の実装を1つの `tx` から組んだユースケース（B-75b 3周目 / 設計書 規則7）。
 * 利用者を消す口を差し替えるときだけ `deleteUserOf` を渡す。
 */
function deleteHouseholdDataIn(
  tx: HouseholdTransaction,
  deleteUserOf: (tx: HouseholdTransaction) => DeleteUser = (inner) =>
    deleteUser({ userDeleter: new UserDeleterImpl(inner) }),
) {
  return deleteHouseholdData({
    countHouseholdMembers: countHouseholdMembers({
      householdMemberCounter: new HouseholdMemberCounterImpl(tx),
    }),
    deleteHouseholdStockItems: deleteHouseholdStockItems({
      stockItemRepository: new StockItemRepositoryImpl(tx),
    }),
    deleteUser: deleteUserOf(tx),
    mealRepository: new MealRepositoryImpl(tx),
    suggestionRepository: new SuggestionRepositoryImpl(tx),
  });
}

/** 利用者のアカウント削除を、その利用者のクレームを張った1トランザクションで回す。 */
function deleteAccountOf(
  userId: string,
  deleteUserOf?: (tx: HouseholdTransaction) => DeleteUser,
): Promise<void> {
  return withHouseholdTransaction(db, userId, (tx, householdId: HouseholdId) =>
    deleteHouseholdDataIn(tx, deleteUserOf)(householdId),
  );
}

describe('他のメンバーが居る世帯のアカウント削除（B-75b / ADR-087 決定6）', () => {
  it('他のメンバーが居る世帯で参加者がアカウントを消しても、世帯の9表の行は1行も減らない', async () => {
    // 設計書 規則7 / FR-27 / ADR-087 決定6: 2人以上なら利用者だけを消し、世帯のデータは
    // 残ったメンバーのものとして残る。
    await placeHousehold(sharedHouseholdCreator, [sharedHouseholdMember]);
    await withTransaction(rowConnection, sharedHouseholdCreator, async (tx) => {
      await tx`
        insert into stock_items (id, household_id, name)
        values (${sharedStockItemId}, ${sharedHouseholdCreator}, 'にんじん')
      `;
      await tx`
        insert into stock_item_names (household_id, name)
        values (${sharedHouseholdCreator}, 'にんじん')
      `;
      const props = { mealId: sharedMealId, householdId: sharedHouseholdCreator };
      await insertMeal(tx, props);
      await insertChildRow(tx, 'meal_ingredients', props);
      await insertChildRow(tx, 'cooking_steps', props);
      await insertChildRow(tx, 'cooking_records', props);
      const suggestionProps = {
        suggestionId: sharedSuggestionId,
        householdId: sharedHouseholdCreator,
        mealId: sharedMealId,
      };
      await insertSuggestion(tx, suggestionProps);
      await insertSuggestionChildRow(tx, 'suggestion_entries', suggestionProps);
      await insertSuggestionChildRow(tx, 'pantry_snapshot_stock_items', suggestionProps);
    });

    await deleteAccountOf(sharedHouseholdMember);

    await expect(
      withTransaction(rowConnection, sharedHouseholdCreator, (tx) =>
        countHouseholdRows(tx, sharedHouseholdCreator),
      ),
    ).resolves.toEqual(placedRowsInAllTables);
  });

  it('他のメンバーが居る世帯で参加者がアカウントを消すと、その利用者は auth.users から居なくなる', async () => {
    // 設計書 規則7 / FR-27: 分岐しても利用者は必ず消す。
    await placeHousehold(deletedMemberCreator, [deletedMember]);

    await deleteAccountOf(deletedMember);

    await expect(countUser(rowConnection, deletedMember)).resolves.toBe(0);
  });

  it('参加者がアカウントを消すと、残った作った人から見た人数が1減る', async () => {
    // 設計書 規則8: 参加の行は外部キーで一緒に消え、残ったメンバーの人数はその分減る。
    await placeHousehold(threeMemberCreator, [leavingOfThreeMember, remainingOfThreeMember]);

    await deleteAccountOf(leavingOfThreeMember);

    await expect(
      withHouseholdTransaction(db, threeMemberCreator, (tx, householdId) =>
        new HouseholdMemberCounterImpl(tx).count(householdId),
      ),
    ).resolves.toBe(2);
  });

  it('他のメンバーが居る世帯で利用者を消す口が投げたら、利用者は auth.users に残る', async () => {
    // 設計書 7章4行目 / ADR-073 決定2: 包まずに伝え、トランザクションが全部戻す。
    await placeHousehold(failingDeletionCreator, [failingDeletionMember]);
    const failure = new Error('利用者を消せなかった');

    await expect(
      deleteAccountOf(failingDeletionMember, () => async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    await expect(countUser(rowConnection, failingDeletionMember)).resolves.toBe(1);
  });
});
