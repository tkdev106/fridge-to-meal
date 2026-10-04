import { drizzle } from 'drizzle-orm/postgres-js';
import type { Sql, TransactionSql } from 'postgres';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { HouseholdLeaverImpl } from '../../src/contexts/identity/infrastructure/HouseholdLeaverImpl.js';
import { HouseholdMemberCounterImpl } from '../../src/contexts/identity/infrastructure/HouseholdMemberCounterImpl.js';
import { householdIdOf } from '../../src/shared/domain/HouseholdId.js';
import { withHouseholdTransaction } from '../../src/shared/infrastructure/db/HouseholdTransaction.js';
import { insertUser } from '../support/db/AuthUsers.js';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import { insertHouseholdMember } from '../support/db/HouseholdMembers.js';
import type { HouseholdRowCounts } from '../support/db/HouseholdRows.js';
import { countHouseholdRows } from '../support/db/HouseholdRows.js';
import { insertChildRow, insertMeal } from '../support/db/MealRows.js';
import { insertSuggestion, insertSuggestionChildRow } from '../support/db/SuggestionRows.js';
import { withTransaction } from '../support/db/WithTransaction.js';

/**
 * 人数を返す関数 `private.household_member_count()` と、世帯を抜ける関数
 * `private.leave_household()` をローカル Postgres の上で確かめる（B-75 設計 規則1〜5・8 /
 * ADR-087 決定1・2・3・6 / ADR-071 決定1）。**`pnpm test:db` でだけ走る。**
 *
 * 繋ぐのは `authenticator` だけ。所有者（`postgres`）の接続を使うと権限が素通りし、
 * **権限が無くても緑になる**（B-07d 規則3）。利用者と参加の行を置くのは役を切り替える前の
 * `authenticator` に限る（`AuthUsers.ts` / `HouseholdMembers.ts`）。参加の表は読めないので、
 * 抜けた結果は `private.current_household_id()` と人数の関数を通して間接に見る。
 *
 * 「作った人」は参加の行を持たない利用者で、その世帯 ID は自分の利用者 ID と同じ（ADR-087 決定1）。
 *
 * **識別子はケースごとに固有の固定値を使い、使い回さない。** 先頭の並び（`b75a`）で
 * 他のファイルと分けてある。**後片付けはしない。** 権限の断りは `code` で見る（文言は見ない）。
 */

/** そのケースの利用者の識別子。`case` がケース、`index` がケースの中の利用者。 */
function userIdOf(caseNumber: number, index: number): string {
  const caseSegment = String(caseNumber).padStart(4, '0');
  const indexSegment = String(index).padStart(12, '0');
  return `b75a0000-${caseSegment}-4000-8000-${indexSegment}`;
}

/**
 * 出口の実装のケース（B-75b）の利用者の識別子。先頭の並び（`b75b1000`）で上の関数のケースと分ける。
 */
function implUserIdOf(caseNumber: number, index: number): string {
  const caseSegment = String(caseNumber).padStart(4, '0');
  const indexSegment = String(index).padStart(12, '0');
  return `b75b1000-${caseSegment}-4000-8000-${indexSegment}`;
}

// 1本の接続で複数のトランザクションを張る（先行 `currentHouseholdId.test.ts`）。
const connection = postgres(APP_CONNECTION_STRING, { max: 1 });

// 出口の実装に渡す drizzle の handle（先行 `userDeleter.test.ts`）。**接続を上と分ける** —
// drizzle は渡された接続の型の変換を書き換えるため、共有すると上のケースの `Date` の引数が通らなくなる。
const implConnection = postgres(APP_CONNECTION_STRING, { max: 1 });
const db = drizzle(implConnection);

// 行を直接置く接続。役を切り替えずに `authenticator` のまま使う。
const rowConnection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await connection.end();
  await rowConnection.end();
  await implConnection.end();
});

