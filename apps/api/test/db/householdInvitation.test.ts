import type { Sql, TransactionSql } from 'postgres';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { insertUser } from '../support/db/AuthUsers.js';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import { insertHouseholdInvitation, selectExpiresIn } from '../support/db/HouseholdInvitations.js';
import { insertHouseholdMember } from '../support/db/HouseholdMembers.js';
import type { HouseholdRowCounts } from '../support/db/HouseholdRows.js';
import { countHouseholdRows } from '../support/db/HouseholdRows.js';
import { insertChildRow, insertMeal } from '../support/db/MealRows.js';
import { insertSuggestion, insertSuggestionChildRow } from '../support/db/SuggestionRows.js';
import { withTransaction } from '../support/db/WithTransaction.js';

/**
 * 招待を作る関数 `private.create_household_invitation()` と、招待で参加する関数
 * `private.join_household(invitation_token text)` をローカル Postgres の上で確かめる
 * （B-74 設計 規則1〜8 / FR-44 / FR-45 / ADR-087 決定3・4・5 / ADR-071 決定1）。
 * **`pnpm test:db` でだけ走る。**
 *
 * 繋ぐのは `authenticator` だけ。所有者（`postgres`）の接続を使うと権限が素通りし、
 * **権限が無くても緑になる**（B-07d 規則3）。利用者・参加の行・招待の行を置くのは役を切り替える前の
 * `authenticator` に限る（`AuthUsers.ts` / `HouseholdMembers.ts` / `HouseholdInvitations.ts`）。
 * 参加の表は読めないので、参加の結果は `private.current_household_id()` と人数の関数を通して間接に見る。
 *
 * 「作った人」は参加の行を持たない利用者で、その世帯 ID は自分の利用者 ID と同じ（ADR-087 決定1）。
 * 2周目（参加）の招待は、作る関数を通さず行を直接置く — 参加の振る舞いを作る関数の出来から切り離すため。
 *
 * **識別子とトークンはケースごとに固有の固定値を使い、使い回さない。** 先頭の並び（`b74a`）で
 * 他のファイルと分けてある。**後片付けはしない。** 権限の断りは `code` で見る（文言は見ない）。
 */

/** そのケースの利用者の識別子。`case` がケース、`index` がケースの中の利用者。 */
function userIdOf(caseNumber: number, index: number): string {
  const caseSegment = String(caseNumber).padStart(4, '0');
  const indexSegment = String(index).padStart(12, '0');
  return `b74a0000-${caseSegment}-4000-8000-${indexSegment}`;
}

/** 直接置く招待のトークン。先頭の並び（`b74a9000`）で利用者の識別子と分ける。 */
function invitationTokenOf(caseNumber: number, index: number): string {
  const caseSegment = String(caseNumber).padStart(4, '0');
  const indexSegment = String(index).padStart(12, '0');
  return `b74a9000-${caseSegment}-4000-8000-${indexSegment}`;
}

/** 9表に置く行の識別子。`kind` は `a`（献立）・`b`（提案）・`c`（在庫品）。 */
function rowIdOf(caseNumber: number, kind: 'a' | 'b' | 'c'): string {
  const caseSegment = String(caseNumber).padStart(4, '0');
  return `b74a1000-${caseSegment}-4000-8000-0000000000${kind}1`;
}

// 1本の接続で複数のトランザクションを張る（先行 `householdMembership.test.ts`）。
const connection = postgres(APP_CONNECTION_STRING, { max: 1 });

// 行を直接置く接続。役を切り替えずに `authenticator` のまま使う。
const rowConnection = postgres(APP_CONNECTION_STRING, { max: 1 });

// 同時の参加（#36）だけが使う3本。参加する2人と、待ちを見る観察用で分ける。
const firstJoinConnection = postgres(APP_CONNECTION_STRING, { max: 1 });
const secondJoinConnection = postgres(APP_CONNECTION_STRING, { max: 1 });
const observerConnection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await connection.end();
  await rowConnection.end();
  await firstJoinConnection.end();
  await secondJoinConnection.end();
  await observerConnection.end();
});

