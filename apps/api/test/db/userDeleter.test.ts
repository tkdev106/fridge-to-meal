import { drizzle } from 'drizzle-orm/postgres-js';
import type { Sql, TransactionSql } from 'postgres';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { UserDeleterImpl } from '../../src/contexts/identity/infrastructure/UserDeleterImpl.js';
import { householdIdOf } from '../../src/shared/domain/HouseholdId.js';
import { withHouseholdTransaction } from '../../src/shared/infrastructure/db/HouseholdTransaction.js';
import { countUser, insertUser } from '../support/db/AuthUsers.js';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import { withTransaction } from '../support/db/WithTransaction.js';

/**
 * 利用者を消す関数 `private.delete_own_account()` と、それを呼ぶ `UserDeleterImpl` を
 * ローカル Postgres の上で確かめる（B-56d 設計書 規則1〜4・8・11 / ADR-071 決定1・3）。
 * **`pnpm test:db` でだけ走る。**
 *
 * 繋ぐのは `authenticator` だけ。所有者（`postgres`）の接続を使うと権限が素通りし、
 * **権限が無くても緑になる**（B-07d 規則3）。`auth.users` に行を置く・数えるのは役を
 * 切り替える前の `authenticator` に限る（設計書 規則11）。
 *
 * **識別子はケースごとに固有の固定値を使い、使い回さない。** 先頭の並び（`b56d1000`）で
 * 他のファイルと分けてある。**後片付けはしない。** 権限の断りは `code` で見る（文言は見ない）。
 */

const deletedUser = 'b56d1000-0001-4000-8000-000000000001';

const deletingUser = 'b56d1000-0002-4000-8000-000000000001';
const remainingUser = 'b56d1000-0002-4000-8000-000000000002';

const unclaimedRemainingUser = 'b56d1000-0003-4000-8000-000000000001';

const anonCallerUser = 'b56d1000-0004-4000-8000-000000000001';

const directDeletionUser = 'b56d1000-0007-4000-8000-000000000001';

const anonReaderHousehold = 'b56d1000-0008-4000-8000-000000000001';

// 1本の接続で複数のトランザクションを張る（先行 `deleteHouseholdData.test.ts`）。
const connection = postgres(APP_CONNECTION_STRING, { max: 1 });
const db = drizzle(connection);

// 行を直接置く・数える接続。役を切り替えずに `authenticator` のまま使う（設計書 規則11）。
const rowConnection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await connection.end();
  await rowConnection.end();
});

/**
 * `anon` に切り替えたトランザクション。`withTransaction` は `authenticated` に固定なので、
 * `anon` の形だけここに写す。クレームを張るのは「世帯のクレームがあっても `anon` では断られる」
 * ことを見るため。
 */
