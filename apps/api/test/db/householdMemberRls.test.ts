import type { TransactionSql } from 'postgres';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { insertUser } from '../support/db/AuthUsers.js';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import { insertHouseholdMember } from '../support/db/HouseholdMembers.js';
import type { HouseholdDataTable } from '../support/db/HouseholdRows.js';
import { HOUSEHOLD_DATA_TABLES } from '../support/db/HouseholdRows.js';
import type { MealTable } from '../support/db/MealRows.js';
import {
  MEAL_TABLES,
  insertRow as insertMealRow,
  prepareParentMeal,
  selectHouseholdIds as selectMealHouseholdIds,
} from '../support/db/MealRows.js';
import type { SuggestionTable } from '../support/db/SuggestionRows.js';
import {
  SUGGESTION_TABLES,
  insertSuggestionRow,
  prepareParentSuggestion,
  selectSuggestionHouseholdIds,
} from '../support/db/SuggestionRows.js';
import { withTransaction } from '../support/db/WithTransaction.js';

/**
 * 参加した利用者（参加の行 U → H がある利用者）から見た、世帯のデータの9表の行レベル
 * セキュリティ（B-73 設計 規則4・7 / ADR-087 決定2 / FR-26 / C-9 / NFR-09）。
 * **`pnpm test:db` でだけ走る。**
 *
 * **9表それぞれで見る** — 1表だけにすると、述語の差し替え漏れが素通りする（設計 11章）。
 * 子表の行を置くときは、親を同じ世帯に置く（複合外部キーが親を指す）。
 *
 * 繋ぐのは `authenticator` だけ。所有者（`postgres`）の接続を使うと行レベルセキュリティが
 * 素通りし、**RLS が無くても緑になる。** 利用者と参加の行は役を切り替える前の
 * `authenticator` で置く（`AuthUsers.ts` / `HouseholdMembers.ts`）。
 *
 * **識別子はケースと表ごとに固有の固定値を使い、使い回さない。** 先頭の並び（`b73b`）で
 * 他のファイルと分けてある。**後片付けはしない。**
 */

// 1本の接続で複数のトランザクションを張る（先行 `stockItemsRls.test.ts`）。
const connection = postgres(APP_CONNECTION_STRING, { max: 1 });

// 行を直接置く接続。役を切り替えずに `authenticator` のまま使う。
const rowConnection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await connection.end();
  await rowConnection.end();
});

/**
 * ケースと表ごとに固有の識別子。`role` は 1 = 参加する利用者、2 = 参加先の世帯、3 = 行の識別子。
 * 表は `HOUSEHOLD_DATA_TABLES` の並びの位置で分ける。
 */
function sampleIdOf(caseNumber: number, table: HouseholdDataTable, role: 1 | 2 | 3): string {
  const tableNumber = HOUSEHOLD_DATA_TABLES.indexOf(table);
  return `b73b000${caseNumber}-000${tableNumber}-4000-8000-00000000000${role}`;
}

function isMealTable(table: HouseholdDataTable): table is MealTable {
  return (MEAL_TABLES as readonly string[]).includes(table);
}

function isSuggestionTable(table: HouseholdDataTable): table is SuggestionTable {
  return (SUGGESTION_TABLES as readonly string[]).includes(table);
}

/**
 * 子表のときだけ親を置く（献立の子表なら献立、提案の子表なら提案）。親は本題ではない。
 * 親の識別子は行の識別子と同じものを使う。
 */
async function prepareParent(
  tx: TransactionSql,
  table: HouseholdDataTable,
  rowId: string,
  householdId: string,
): Promise<void> {
  if (isMealTable(table)) {
    await prepareParentMeal(tx, table, { mealId: rowId, householdId });
    return;
  }
  if (isSuggestionTable(table)) {
    await prepareParentSuggestion(tx, table, { suggestionId: rowId, householdId });
  }
}

/**
 * その表の行を1件置く（親はここでは置かない）。`stock_item_names` は主キーが（世帯, 名称）なので、
 * 行の識別子を名称に使う。
 */
async function insertTableRow(
  tx: TransactionSql,
  table: HouseholdDataTable,
  rowId: string,
  householdId: string,
): Promise<void> {
  if (isMealTable(table)) {
    await insertMealRow(tx, table, { mealId: rowId, householdId });
    return;
  }
  if (isSuggestionTable(table)) {
    await insertSuggestionRow(tx, table, { suggestionId: rowId, householdId });
    return;
  }
  if (table === 'stock_items') {
    await tx`
      insert into stock_items (id, household_id, name)
      values (${rowId}, ${householdId}, 'にんじん')
    `;
    return;
  }
  await tx`
    insert into stock_item_names (household_id, name)
    values (${householdId}, ${rowId})
  `;
}

/** 親（子表のとき）とその表の行を、同じ世帯に置く。 */
async function insertRowWithParent(
  tx: TransactionSql,
  table: HouseholdDataTable,
  rowId: string,
  householdId: string,
): Promise<void> {
  await prepareParent(tx, table, rowId, householdId);
  await insertTableRow(tx, table, rowId, householdId);
}