/**
 * `anon` に切り替えたトランザクション。`withTransaction` は `authenticated` に固定なので、
 * `anon` の形だけここに写す（先行 `householdMembership.test.ts`）。クレームを張るのは「利用者の
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

type InvitationRow = { token: string | null };
type JoinRow = { outcome: string | null };
type MemberCountRow = { member_count: number };
type HouseholdRow = { household_id: string | null };
type FunctionRow = { schema: string };
type GranteeRow = { grantee: string };
type ConfigRow = { proconfig: string[] | null };
type BackendRow = { pid: number };
type WaitRow = { wait_event_type: string | null };

/** そのトランザクションのクレームで招待を作る関数を呼ぶ。 */
async function createInvitation(tx: TransactionSql): Promise<string | null> {
  const [row] = await tx<InvitationRow[]>`
    select private.create_household_invitation() as token
  `;
  return row?.token ?? null;
}

/** そのトランザクションのクレームで参加する関数を呼ぶ。 */
async function joinHousehold(tx: TransactionSql, token: string): Promise<string | null> {
  const [row] = await tx<JoinRow[]>`
    select private.join_household(${token}) as outcome
  `;
  return row?.outcome ?? null;
}

/** そのトランザクションのクレームで人数の関数を呼ぶ。 */
async function memberCount(tx: TransactionSql): Promise<number> {
  const [row] = await tx<MemberCountRow[]>`
    select private.household_member_count() as member_count
  `;
  return row?.member_count ?? -1;
}

/** そのトランザクションのクレームで世帯を決める関数を呼ぶ。 */
async function currentHouseholdId(tx: TransactionSql): Promise<string | null> {
  const [row] = await tx<HouseholdRow[]>`
    select private.current_household_id() as household_id
  `;
  return row?.household_id ?? null;
}

function createInvitationOf(userId: string): Promise<string | null> {
  return withTransaction(connection, userId, createInvitation);
}

function joinHouseholdOf(userId: string, token: string): Promise<string | null> {
  return withTransaction(connection, userId, (tx) => joinHousehold(tx, token));
}

function memberCountOf(userId: string): Promise<number> {
  return withTransaction(connection, userId, memberCount);
}

function currentHouseholdIdOf(userId: string): Promise<string | null> {
  return withTransaction(connection, userId, currentHouseholdId);
}

