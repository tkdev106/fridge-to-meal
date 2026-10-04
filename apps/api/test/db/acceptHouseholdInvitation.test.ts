import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { HouseholdJoinerImpl } from '../../src/contexts/identity/infrastructure/HouseholdJoinerImpl.js';
import { HouseholdMemberCounterImpl } from '../../src/contexts/identity/infrastructure/HouseholdMemberCounterImpl.js';
import { countHouseholdMembers } from '../../src/contexts/identity/usecase/CountHouseholdMembers.js';
import { joinHousehold } from '../../src/contexts/identity/usecase/JoinHousehold.js';
import { MealRepositoryImpl } from '../../src/contexts/meal/infrastructure/MealRepositoryImpl.js';
import { SuggestionRepositoryImpl } from '../../src/contexts/meal/infrastructure/SuggestionRepositoryImpl.js';
import { acceptHouseholdInvitation } from '../../src/contexts/meal/usecase/AcceptHouseholdInvitation.js';
import { StockItemRepositoryImpl } from '../../src/contexts/pantry/infrastructure/StockItemRepositoryImpl.js';
import { deleteHouseholdStockItems } from '../../src/contexts/pantry/usecase/DeleteHouseholdStockItems.js';
import type { HouseholdId } from '../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../src/shared/domain/HouseholdId.js';
import { withHouseholdTransaction } from '../../src/shared/infrastructure/db/HouseholdTransaction.js';
import { insertUser } from '../support/db/AuthUsers.js';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import { insertHouseholdInvitation } from '../support/db/HouseholdInvitations.js';
import { insertHouseholdMember } from '../support/db/HouseholdMembers.js';
import type { HouseholdRowCounts } from '../support/db/HouseholdRows.js';
import { countHouseholdRows } from '../support/db/HouseholdRows.js';
import { insertChildRow, insertMeal } from '../support/db/MealRows.js';
import { insertSuggestion, insertSuggestionChildRow } from '../support/db/SuggestionRows.js';
import { withTransaction } from '../support/db/WithTransaction.js';

/**
 * 招待で参加するユースケースを、ローカル Postgres の上で本物の実装から組み、1トランザクションに
 * 包んで回す（B-74 設計書 規則9〜11 / FR-45 / ADR-087 決定5 / ADR-029 決定3(a)）。
 * **`pnpm test:db` でだけ走る。**
 *
 * 本題は2つ — データを消すのが参加より先であること（規則10。後に消すと参加先のデータが消える）と、
 * 断られたら消したデータが巻き戻しで戻ること（規則11）。単体テストでは記憶上の実装に世帯の
 * 切り替わりも巻き戻しも無いので、ここで本物のトランザクションを通して見る。
 *
 * 繋ぐのは `authenticator` だけ（所有者で繋ぐと RLS が素通りする。先行 `deleteHouseholdData.test.ts`）。
 * 「作った人」は参加の行を持たない利用者で、その世帯 ID は自分の利用者 ID と同じ（ADR-087 決定1）。
 * **識別子とトークンはケースごとに固有の固定値を使い、使い回さない。** 先頭の並び（`b74c`）で
 * 他のファイルと分けてある。**後片付けはしない。**
 */

/** そのケースの利用者の識別子。`case` がケース、`index` がケースの中の利用者。 */
function userIdOf(caseNumber: number, index: number): string {
  const caseSegment = String(caseNumber).padStart(4, '0');
  const indexSegment = String(index).padStart(12, '0');
  return `b74c0000-${caseSegment}-4000-8000-${indexSegment}`;
}

/** 直接置く招待のトークン。先頭の並び（`b74c9000`）で利用者の識別子と分ける。 */
function invitationTokenOf(caseNumber: number): string {
  const caseSegment = String(caseNumber).padStart(4, '0');
  return `b74c9000-${caseSegment}-4000-8000-000000000001`;
}

/** 9表に置く行の識別子。`index` はケースの中の世帯、`kind` は `a`（献立）・`b`（提案）・`c`（在庫品）。 */
function rowIdOf(caseNumber: number, index: number, kind: 'a' | 'b' | 'c'): string {
  const caseSegment = String(caseNumber).padStart(4, '0');
  return `b74c1000-${caseSegment}-4000-8000-00000000${index}0${kind}1`;
}

// ユースケースに渡す drizzle の handle。
const connection = postgres(APP_CONNECTION_STRING, { max: 1 });
const db = drizzle(connection);

// 行を直接置く・数える接続。`MealRows` / `SuggestionRows` は postgres の `TransactionSql` を取るため、
// drizzle の handle とは別に持つ。
const rowConnection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await connection.end();
  await rowConnection.end();
});

/** 9表すべてに1行ずつ置いた行数（先行 `deleteHouseholdData.test.ts`）。 */
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

/** 9表すべてに行が無い行数。 */
const emptyRows: HouseholdRowCounts = {
  stock_items: 0,
  stock_item_names: 0,
  meals: 0,
  meal_ingredients: 0,
  cooking_steps: 0,
  cooking_records: 0,
  suggestions: 0,
  suggestion_entries: 0,
  pantry_snapshot_stock_items: 0,
};

/** 参加の行を持たない利用者（自分の ID の世帯の作った人）を置く。返り値は世帯 ID。 */
async function placeLoneUser(userId: string): Promise<string> {
  await insertUser(rowConnection, userId);
  return userId;
}

/**
 * 世帯のデータの9表すべてに、その世帯の行を1行ずつ置く（先行 `householdInvitation.test.ts`）。
 * `owner` はその世帯に居る利用者で、そのクレームで置く。
 */