function withAnonTransaction<T>(
  sql: Sql,
  householdId: string,
  body: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local role anon`;
    const claims = JSON.stringify({ sub: householdId });
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    return body(tx);
  }) as Promise<T>;
}

type FunctionRow = { schema: string };
type GranteeRow = { grantee: string };
type ConfigRow = { proconfig: string[] | null };

describe('利用者を消す UserDeleterImpl と private.delete_own_account()', () => {
  it('世帯のクレームを張って利用者を消すと、その世帯 ID の利用者が auth.users から消える', async () => {
    await insertUser(rowConnection, deletedUser);
    const household = householdIdOf(deletedUser);

    const execution = withHouseholdTransaction(db, household, (tx) =>
      new UserDeleterImpl(tx).delete(household),
    );

    // ADR-071 決定1 / 設計書 規則1・8: 誰を消すかはクレームが決める。
    await expect(execution).resolves.toBeUndefined();
    await expect(countUser(rowConnection, deletedUser)).resolves.toBe(0);
  });

  it('利用者を消しても、他の利用者の行は残る', async () => {
    await insertUser(rowConnection, deletingUser);
    await insertUser(rowConnection, remainingUser);
    const household = householdIdOf(deletingUser);

    await withHouseholdTransaction(db, household, (tx) =>
      new UserDeleterImpl(tx).delete(household),
    );

    // C-9 / 設計書 規則1: 消すのは `auth.uid()` と同じ `id` の行だけ。
    await expect(countUser(rowConnection, remainingUser)).resolves.toBe(1);
  });

  it('クレームを張らずに関数を呼ぶと例外にならず、利用者を1行も消さない', async () => {
    await insertUser(rowConnection, unclaimedRemainingUser);

    // ADR-071 決定3・理由(2) / 設計書 規則2: クレームが無ければ `auth.uid()` は null。
    // 例外ではなく「消す行が無い」に倒れる。投げればこの await で落ちる。
    await withTransaction(rowConnection, null, (tx) => tx`select private.delete_own_account()`);

    await expect(countUser(rowConnection, unclaimedRemainingUser)).resolves.toBe(1);
  });

  it('anon に切り替えると関数を呼べず、権限の不足で断られる', async () => {
    await insertUser(rowConnection, anonCallerUser);

    const execution = withAnonTransaction(
      rowConnection,
      anonCallerUser,
      (tx) => tx`select private.delete_own_account()`,
    );

    // ADR-071 決定1・3 / 設計書 規則3: `anon` には `usage` も `execute` も無い。
    await expect(execution).rejects.toMatchObject({ code: '42501' });
    await expect(countUser(rowConnection, anonCallerUser)).resolves.toBe(1);
  });

  it('関数の実行権を持つのは authenticated だけで、PUBLIC にも anon にも無い', async () => {
    // 既定の権限（`proacl` が null）は PUBLIC に `execute` を与えるので、`acldefault` で補ってから
    // 展開する。所有者は比べない（移行を流す役に依る）。grantee 0 は PUBLIC。
    const rows = await rowConnection<GranteeRow[]>`
      select case when acl.grantee = 0 then 'PUBLIC' else r.rolname end as grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
      left join pg_roles r on r.oid = acl.grantee
      where n.nspname = 'private'
        and p.proname = 'delete_own_account'
        and acl.privilege_type = 'EXECUTE'
        and acl.grantee <> p.proowner
      order by 1
    `;

    // ADR-071 決定1 / 設計書 規則3: PUBLIC への既定の `execute` も取り上げる。
    expect(rows.map((row) => row.grantee)).toEqual(['authenticated']);
  });

  it('利用者を消す関数は private スキーマにだけあり、public には無い', async () => {
    const rows = await rowConnection<FunctionRow[]>`
      select n.nspname as schema
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.proname = 'delete_own_account'
      order by 1
    `;

    // ADR-071 決定1・結果7 / 設計書 規則4: API に公開するスキーマに置かない。
    expect(rows.map((row) => row.schema)).toEqual(['private']);
  });

  it('authenticated に切り替えると、auth.users の行を直接消せない', async () => {
    await insertUser(rowConnection, directDeletionUser);

    const execution = withTransaction(
      rowConnection,
      directDeletionUser,
      (tx) => tx`delete from auth.users where id = ${directDeletionUser}`,
    );

    // ADR-071 決定3 / 設計書 規則11: 消せるのは関数を通したときだけ。
    await expect(execution).rejects.toMatchObject({ code: '42501' });
    await expect(countUser(rowConnection, directDeletionUser)).resolves.toBe(1);
  });

  it('anon に切り替えると、auth.users を読めない', async () => {
    const execution = withAnonTransaction(
      rowConnection,
      anonReaderHousehold,
      (tx) => tx`select id from auth.users`,
    );

    // ADR-071 決定3 / 設計書 規則11: `anon` に `auth.users` の権限を与えない。
    await expect(execution).rejects.toMatchObject({ code: '42501' });
  });

  it('関数は検索経路を空にして動く', async () => {
    const [row] = await rowConnection<ConfigRow[]>`
      select p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'delete_own_account'
    `;

    // 正規化された文字列（`search_path=""` 等）は版で変わりうるので literal で一致させず、
    // `search_path` の項目を引いて値が空であることを見る。
    const entry = (row?.proconfig ?? []).find((item) => item.startsWith('search_path='));
    const value = entry?.slice('search_path='.length);

    // ADR-071 理由(4) / 設計書 規則1: 名前はすべてスキーマで修飾し、検索経路に頼らない。
    expect(['', '""']).toContain(value);
  });
});