/** 行の識別子で絞って、見える行の世帯 ID を読む。表全体を読む主張はしない。 */
async function selectHouseholdIdsOf(
  tx: TransactionSql,
  table: HouseholdDataTable,
  rowId: string,
): Promise<{ household_id: string }[]> {
  if (isMealTable(table)) return [...(await selectMealHouseholdIds(tx, table, rowId))];
  if (isSuggestionTable(table)) {
    return [...(await selectSuggestionHouseholdIds(tx, table, rowId))];
  }
  if (table === 'stock_items') {
    return [
      ...(await tx<{ household_id: string }[]>`
        select household_id from stock_items where id = ${rowId}
      `),
    ];
  }
  return [
    ...(await tx<{ household_id: string }[]>`
      select household_id from stock_item_names where name = ${rowId}
    `),
  ];
}

/** 利用者を置き、参加先の世帯への参加の行を置く。 */
async function joinHousehold(userId: string, householdId: string): Promise<void> {
  await insertUser(rowConnection, userId);
  await insertHouseholdMember(rowConnection, { userId, householdId });
}

const eachTable = it.each(HOUSEHOLD_DATA_TABLES);

describe('参加した利用者から見た世帯のデータの9表', () => {
  eachTable('%s: 参加した利用者は、参加先の世帯の行を読める', async (table) => {
    const memberUser = sampleIdOf(1, table, 1);
    const joinedHousehold = sampleIdOf(1, table, 2);
    const rowId = sampleIdOf(1, table, 3);
    // 参加先の持ち主（参加の行なし）のクレームで、参加先の世帯の行を置く。
    await withTransaction(connection, joinedHousehold, (tx) =>
      insertRowWithParent(tx, table, rowId, joinedHousehold),
    );
    await joinHousehold(memberUser, joinedHousehold);

    const visibleRows = await withTransaction(connection, memberUser, (tx) =>
      selectHouseholdIdsOf(tx, table, rowId),
    );

    // ADR-087 決定2 / FR-26 / 設計 規則4・7
    expect(visibleRows).toEqual([{ household_id: joinedHousehold }]);
  });

  eachTable(
    '%s: 参加した利用者には、参加前に置いた自分の利用者 ID の世帯の行が見えない',
    async (table) => {
      const memberUser = sampleIdOf(2, table, 1);
      const joinedHousehold = sampleIdOf(2, table, 2);
      const rowId = sampleIdOf(2, table, 3);
      await insertUser(rowConnection, memberUser);
      // 参加の行が無いうちは、世帯は自分の利用者 ID（ADR-087 決定1）。
      await withTransaction(connection, memberUser, (tx) =>
        insertRowWithParent(tx, table, rowId, memberUser),
      );
      await insertHouseholdMember(rowConnection, {
        userId: memberUser,
        householdId: joinedHousehold,
      });

      const visibleRows = await withTransaction(connection, memberUser, (tx) =>
        selectHouseholdIdsOf(tx, table, rowId),
      );

      // C-9 / ADR-087 決定2 / 設計 規則7: 世帯は1つだけ。参加したら元の世帯の行は見えない。
      expect(visibleRows).toEqual([]);
    },
  );

  eachTable('%s: 参加した利用者が作った参加先の行は、参加先の持ち主から見える', async (table) => {
    const memberUser = sampleIdOf(3, table, 1);
    const joinedHousehold = sampleIdOf(3, table, 2);
    const rowId = sampleIdOf(3, table, 3);
    // 親は参加先の持ち主（参加の行なし）が置く。本題は表そのものの行である。
    await withTransaction(connection, joinedHousehold, (tx) =>
      prepareParent(tx, table, rowId, joinedHousehold),
    );
    await joinHousehold(memberUser, joinedHousehold);

    await withTransaction(connection, memberUser, (tx) =>
      insertTableRow(tx, table, rowId, joinedHousehold),
    );
    const rowsVisibleToOwner = await withTransaction(connection, joinedHousehold, (tx) =>
      selectHouseholdIdsOf(tx, table, rowId),
    );

    // ADR-087 決定2 / FR-26 / 設計 規則4・7: 参加した利用者の書き込みは参加先の世帯の行になる。
    expect(rowsVisibleToOwner).toEqual([{ household_id: joinedHousehold }]);
  });

  eachTable('%s: 参加した利用者は、自分の利用者 ID を世帯 ID に持つ行を作れない', async (table) => {
    const memberUser = sampleIdOf(4, table, 1);
    const joinedHousehold = sampleIdOf(4, table, 2);
    const rowId = sampleIdOf(4, table, 3);
    await insertUser(rowConnection, memberUser);
    // 子表の親は、参加の行が無いうち（世帯 = 自分の利用者 ID）に同じ世帯へ置いておく。
    await withTransaction(connection, memberUser, (tx) =>
      prepareParent(tx, table, rowId, memberUser),
    );
    await insertHouseholdMember(rowConnection, {
      userId: memberUser,
      householdId: joinedHousehold,
    });

    const execution = withTransaction(connection, memberUser, (tx) =>
      insertTableRow(tx, table, rowId, memberUser),
    );

    // C-9 / ADR-087 決定2 / 設計 規則7: 書ける世帯は関数が返す世帯だけ。
    await expect(execution).rejects.toMatchObject({ code: '42501' });
  });
});