/**
 * `anon` に切り替えたトランザクション。`withTransaction` は `authenticated` に固定なので、
 * `anon` の形だけここに写す（先行 `currentHouseholdId.test.ts`）。クレームを張るのは「利用者の
 * クレームがあっても `anon` では断られる」ことを見るため。
 */
function withAnonTransaction<T>(
  sql: Sql,
  userId: string,
  body: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local role anon`;
    const claims = JSON.stringify({ sub: userId });
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    return body(tx);
  }) as Promise<T>;
}

type MemberCountRow = { member_count: number };
type LeftRow = { left: boolean };
type HouseholdRow = { household_id: string | null };
type FunctionRow = { schema: string };
type GranteeRow = { grantee: string };
type ConfigRow = { proconfig: string[] | null };

/** そのトランザクションのクレームで人数の関数を呼ぶ。 */
async function memberCount(tx: TransactionSql): Promise<number> {
  const [row] = await tx<MemberCountRow[]>`
    select private.household_member_count() as member_count
  `;
  return row?.member_count ?? -1;
}

/** そのトランザクションのクレームで抜ける関数を呼ぶ。 */
async function leaveHousehold(tx: TransactionSql): Promise<boolean | null> {
  const [row] = await tx<LeftRow[]>`select private.leave_household() as left`;
  return row?.left ?? null;
}

/** そのトランザクションのクレームで世帯を決める関数を呼ぶ。 */
async function currentHouseholdId(tx: TransactionSql): Promise<string | null> {
  const [row] = await tx<HouseholdRow[]>`
    select private.current_household_id() as household_id
  `;
  return row?.household_id ?? null;
}

function memberCountOf(userId: string): Promise<number> {
  return withTransaction(connection, userId, memberCount);
}

function leaveHouseholdOf(userId: string): Promise<boolean | null> {
  return withTransaction(connection, userId, leaveHousehold);
}

function currentHouseholdIdOf(userId: string): Promise<string | null> {
  return withTransaction(connection, userId, currentHouseholdId);
}

/**
 * 作った人と参加者を置く。作った人は参加の行を持たず、世帯 ID は作った人の利用者 ID。
 * 参加者には作った人の世帯への参加の行を置く。返り値は世帯 ID。
 */
async function placeHousehold(creator: string, members: readonly string[]): Promise<string> {
  await insertUser(rowConnection, creator);
  for (const member of members) {
    await insertUser(rowConnection, member);
    await insertHouseholdMember(rowConnection, { userId: member, householdId: creator });
  }
  return creator;
}

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

describe('人数を返す関数 private.household_member_count()', () => {
  it('参加の行が無く自分しか居ない利用者が呼ぶと、人数は 1 になる', async () => {
    const creator = userIdOf(1, 1);
    await placeHousehold(creator, []);

    // 設計 規則1 / ADR-087 決定1: 参加の行を持たない利用者は自分の ID の世帯に居る。
    await expect(memberCountOf(creator)).resolves.toBe(1);
  });

  it('参加者が呼ぶと、参加の行の無い作った人も数えて人数は 2 になる', async () => {
    const creator = userIdOf(2, 1);
    const member = userIdOf(2, 2);
    await placeHousehold(creator, [member]);

    // 設計 規則1: 作った人（行なし）を数え落とさない。
    await expect(memberCountOf(member)).resolves.toBe(2);
  });

  it('作った人が呼ぶと、自分と参加の行の数を合わせて人数は 3 になる', async () => {
    const creator = userIdOf(3, 1);
    const firstMember = userIdOf(3, 2);
    const secondMember = userIdOf(3, 3);
    await placeHousehold(creator, [firstMember, secondMember]);

    // 設計 規則1
    await expect(memberCountOf(creator)).resolves.toBe(3);
  });

  it('他の世帯の作った人と参加の行は数えない', async () => {
    const creator = userIdOf(4, 1);
    const otherCreator = userIdOf(4, 2);
    const otherMember = userIdOf(4, 3);
    await placeHousehold(creator, []);
    await placeHousehold(otherCreator, [otherMember]);

    // C-9 / 設計 規則1: 数えるのは自分の世帯だけ。
    await expect(memberCountOf(creator)).resolves.toBe(1);
  });

  it('作った人が抜けたあとは、その人を数えない', async () => {
    const creator = userIdOf(5, 1);
    const firstMember = userIdOf(5, 2);
    const secondMember = userIdOf(5, 3);
    await placeHousehold(creator, [firstMember, secondMember]);
    await leaveHouseholdOf(creator);

    // 設計 規則1・3: 抜けた作った人は参加の行を持ち、元の世帯の人数に入らない。
    await expect(memberCountOf(firstMember)).resolves.toBe(2);
  });

  it('作った人がアカウントを消したあとは、残った参加の行だけを数える', async () => {
    const creator = userIdOf(6, 1);
    const member = userIdOf(6, 2);
    await placeHousehold(creator, [member]);
    await withTransaction(connection, creator, (tx) => tx`select private.delete_own_account()`);

    // 設計 規則8: 作った人（行なし）が消えた世帯も、残った行だけで数える。
    await expect(memberCountOf(member)).resolves.toBe(1);
  });

  it('クレームを張らずに呼ぶと、例外にならず人数は 0 になる', async () => {
    // 設計 規則2 / ADR-029 理由(1): クレームが無ければ `auth.uid()` は null。例外にしない。
    await expect(withTransaction(connection, null, memberCount)).resolves.toBe(0);
  });

  it('anon に切り替えると呼べず、権限の不足で断られる', async () => {
    const caller = userIdOf(8, 1);

    const execution = withAnonTransaction(connection, caller, memberCount);

    // 設計 規則5 / ADR-087 決定3: `anon` には `execute` が無い。
    await expect(execution).rejects.toMatchObject({ code: '42501' });
  });
});

describe('世帯を抜ける関数 private.leave_household()', () => {
  it('2人の世帯の参加者が呼ぶと true が返る', async () => {
    const creator = userIdOf(9, 1);
    const member = userIdOf(9, 2);
    await placeHousehold(creator, [member]);

    // 設計 規則3: 人数が 2 以上なら抜けられる。
    await expect(leaveHouseholdOf(member)).resolves.toBe(true);
  });

  it('抜けた直後、同じトランザクションの世帯は元の世帯でも null でもない新しい ID になる', async () => {
    const creator = userIdOf(10, 1);
    const member = userIdOf(10, 2);
    const household = await placeHousehold(creator, [member]);

    const after = await withTransaction(connection, member, async (tx) => {
      await leaveHousehold(tx);
      return currentHouseholdId(tx);
    });

    // 設計 規則3・4 / FR-46: 新しい乱数の世帯 ID に移る。
    expect(after).not.toBeNull();
    expect(after).not.toBe(household);
  });

  it('抜けた直後の人数は 1 になる', async () => {
    const creator = userIdOf(12, 1);
    const member = userIdOf(12, 2);
    await placeHousehold(creator, [member]);

    const count = await withTransaction(connection, member, async (tx) => {
      await leaveHousehold(tx);
      return memberCount(tx);
    });

    // 設計 規則4 / ADR-087 結果4
    expect(count).toBe(1);
  });

  it('抜けた先の世帯にはデータが1行も無い', async () => {
    const creator = userIdOf(13, 1);
    const member = userIdOf(13, 2);
    await placeHousehold(creator, [member]);
    const newHousehold = await withTransaction(connection, member, async (tx) => {
      await leaveHousehold(tx);
      return currentHouseholdId(tx);
    });

    const counts = await withTransaction(connection, member, (tx) =>
      countHouseholdRows(tx, newHousehold ?? ''),
    );

    // 設計 規則3・4 / FR-46: 抜けた利用者は空の世帯に移る。データを持ち出さない。
    expect(counts).toEqual(emptyRows);
  });

  it('抜けても元の世帯の在庫・献立・提案は1行も減らず、残ったメンバーから見える', async () => {
    const creator = userIdOf(14, 1);
    const member = userIdOf(14, 2);
    const household = await placeHousehold(creator, [member]);
    const mealId = 'b75a0000-0014-4000-8000-0000000000a1';
    const suggestionId = 'b75a0000-0014-4000-8000-0000000000b1';
    const stockItemId = 'b75a0000-0014-4000-8000-0000000000c1';
    await withTransaction(connection, creator, async (tx) => {
      await tx`
        insert into stock_items (id, household_id, name)
        values (${stockItemId}, ${household}, 'にんじん')
      `;
      await tx`
        insert into stock_item_names (household_id, name)
        values (${household}, 'にんじん')
      `;
      const props = { mealId, householdId: household };
      await insertMeal(tx, props);
      await insertChildRow(tx, 'meal_ingredients', props);
      await insertChildRow(tx, 'cooking_steps', props);
      await insertChildRow(tx, 'cooking_records', props);
      const suggestionProps = { suggestionId, householdId: household, mealId };
      await insertSuggestion(tx, suggestionProps);
      await insertSuggestionChildRow(tx, 'suggestion_entries', suggestionProps);
      await insertSuggestionChildRow(tx, 'pantry_snapshot_stock_items', suggestionProps);
    });
    await leaveHouseholdOf(member);

    const counts = await withTransaction(connection, creator, (tx) =>
      countHouseholdRows(tx, household),
    );

    // 設計 規則3 / ADR-087 決定6: 在庫・献立・提案は1行も動かさない。
    expect(counts).toEqual(placedRowsInAllTables);
  });

  it('参加者が抜けると、残った作った人から見た人数が 1 減る', async () => {
    const creator = userIdOf(15, 1);
    const member = userIdOf(15, 2);
    await placeHousehold(creator, [member]);
    await leaveHouseholdOf(member);

    // 設計 規則1・3
    await expect(memberCountOf(creator)).resolves.toBe(1);
  });

  it('参加の行の無い作った人も、他のメンバーが居れば抜けられ、自分の ID ではない世帯に移る', async () => {
    const creator = userIdOf(16, 1);
    const member = userIdOf(16, 2);
    await placeHousehold(creator, [member]);

    const result = await withTransaction(connection, creator, async (tx) => {
      const left = await leaveHousehold(tx);
      const householdId = await currentHouseholdId(tx);
      return { left, householdId };
    });

    // 設計 規則3: 行が無ければ足す。自分の ID の世帯に留まると、抜けたことにならない。
    expect(result.left).toBe(true);
    expect(result.householdId).not.toBeNull();
    expect(result.householdId).not.toBe(creator);
  });

  it('自分しか居ない世帯で呼ぶと false が返る', async () => {
    const creator = userIdOf(17, 1);
    await placeHousehold(creator, []);

    // 設計 規則3 / FR-46: 自分しか居ない世帯からは抜けられない。
    await expect(leaveHouseholdOf(creator)).resolves.toBe(false);
  });

  it('自分しか居ない世帯で呼んでも、世帯は自分の ID のまま変わらない', async () => {
    const creator = userIdOf(18, 1);
    await placeHousehold(creator, []);
    await leaveHouseholdOf(creator);

    // 設計 規則3: 抜けられないときは何も書かない。
    await expect(currentHouseholdIdOf(creator)).resolves.toBe(creator);
  });

  it('抜けても、同じ世帯の他の参加者の世帯は変わらない', async () => {
    const creator = userIdOf(20, 1);
    const leavingMember = userIdOf(20, 2);
    const remainingMember = userIdOf(20, 3);
    const household = await placeHousehold(creator, [leavingMember, remainingMember]);
    await leaveHouseholdOf(leavingMember);

    // C-9 / 設計 規則3: 書き換えるのは自分の参加の行だけ。
    await expect(currentHouseholdIdOf(remainingMember)).resolves.toBe(household);
  });

  it('抜けても、他の世帯のメンバーの世帯と人数は変わらない', async () => {
    const creator = userIdOf(21, 1);
    const leavingMember = userIdOf(21, 2);
    const remainingMember = userIdOf(21, 3);
    const otherCreator = userIdOf(21, 4);
    const otherMember = userIdOf(21, 5);
    await placeHousehold(creator, [leavingMember, remainingMember]);
    const otherHousehold = await placeHousehold(otherCreator, [otherMember]);
    await leaveHouseholdOf(leavingMember);

    const observed = await withTransaction(connection, otherMember, async (tx) => ({
      householdId: await currentHouseholdId(tx),
      memberCount: await memberCount(tx),
    }));

    // C-9 / 設計 規則3
    expect(observed).toEqual({ householdId: otherHousehold, memberCount: 2 });
  });

  it('クレームを張らずに呼ぶと、例外にならず false が返る', async () => {
    // 設計 規則2 / ADR-029 理由(1): クレームが無ければ何も書かず false。例外にしない。
    await expect(withTransaction(connection, null, leaveHousehold)).resolves.toBe(false);
  });

  it('anon に切り替えると呼べず権限の不足で断られ、世帯は変わらない', async () => {
    const creator = userIdOf(24, 1);
    const member = userIdOf(24, 2);
    const household = await placeHousehold(creator, [member]);

    const execution = withAnonTransaction(connection, member, leaveHousehold);

    // 設計 規則5 / ADR-087 決定3: `anon` には `execute` が無い。
    await expect(execution).rejects.toMatchObject({ code: '42501' });
    // 例外だけでは「書けたうえで断られた」と見分けがつかない。世帯が動いていないことまで見る。
    await expect(currentHouseholdIdOf(member)).resolves.toBe(household);
  });
});

describe('2関数の置き場所と権限', () => {
  const functionNames = ['household_member_count', 'leave_household'];

  it.each(functionNames)(
    '%s の実行権を持つのは authenticated だけで、PUBLIC にも anon にも無い',
    async (functionName) => {
      // 先行 `currentHouseholdId.test.ts`。既定の権限（`proacl` が null）は PUBLIC に `execute` を
      // 与えるので、`acldefault` で補ってから展開する。所有者は比べない。grantee 0 は PUBLIC。
      const rows = await rowConnection<GranteeRow[]>`
        select case when acl.grantee = 0 then 'PUBLIC' else r.rolname end as grantee
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
        left join pg_roles r on r.oid = acl.grantee
        where n.nspname = 'private'
          and p.proname = ${functionName}
          and acl.privilege_type = 'EXECUTE'
          and acl.grantee <> p.proowner
        order by 1
      `;

      // 設計 規則5 / ADR-087 決定3
      expect(rows.map((row) => row.grantee)).toEqual(['authenticated']);
    },
  );

  it.each(functionNames)(
    '%s は private スキーマにだけあり、public には無い',
    async (functionName) => {
      const rows = await rowConnection<FunctionRow[]>`
      select n.nspname as schema
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.proname = ${functionName}
      order by 1
    `;

      // 設計 規則5 / ADR-071 決定1: API に公開するスキーマに置かない。
      expect(rows.map((row) => row.schema)).toEqual(['private']);
    },
  );

  it.each(functionNames)('%s は検索経路を空にして動く', async (functionName) => {
    const [row] = await rowConnection<ConfigRow[]>`
      select p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = ${functionName}
    `;

    // 正規化された文字列は版で変わりうるので、`search_path` の項目を引いて値が空であることを見る
    // （先行 `currentHouseholdId.test.ts`）。
    const entry = (row?.proconfig ?? []).find((item) => item.startsWith('search_path='));
    const value = entry?.slice('search_path='.length);

    // 設計 規則5 / ADR-071 理由(4): `security definer` なので検索経路に頼らない。
    expect(['', '""']).toContain(value);
  });
});

/**
 * 出口の実装を、本物の `withHouseholdTransaction` が張ったトランザクションで呼ぶ（B-75b 2周目 /
 * 設計書 規則11）。第2引数を渡せば、それをクレームの世帯の代わりに出口の引数として渡す —
 * 引数の世帯を SQL に渡さないことを見るため。
 */
function countWithImpl(userId: string, argumentHousehold?: string): Promise<number> {
  return withHouseholdTransaction(db, householdIdOf(userId), (tx, householdId) =>
    new HouseholdMemberCounterImpl(tx).count(
      argumentHousehold === undefined ? householdId : householdIdOf(argumentHousehold),
    ),
  );
}

function leaveWithImpl(userId: string, argumentHousehold?: string): Promise<boolean> {
  return withHouseholdTransaction(db, householdIdOf(userId), (tx, householdId) =>
    new HouseholdLeaverImpl(tx).leave(
      argumentHousehold === undefined ? householdId : householdIdOf(argumentHousehold),
    ),
  );
}

describe('人数の出口の実装 HouseholdMemberCounterImpl', () => {
  it('HouseholdMemberCounterImpl は2人の世帯の人数を数値の 2 で返す', async () => {
    const creator = implUserIdOf(1, 1);
    const member = implUserIdOf(1, 2);
    await placeHousehold(creator, [member]);

    // 設計書 規則11: 人数は数値で返す（文字列で返る `bigint` にしない）。
    await expect(countWithImpl(member)).resolves.toBe(2);
  });

  it('HouseholdMemberCounterImpl は引数に他の世帯を渡しても、クレームの世帯の人数を返す', async () => {
    const lone = implUserIdOf(2, 1);
    const otherCreator = implUserIdOf(2, 2);
    const firstOtherMember = implUserIdOf(2, 3);
    const secondOtherMember = implUserIdOf(2, 4);
    await placeHousehold(lone, []);
    const otherHousehold = await placeHousehold(otherCreator, [
      firstOtherMember,
      secondOtherMember,
    ]);

    // 設計書 規則11 / C-9: 引数の世帯は口の形のためにあり、数える世帯はクレームが決める。
    await expect(countWithImpl(lone, otherHousehold)).resolves.toBe(1);
  });
});

describe('抜ける出口の実装 HouseholdLeaverImpl', () => {
  it('HouseholdLeaverImpl は他のメンバーが居る世帯で true を返す', async () => {
    const creator = implUserIdOf(3, 1);
    const member = implUserIdOf(3, 2);
    await placeHousehold(creator, [member]);

    // 設計書 5章・規則3: 抜けたら true。
    await expect(leaveWithImpl(member)).resolves.toBe(true);
  });

  it('HouseholdLeaverImpl は自分しか居ない世帯で false を返す', async () => {
    const lone = implUserIdOf(4, 1);
    await placeHousehold(lone, []);

    // 設計書 5章・規則3: 自分しか居なくて何もしなかったら false。
    await expect(leaveWithImpl(lone)).resolves.toBe(false);
  });

  it('HouseholdLeaverImpl は引数に他のメンバーの居る世帯を渡しても、クレームの世帯が1人なら false を返す', async () => {
    const lone = implUserIdOf(5, 1);
    const otherCreator = implUserIdOf(5, 2);
    const otherMember = implUserIdOf(5, 3);
    await placeHousehold(lone, []);
    const otherHousehold = await placeHousehold(otherCreator, [otherMember]);

    const left = await leaveWithImpl(lone, otherHousehold);

    // 設計書 規則11 / C-9: 抜けるかどうかはクレームの世帯が決め、引数の世帯は動かない。
    expect(left).toBe(false);
    await expect(memberCountOf(otherMember)).resolves.toBe(2);
  });
});