function deleteOwnAccountOf(userId: string): Promise<unknown> {
  return withTransaction(connection, userId, (tx) => tx`select private.delete_own_account()`);
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

/** その世帯への招待の行を置き、トークンを返す。期限は既定で1時間後（使える招待）。 */
async function placeInvitation(
  token: string,
  householdId: string,
  expiresIn = '1 hour',
): Promise<string> {
  await insertHouseholdInvitation(rowConnection, { token, householdId, expiresIn });
  return token;
}

/**
 * 世帯のデータの9表すべてに、その世帯の行を1行ずつ置く（先行 `householdMembership.test.ts`）。
 * `owner` はその世帯に居る利用者で、そのクレームで置く。
 */
async function placeHouseholdData(
  caseNumber: number,
  owner: string,
  householdId: string,
): Promise<void> {
  const mealId = rowIdOf(caseNumber, 'a');
  const suggestionId = rowIdOf(caseNumber, 'b');
  const stockItemId = rowIdOf(caseNumber, 'c');
  await withTransaction(connection, owner, async (tx) => {
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

function householdRowsSeenBy(userId: string, householdId: string): Promise<HouseholdRowCounts> {
  return withTransaction(connection, userId, (tx) => countHouseholdRows(tx, householdId));
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

/** 同時の参加（#36）で、後の者がロックを待ち始めるまで見に行く回数の上限と間隔（秒）。 */
const LOCK_WAIT_ATTEMPTS = 100;
const LOCK_WAIT_INTERVAL_SECONDS = 0.02;

/** 外から解ける約束。同時の参加で、先の者のコミットを止めておくために使う。 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * 観察用の接続から `pg_stat_activity` を引き、そのバックエンドがロックを待ち始めるまで待つ。
 * 上限を超えたら投げる — 待たないまま先へ進むと、同時の参加を確かめたことにならない。
 */
async function waitUntilWaitingForLock(pid: number): Promise<void> {
  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    const [row] = await observerConnection<WaitRow[]>`
      select wait_event_type from pg_stat_activity where pid = ${pid}
    `;
    if (row?.wait_event_type === 'Lock') {
      return;
    }
    await observerConnection`select pg_sleep(${LOCK_WAIT_INTERVAL_SECONDS})`;
  }
  throw new Error(`後の参加がロックを待ち始めなかった（pid ${pid}）。`);
}

describe('招待を作る関数 private.create_household_invitation()', () => {
  it('自分しか居ない世帯の利用者が呼ぶと、空でないトークンの文字列が返る', async () => {
    const creator = userIdOf(1, 1);
    await placeHousehold(creator, []);

    const token = await createInvitationOf(creator);

    // 設計 規則1 / FR-44: 人数を問わず誰でも作れる（1人の世帯でも）。
    expect(typeof token).toBe('string');
    expect(token).not.toBe('');
  });

  it('作った招待のトークンで、他の世帯の利用者が作った人の世帯に参加できる', async () => {
    const creator = userIdOf(2, 1);
    const joiner = userIdOf(2, 2);
    const household = await placeHousehold(creator, []);
    await placeHousehold(joiner, []);
    const token = await createInvitationOf(creator);
    await joinHouseholdOf(joiner, token ?? '');

    // 設計 規則1 / FR-44・FR-45: 招待は作った人の今の世帯に書く。
    await expect(currentHouseholdIdOf(joiner)).resolves.toBe(household);
  });

  it('参加者が作った招待で参加すると、参加者自身の ID ではなく作った人の世帯に入る', async () => {
    const creator = userIdOf(3, 1);
    const member = userIdOf(3, 2);
    const joiner = userIdOf(3, 3);
    const household = await placeHousehold(creator, [member]);
    await placeHousehold(joiner, []);
    const token = await createInvitationOf(member);
    await joinHouseholdOf(joiner, token ?? '');

    // 設計 規則1 / ADR-087 決定2: 招待の世帯は `current_household_id()` であり、利用者 ID ではない。
    await expect(currentHouseholdIdOf(joiner)).resolves.toBe(household);
  });

  it('作った招待の期限は、作った時刻のちょうど24時間後になる', async () => {
    const creator = userIdOf(4, 1);
    await placeHousehold(creator, []);

    const expiresIn = await withTransaction(connection, creator, async (tx) => {
      const token = await createInvitation(tx);
      // 招待の表は authenticated から読めない。同じトランザクションのまま authenticator に戻して読む
      // — `now()` はトランザクションの開始の時刻なので、作った時刻と同じ値で比べられる。
      await tx`reset role`;
      return selectExpiresIn(tx, token ?? '');
    });

    // 設計 規則1 / ADR-087 決定4: 期限は `now() + interval '24 hours'`。
    expect(expiresIn).toBe(24 * 60 * 60);
  });

  it('2回呼ぶと違うトークンが返る', async () => {
    const creator = userIdOf(5, 1);
    await placeHousehold(creator, []);

    const first = await createInvitationOf(creator);
    const second = await createInvitationOf(creator);

    // 設計 規則2 / FR-44: 呼ぶたびに新しく作り、使い回さない。
    expect(second).not.toBe(first);
  });

  it('後から招待を作っても、先の招待は消えず参加に使える', async () => {
    const creator = userIdOf(6, 1);
    const joiner = userIdOf(6, 2);
    await placeHousehold(creator, []);
    await placeHousehold(joiner, []);
    const first = await createInvitationOf(creator);
    await createInvitationOf(creator);

    // 設計 規則2: 同じ世帯の未使用の招待があっても消さない。
    await expect(joinHouseholdOf(joiner, first ?? '')).resolves.toBe('joined');
  });

  it('クレームを張らずに呼ぶと、例外にならず null が返る', async () => {
    // 設計 規則3 / ADR-029 理由(1): クレームが無ければ何も書かず null。例外にしない。
    await expect(withTransaction(connection, null, createInvitation)).resolves.toBeNull();
  });

  it('anon に切り替えると呼べず、権限の不足で断られる', async () => {
    const caller = userIdOf(8, 1);

    const execution = withAnonTransaction(connection, caller, createInvitation);

    // 設計 5章 / ADR-087 決定3: `anon` には `execute` が無い。
    await expect(execution).rejects.toMatchObject({ code: '42501' });
  });
});

describe('参加する関数 private.join_household(invitation_token text)', () => {
  it('他の世帯の使える招待で呼ぶと joined が返る', async () => {
    const creator = userIdOf(9, 1);
    const joiner = userIdOf(9, 2);
    const household = await placeHousehold(creator, []);
    await placeHousehold(joiner, []);
    const token = await placeInvitation(invitationTokenOf(9, 1), household);

    // 設計 規則6 / FR-45
    await expect(joinHouseholdOf(joiner, token)).resolves.toBe('joined');
  });

  it('参加した直後、同じトランザクションの世帯は招待の世帯になる', async () => {
    const creator = userIdOf(10, 1);
    const joiner = userIdOf(10, 2);
    const household = await placeHousehold(creator, []);
    await placeHousehold(joiner, []);
    const token = await placeInvitation(invitationTokenOf(10, 1), household);

    const after = await withTransaction(connection, joiner, async (tx) => {
      await joinHousehold(tx, token);
      return currentHouseholdId(tx);
    });

    // 設計 規則6 / ADR-087 決定2・5: 参加の行が招待の世帯を指す。
    expect(after).toBe(household);
  });

  it('参加すると、参加先の作った人から見た人数が 2 になる', async () => {
    const creator = userIdOf(11, 1);
    const joiner = userIdOf(11, 2);
    const household = await placeHousehold(creator, []);
    await placeHousehold(joiner, []);
    const token = await placeInvitation(invitationTokenOf(11, 1), household);
    await joinHouseholdOf(joiner, token);

    // 設計 規則6 / FR-26
    await expect(memberCountOf(creator)).resolves.toBe(2);
  });

  it('参加の行を持つ利用者が別の世帯へ参加すると、世帯は新しい参加先に変わる', async () => {
    const formerCreator = userIdOf(12, 1);
    const joiner = userIdOf(12, 2);
    const targetCreator = userIdOf(12, 3);
    await placeHousehold(formerCreator, [joiner]);
    const target = await placeHousehold(targetCreator, []);
    const token = await placeInvitation(invitationTokenOf(12, 1), target);
    await joinHouseholdOf(joiner, token);

    // 設計 規則6: 参加の行があれば書き換える。
    await expect(currentHouseholdIdOf(joiner)).resolves.toBe(target);
  });

  it('参加の行を持つ利用者が別の世帯へ参加すると、元の世帯の作った人から見た人数が 1 減る', async () => {
    const formerCreator = userIdOf(13, 1);
    const joiner = userIdOf(13, 2);
    const targetCreator = userIdOf(13, 3);
    await placeHousehold(formerCreator, [joiner]);
    const target = await placeHousehold(targetCreator, []);
    const token = await placeInvitation(invitationTokenOf(13, 1), target);
    await joinHouseholdOf(joiner, token);

    // 設計 規則6 / FR-26: 2人の世帯から1人が移り、1人になる。
    await expect(memberCountOf(formerCreator)).resolves.toBe(1);
  });

  it('参加の行の無い作った人が他の世帯へ参加しても、元の世帯の参加者の世帯は変わらず人数は 1 になる', async () => {
    const creator = userIdOf(14, 1);
    const member = userIdOf(14, 2);
    const targetCreator = userIdOf(14, 3);
    const household = await placeHousehold(creator, [member]);
    const target = await placeHousehold(targetCreator, []);
    const token = await placeInvitation(invitationTokenOf(14, 1), target);
    await joinHouseholdOf(creator, token);

    const observed = await withTransaction(connection, member, async (tx) => ({
      householdId: await currentHouseholdId(tx),
      memberCount: await memberCount(tx),
    }));

    // 設計 規則6 / C-9: 書くのは自分の参加の行だけ。行の無い作った人は行を足して移る。
    expect(observed).toEqual({ householdId: household, memberCount: 1 });
  });

  it('使った招待は消え、同じトークンで別の利用者が呼ぶと invalid_invitation が返る', async () => {
    const creator = userIdOf(15, 1);
    const firstJoiner = userIdOf(15, 2);
    const secondJoiner = userIdOf(15, 3);
    const household = await placeHousehold(creator, []);
    await placeHousehold(firstJoiner, []);
    await placeHousehold(secondJoiner, []);
    const token = await placeInvitation(invitationTokenOf(15, 1), household);
    await joinHouseholdOf(firstJoiner, token);

    // 設計 規則4・6 / FR-44: 招待は1回限り。使用済みは無いものと同じ断り方。
    await expect(joinHouseholdOf(secondJoiner, token)).resolves.toBe('invalid_invitation');
  });

  it('参加すると、参加先の在庫・献立・提案が参加した利用者から見える', async () => {
    const targetCreator = userIdOf(16, 1);
    const joiner = userIdOf(16, 2);
    const target = await placeHousehold(targetCreator, []);
    await placeHousehold(joiner, []);
    await placeHouseholdData(16, targetCreator, target);
    const token = await placeInvitation(invitationTokenOf(16, 1), target);
    await joinHouseholdOf(joiner, token);

    // FR-26 / C-9: 世帯のメンバーは世帯のデータを共有する。
    await expect(householdRowsSeenBy(joiner, target)).resolves.toEqual(placedRowsInAllTables);
  });

  it('参加すると、他に人が居る元の世帯の在庫・献立・提案は参加した利用者から見えない', async () => {
    const formerCreator = userIdOf(17, 1);
    const joiner = userIdOf(17, 2);
    const targetCreator = userIdOf(17, 3);
    const former = await placeHousehold(formerCreator, [joiner]);
    const target = await placeHousehold(targetCreator, []);
    await placeHouseholdData(17, formerCreator, former);
    const token = await placeInvitation(invitationTokenOf(17, 1), target);
    await joinHouseholdOf(joiner, token);

    // C-9: 見えるのは今の世帯のデータだけ。
    await expect(householdRowsSeenBy(joiner, former)).resolves.toEqual(emptyRows);
  });

  it('参加しても、元の世帯の在庫・献立・提案は1行も減らず残ったメンバーから見える', async () => {
    const formerCreator = userIdOf(18, 1);
    const joiner = userIdOf(18, 2);
    const targetCreator = userIdOf(18, 3);
    const former = await placeHousehold(formerCreator, [joiner]);
    const target = await placeHousehold(targetCreator, []);
    await placeHouseholdData(18, formerCreator, former);
    const token = await placeInvitation(invitationTokenOf(18, 1), target);
    await joinHouseholdOf(joiner, token);

    // 設計 規則6 / ADR-087 決定5: 参加の関数は在庫・献立・提案に触れない。
    await expect(householdRowsSeenBy(formerCreator, former)).resolves.toEqual(
      placedRowsInAllTables,
    );
  });

  it('参加しても、参加先の在庫・献立・提案の行数は変わらない', async () => {
    const targetCreator = userIdOf(19, 1);
    const joiner = userIdOf(19, 2);
    const target = await placeHousehold(targetCreator, []);
    await placeHousehold(joiner, []);
    await placeHouseholdData(19, targetCreator, target);
    const token = await placeInvitation(invitationTokenOf(19, 1), target);
    await joinHouseholdOf(joiner, token);

    // 設計 規則6 / ADR-087 決定5: 参加の関数は在庫・献立・提案に触れない。
    await expect(householdRowsSeenBy(targetCreator, target)).resolves.toEqual(
      placedRowsInAllTables,
    );
  });

  it('参加しても、関係しない世帯のメンバーの世帯と人数は変わらない', async () => {
    const targetCreator = userIdOf(20, 1);
    const joiner = userIdOf(20, 2);
    const otherCreator = userIdOf(20, 3);
    const otherMember = userIdOf(20, 4);
    const target = await placeHousehold(targetCreator, []);
    await placeHousehold(joiner, []);
    const otherHousehold = await placeHousehold(otherCreator, [otherMember]);
    const token = await placeInvitation(invitationTokenOf(20, 1), target);
    await joinHouseholdOf(joiner, token);

    const observed = await withTransaction(connection, otherMember, async (tx) => ({
      householdId: await currentHouseholdId(tx),
      memberCount: await memberCount(tx),
    }));

    // C-9 / 設計 規則6
    expect(observed).toEqual({ householdId: otherHousehold, memberCount: 2 });
  });

  it('存在しないトークンで呼ぶと invalid_invitation が返る', async () => {
    const joiner = userIdOf(21, 1);
    await placeHousehold(joiner, []);

    // 設計 規則4 / ADR-087 決定4
    await expect(joinHouseholdOf(joiner, invitationTokenOf(21, 1))).resolves.toBe(
      'invalid_invitation',
    );
  });

  it.each([
    { label: '空文字', token: '', index: 1 },
    { label: '空白だけ', token: '   ', index: 2 },
  ])(
    '$label のトークンで呼ぶと、例外にならず invalid_invitation が返る',
    async ({ token, index }) => {
      const joiner = userIdOf(22, index);
      await placeHousehold(joiner, []);

      // 設計 規則4・15: 形として通し、DB で無効に畳む。
      await expect(joinHouseholdOf(joiner, token)).resolves.toBe('invalid_invitation');
    },
  );

  it('期限の切れた招待で呼ぶと invalid_invitation が返る', async () => {
    const creator = userIdOf(23, 1);
    const joiner = userIdOf(23, 2);
    const household = await placeHousehold(creator, []);
    await placeHousehold(joiner, []);
    const token = await placeInvitation(invitationTokenOf(23, 1), household, '-1 minute');

    // 設計 規則4 / ADR-087 決定4: 切れた招待は無いものと同じ断り方。
    await expect(joinHouseholdOf(joiner, token)).resolves.toBe('invalid_invitation');
  });

  it('期限がちょうど今の招待で呼ぶと invalid_invitation が返る', async () => {
    const creator = userIdOf(24, 1);
    const joiner = userIdOf(24, 2);
    const household = await placeHousehold(creator, []);
    await placeHousehold(joiner, []);
    const token = invitationTokenOf(24, 1);

    const outcome = await rowConnection.begin(async (tx) => {
      // 置くのと呼ぶのを同じトランザクションにし、`now()` を揃える。置くのは役を切り替える前。
      await insertHouseholdInvitation(tx, { token, householdId: household, expiresIn: '0' });
      await tx`set local role authenticated`;
      const claims = JSON.stringify({ sub: joiner });
      await tx`select set_config('request.jwt.claims', ${claims}, true)`;
      return joinHousehold(tx, token);
    });

    // 設計 規則4: 使えるのは `expires_at > now()` のときだけ。境界は使えない側。
    expect(outcome).toBe('invalid_invitation');
  });

  it('作った人が1人のままアカウントを消した世帯の招待は、期限内でも invalid_invitation が返る', async () => {
    const creator = userIdOf(25, 1);
    const joiner = userIdOf(25, 2);
    const household = await placeHousehold(creator, []);
    await placeHousehold(joiner, []);
    const token = await placeInvitation(invitationTokenOf(25, 1), household);
    await deleteOwnAccountOf(creator);

    // 設計 規則4 / 10章: メンバーの居ない世帯に入って自分のデータだけを失うことを防ぐ。
    await expect(joinHouseholdOf(joiner, token)).resolves.toBe('invalid_invitation');
  });

  it('作った人が1人のまま他の世帯へ参加して空になった世帯の招待は invalid_invitation が返る', async () => {
    const creator = userIdOf(26, 1);
    const joiner = userIdOf(26, 2);
    const targetCreator = userIdOf(26, 3);
    const household = await placeHousehold(creator, []);
    await placeHousehold(joiner, []);
    const target = await placeHousehold(targetCreator, []);
    const emptiedToken = await placeInvitation(invitationTokenOf(26, 1), household);
    const targetToken = await placeInvitation(invitationTokenOf(26, 2), target);
    await joinHouseholdOf(creator, targetToken);

    // 設計 規則4: 人数は `household_member_count()` と同じ数え方で、空の世帯の招待は使えない。
    await expect(joinHouseholdOf(joiner, emptiedToken)).resolves.toBe('invalid_invitation');
  });

  it('作った人がアカウントを消しても参加者が残る世帯の招待なら joined が返る', async () => {
    const creator = userIdOf(27, 1);
    const member = userIdOf(27, 2);
    const joiner = userIdOf(27, 3);
    const household = await placeHousehold(creator, [member]);
    await placeHousehold(joiner, []);
    const token = await placeInvitation(invitationTokenOf(27, 1), household);
    await deleteOwnAccountOf(creator);

    // 設計 規則4: メンバーが1人以上居れば使える。
    await expect(joinHouseholdOf(joiner, token)).resolves.toBe('joined');
  });

  it('断られた利用者の世帯は、自分の ID のまま変わらない', async () => {
    const creator = userIdOf(28, 1);
    const joiner = userIdOf(28, 2);
    const household = await placeHousehold(creator, []);
    await placeHousehold(joiner, []);
    const token = await placeInvitation(invitationTokenOf(28, 1), household, '-1 minute');
    await joinHouseholdOf(joiner, token);

    // 設計 規則4: 断るときは何も書かない。
    await expect(currentHouseholdIdOf(joiner)).resolves.toBe(joiner);
  });

  it('作った人が自分の世帯の招待で呼ぶと already_member が返る', async () => {
    const creator = userIdOf(29, 1);
    const household = await placeHousehold(creator, []);
    const token = await placeInvitation(invitationTokenOf(29, 1), household);

    // 設計 規則5 / ADR-087 決定5
    await expect(joinHouseholdOf(creator, token)).resolves.toBe('already_member');
  });

  it('参加者が今居る世帯の招待で呼ぶと already_member が返る', async () => {
    const creator = userIdOf(30, 1);
    const member = userIdOf(30, 2);
    const household = await placeHousehold(creator, [member]);
    const token = await placeInvitation(invitationTokenOf(30, 1), household);

    // 設計 規則5: 比べるのは利用者 ID ではなく `current_household_id()`。
    await expect(joinHouseholdOf(member, token)).resolves.toBe('already_member');
  });

  it('already_member で断っても招待は消えず、別の利用者が参加に使える', async () => {
    const creator = userIdOf(31, 1);
    const joiner = userIdOf(31, 2);
    const household = await placeHousehold(creator, []);
    await placeHousehold(joiner, []);
    const token = await placeInvitation(invitationTokenOf(31, 1), household);
    await joinHouseholdOf(creator, token);

    // 設計 規則5: 既に居るときは招待を消さない。
    await expect(joinHouseholdOf(joiner, token)).resolves.toBe('joined');
  });

  it('自分の世帯の招待でも、期限が切れていれば invalid_invitation が返る', async () => {
    const creator = userIdOf(32, 1);
    const household = await placeHousehold(creator, []);
    const token = await placeInvitation(invitationTokenOf(32, 1), household, '-1 minute');

    // 設計 規則4・5: 使えるかどうかを先に見る。切れた招待は既に居るかを問わず無効。
    await expect(joinHouseholdOf(creator, token)).resolves.toBe('invalid_invitation');
  });

  it('クレームを張らずに呼ぶと、例外にならず invalid_invitation が返る', async () => {
    const creator = userIdOf(33, 1);
    const household = await placeHousehold(creator, []);
    const token = await placeInvitation(invitationTokenOf(33, 1), household);

    const outcome = await withTransaction(connection, null, (tx) => joinHousehold(tx, token));

    // 設計 規則3 / ADR-029 理由(1): クレームが無ければ何も書かない。例外にしない。
    expect(outcome).toBe('invalid_invitation');
  });

  it('クレームを張らずに呼んでも招待は消えず、別の利用者が参加に使える', async () => {
    const creator = userIdOf(34, 1);
    const joiner = userIdOf(34, 2);
    const household = await placeHousehold(creator, []);
    await placeHousehold(joiner, []);
    const token = await placeInvitation(invitationTokenOf(34, 1), household);
    await withTransaction(connection, null, (tx) => joinHousehold(tx, token));

    // 設計 規則3: クレームが無ければ招待を消さない。
    await expect(joinHouseholdOf(joiner, token)).resolves.toBe('joined');
  });

  it('anon に切り替えると呼べず権限の不足で断られ、世帯は変わらない', async () => {
    const creator = userIdOf(35, 1);
    const joiner = userIdOf(35, 2);
    const household = await placeHousehold(creator, []);
    await placeHousehold(joiner, []);
    const token = await placeInvitation(invitationTokenOf(35, 1), household);

    const execution = withAnonTransaction(connection, joiner, (tx) => joinHousehold(tx, token));

    // 設計 5章 / ADR-087 決定3: `anon` には `execute` が無い。
    await expect(execution).rejects.toMatchObject({ code: '42501' });
    // 例外だけでは「書けたうえで断られた」と見分けがつかない。世帯が動いていないことまで見る。
    await expect(currentHouseholdIdOf(joiner)).resolves.toBe(joiner);
  });

  it('同じトークンで2人が同時に参加すると1人だけ joined になり、後の者は invalid_invitation で世帯は変わらない', async () => {
    const creator = userIdOf(36, 1);
    const firstJoiner = userIdOf(36, 2);
    const secondJoiner = userIdOf(36, 3);
    const household = await placeHousehold(creator, []);
    await placeHousehold(firstJoiner, []);
    await placeHousehold(secondJoiner, []);
    const token = await placeInvitation(invitationTokenOf(36, 1), household);
    const [secondBackend] = await secondJoinConnection<BackendRow[]>`
      select pg_backend_pid() as pid
    `;

    // 先の者は参加したあとコミットせずに止めておく。
    const firstJoined = deferred<string | null>();
    const releaseFirst = deferred<void>();
    const firstTransaction = withTransaction(firstJoinConnection, firstJoiner, async (tx) => {
      const outcome = await joinHousehold(tx, token);
      firstJoined.resolve(outcome);
      await releaseFirst.promise;
      return outcome;
    });
    await Promise.race([firstJoined.promise, firstTransaction]);

    const secondTransaction = withTransaction(secondJoinConnection, secondJoiner, (tx) =>
      joinHousehold(tx, token),
    );
    try {
      await waitUntilWaitingForLock(secondBackend?.pid ?? -1);
    } finally {
      releaseFirst.resolve();
    }

    const outcomes = { first: await firstTransaction, second: await secondTransaction };

    // 設計 規則7 / ADR-087 決定4: 招待は1回限り。同時でも高々1人だけ通る。
    expect(outcomes).toEqual({ first: 'joined', second: 'invalid_invitation' });
    await expect(currentHouseholdIdOf(secondJoiner)).resolves.toBe(secondJoiner);
  });
});

describe('2関数の置き場所と権限', () => {
  const functionNames = ['create_household_invitation', 'join_household'];

  it.each(functionNames)(
    '%s の実行権を持つのは authenticated だけで、PUBLIC にも anon にも無い',
    async (functionName) => {
      // 先行 `householdMembership.test.ts`。既定の権限（`proacl` が null）は PUBLIC に `execute` を
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

      // 設計 5章 / ADR-087 決定3
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

      // 設計 5章 / ADR-071 決定1: API に公開するスキーマに置かない。
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
    // （先行 `householdMembership.test.ts`）。
    const entry = (row?.proconfig ?? []).find((item) => item.startsWith('search_path='));
    const value = entry?.slice('search_path='.length);

    // 設計 5章 / ADR-071 理由(4): `security definer` なので検索経路に頼らない。
    expect(['', '""']).toContain(value);
  });
});