async function placeHouseholdData(
  caseNumber: number,
  index: number,
  owner: string,
  householdId: string,
): Promise<void> {
  const mealId = rowIdOf(caseNumber, index, 'a');
  const suggestionId = rowIdOf(caseNumber, index, 'b');
  const stockItemId = rowIdOf(caseNumber, index, 'c');
  await withTransaction(rowConnection, owner, async (tx) => {
    await tx`
      insert into stock_items (id, household_id, name)
      values (${stockItemId}, ${householdId}, 'にんじん')
    `;
    await tx`
      insert into stock_item_names (household_id, name)
      values (${householdId}, 'にんじん')
    `;
    const props = { mealId, householdId };
    await insertMeal(tx, props);
    await insertChildRow(tx, 'meal_ingredients', props);
    await insertChildRow(tx, 'cooking_steps', props);
    await insertChildRow(tx, 'cooking_records', props);
    const suggestionProps = { suggestionId, householdId, mealId };
    await insertSuggestion(tx, suggestionProps);
    await insertSuggestionChildRow(tx, 'suggestion_entries', suggestionProps);
    await insertSuggestionChildRow(tx, 'pantry_snapshot_stock_items', suggestionProps);
  });
}

/** その世帯への使える招待（期限は1時間後）の行を置き、トークンを返す。 */
async function placeInvitation(token: string, householdId: string): Promise<string> {
  await insertHouseholdInvitation(rowConnection, { token, householdId, expiresIn: '1 hour' });
  return token;
}

/** その世帯の9表の行数を、その世帯に居る利用者 `viewer` のクレームで読む。 */
function householdRowsSeenBy(viewer: string, householdId: string): Promise<HouseholdRowCounts> {
  return withTransaction(rowConnection, viewer, (tx) => countHouseholdRows(tx, householdId));
}

/**
 * 本物の実装を1つの `tx` から組んだユースケースで、その利用者のクレームを張った1トランザクションの
 * 中で参加する（先行 `deleteHouseholdData.test.ts` の `deleteAccountOf`）。
 */
function acceptOf(userId: string, token: string): Promise<void> {
  return withHouseholdTransaction(db, householdIdOf(userId), (tx, householdId: HouseholdId) =>
    acceptHouseholdInvitation({
      countHouseholdMembers: countHouseholdMembers({
        householdMemberCounter: new HouseholdMemberCounterImpl(tx),
      }),
      deleteHouseholdStockItems: deleteHouseholdStockItems({
        stockItemRepository: new StockItemRepositoryImpl(tx),
      }),
      joinHousehold: joinHousehold({ householdJoiner: new HouseholdJoinerImpl(tx) }),
      mealRepository: new MealRepositoryImpl(tx),
      suggestionRepository: new SuggestionRepositoryImpl(tx),
    })(householdId, token),
  );
}

describe('招待で参加するユースケース（1トランザクション）', () => {
  it('1人の利用者が参加しても、参加先の9表の行数は変わらない', async () => {
    // 設計書 規則10 / ADR-087 決定5: 消すのは参加より先。後に消すと参加先のデータが消える。
    const creator = userIdOf(1, 1);
    const joiner = userIdOf(1, 2);
    const invitedHousehold = await placeLoneUser(creator);
    const joinerHousehold = await placeLoneUser(joiner);
    await placeHouseholdData(1, 1, creator, invitedHousehold);
    await placeHouseholdData(1, 2, joiner, joinerHousehold);
    const token = await placeInvitation(invitationTokenOf(1), invitedHousehold);

    await acceptOf(joiner, token);

    await expect(householdRowsSeenBy(creator, invitedHousehold)).resolves.toEqual(
      placedRowsInAllTables,
    );
  });

  it('1人の利用者が参加すると、元の世帯の行は9表のどれにも残らない', async () => {
    // 設計書 規則9 / FR-45 / ADR-087 決定5: 自分しか居なければ `DELETE /household-data` と同じ手段で消す。
    const creator = userIdOf(2, 1);
    const joiner = userIdOf(2, 2);
    const viewer = userIdOf(2, 3);
    const invitedHousehold = await placeLoneUser(creator);
    const joinerHousehold = await placeLoneUser(joiner);
    await placeHouseholdData(2, 2, joiner, joinerHousehold);
    const token = await placeInvitation(invitationTokenOf(2), invitedHousehold);

    await acceptOf(joiner, token);

    // 参加した利用者の世帯は参加先に変わるので、元の世帯の行は RLS の上で誰からも見えない。
    // 見るためだけの利用者を元の世帯に参加させてから数える。
    await insertUser(rowConnection, viewer);
    await insertHouseholdMember(rowConnection, { userId: viewer, householdId: joinerHousehold });
    await expect(householdRowsSeenBy(viewer, joinerHousehold)).resolves.toEqual(emptyRows);
  });

  it('使えない招待で断られたら、1人の世帯の9表の行は1行も減らず、例外は joinHousehold.invalidInvitation である', async () => {
    // 設計書 規則11・10章3行目: 消したあとに断られても、例外がトランザクションを巻き戻す。
    const joiner = userIdOf(3, 1);
    const joinerHousehold = await placeLoneUser(joiner);
    await placeHouseholdData(3, 1, joiner, joinerHousehold);

    const execution = acceptOf(joiner, invitationTokenOf(3));

    await expect(execution).rejects.toMatchObject({
      name: 'IdentityRuleViolation',
      rule: 'joinHousehold.invalidInvitation',
    });
    await expect(householdRowsSeenBy(joiner, joinerHousehold)).resolves.toEqual(
      placedRowsInAllTables,
    );
  });
});
