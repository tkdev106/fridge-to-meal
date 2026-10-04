import type { Sql, TransactionSql } from 'postgres';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { countUser, insertUser } from '../support/db/AuthUsers.js';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import { insertHouseholdMember } from '../support/db/HouseholdMembers.js';
import { withTransaction } from '../support/db/WithTransaction.js';

/**
 * 世帯を決める関数 `private.current_household_id()` と、参加の表・招待の表の権限を
 * ローカル Postgres の上で確かめる（B-73 設計 規則1〜3・5・11 / ADR-087 決定1・2・3 /
 * ADR-071 決定1）。**`pnpm test:db` でだけ走る。**
 *
 * 繋ぐのは `authenticator` だけ。所有者（`postgres`）の接続を使うと権限が素通りし、
 * **権限が無くても緑になる**（B-07d 規則3）。利用者と参加の行を置くのは役を切り替える前の
 * `authenticator` に限る（`AuthUsers.ts` / `HouseholdMembers.ts`）。
 *
 * **識別子はケースごとに固有の固定値を使い、使い回さない。** 先頭の並び（`b73a`）で
 * 他のファイルと分けてある。**後片付けはしない。** 権限の断りは `code` で見る（文言は見ない）。
 */

const memberUser = 'b73a0000-0001-4000-8000-000000000001';
const memberHousehold = 'b73a0000-0001-4000-8000-000000000002';

const loneUser = 'b73a0000-0002-4000-8000-000000000001';

const unaffectedUser = 'b73a0000-0003-4000-8000-000000000001';
const otherMemberUser = 'b73a0000-0003-4000-8000-000000000002';
const otherMemberHousehold = 'b73a0000-0003-4000-8000-000000000003';

const anonCallerUser = 'b73a0000-0005-4000-8000-000000000001';

const directReaderUser = 'b73a0000-0010-4000-8000-000000000001';

const directWriterUser = 'b73a0000-0011-4000-8000-000000000001';
const directWriteTargetHousehold = 'b73a0000-0011-4000-8000-000000000002';

// 権限を問うだけで行を書かない利用者。
const privilegeReaderUser = 'b73a0000-0012-4000-8000-000000000001';

const deletedMemberUser = 'b73a0000-0014-4000-8000-000000000001';
const deletedMemberHousehold = 'b73a0000-0014-4000-8000-000000000002';

const recreatedMemberUser = 'b73a0000-0015-4000-8000-000000000001';
const recreatedMemberHousehold = 'b73a0000-0015-4000-8000-000000000002';

// 1本の接続で複数のトランザクションを張る（先行 `userDeleter.test.ts`）。
const connection = postgres(APP_CONNECTION_STRING, { max: 1 });

// 行を直接置く・数える接続。役を切り替えずに `authenticator` のまま使う。
const rowConnection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await connection.end();
  await rowConnection.end();
});

/**
 * `anon` に切り替えたトランザクション。`withTransaction` は `authenticated` に固定なので、
 * `anon` の形だけここに写す（先行 `userDeleter.test.ts`）。クレームを張るのは「利用者の
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

type HouseholdRow = { household_id: string | null };
type FunctionRow = { schema: string };
type ArgumentCountRow = { argument_count: number };
type GranteeRow = { grantee: string };
type ConfigRow = { proconfig: string[] | null };
type PrivilegeRow = { role: string; table_name: string; privilege: string };
type RowSecurityRow = {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
};

/** そのトランザクションのクレームで関数を呼び、返った世帯を読む。 */
async function currentHouseholdId(tx: TransactionSql): Promise<string | null> {
  const [row] = await tx<HouseholdRow[]>`
    select private.current_household_id() as household_id
  `;
  return row?.household_id ?? null;
}

/** 利用者のクレームを張って関数を呼ぶ。 */
function currentHouseholdIdOf(userId: string): Promise<string | null> {
  return withTransaction(connection, userId, currentHouseholdId);
}

describe('世帯を決める関数 private.current_household_id() と参加の表・招待の表', () => {
  it('参加の行がある利用者がクレームを張って呼ぶと、参加先の世帯が返る', async () => {
    await insertUser(rowConnection, memberUser);
    await insertHouseholdMember(rowConnection, {
      userId: memberUser,
      householdId: memberHousehold,
    });

    // ADR-087 決定1・2 / 設計 規則1
    await expect(currentHouseholdIdOf(memberUser)).resolves.toBe(memberHousehold);
  });

  it('参加の行が無い利用者が呼ぶと、自分の利用者 ID が返る', async () => {
    await insertUser(rowConnection, loneUser);

    // ADR-087 決定1・理由(2) / 設計 規則1・5: 行の無い利用者の世帯は今と同じ自分の ID。
    await expect(currentHouseholdIdOf(loneUser)).resolves.toBe(loneUser);
  });

  it('他の利用者の参加の行は、自分の世帯を変えない', async () => {
    await insertUser(rowConnection, unaffectedUser);
    await insertUser(rowConnection, otherMemberUser);
    await insertHouseholdMember(rowConnection, {
      userId: otherMemberUser,
      householdId: otherMemberHousehold,
    });

    // C-9 / 設計 規則1: 引くのは `user_id = auth.uid()` の行だけ。
    await expect(currentHouseholdIdOf(unaffectedUser)).resolves.toBe(unaffectedUser);
  });

  it('クレームを張らずに呼ぶと例外にならず null が返る', async () => {
    // ADR-029 理由(1) / 設計 規則1: クレームが無ければ `auth.uid()` は null。例外にしない。
    await expect(withTransaction(connection, null, currentHouseholdId)).resolves.toBeNull();
  });

  it('anon に切り替えると関数を呼べず、権限の不足で断られる', async () => {
    const execution = withAnonTransaction(connection, anonCallerUser, currentHouseholdId);

    // ADR-087 決定3 / ADR-071 決定1 / 設計 規則2: `anon` には `execute` が無い。
    await expect(execution).rejects.toMatchObject({ code: '42501' });
  });

  it('関数の実行権を持つのは authenticated だけで、PUBLIC にも anon にも無い', async () => {
    // 先行 `userDeleter.test.ts`。既定の権限（`proacl` が null）は PUBLIC に `execute` を与えるので、
    // `acldefault` で補ってから展開する。所有者は比べない。grantee 0 は PUBLIC。
    const rows = await rowConnection<GranteeRow[]>`
      select case when acl.grantee = 0 then 'PUBLIC' else r.rolname end as grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
      left join pg_roles r on r.oid = acl.grantee
      where n.nspname = 'private'
        and p.proname = 'current_household_id'
        and acl.privilege_type = 'EXECUTE'
        and acl.grantee <> p.proowner
      order by 1
    `;

    // ADR-087 決定3 / 設計 規則2
    expect(rows.map((row) => row.grantee)).toEqual(['authenticated']);
  });

  it('関数は private スキーマにだけあり、public には無い', async () => {
    const rows = await rowConnection<FunctionRow[]>`
      select n.nspname as schema
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.proname = 'current_household_id'
      order by 1
    `;

    // ADR-071 決定1 / 設計 規則2: API に公開するスキーマに置かない。
    expect(rows.map((row) => row.schema)).toEqual(['private']);
  });

  it('関数は引数を取らない形だけがある', async () => {
    const rows = await rowConnection<ArgumentCountRow[]>`
      select p.pronargs::int as argument_count
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'current_household_id'
    `;

    // ADR-087 決定3 / 設計 規則2: 本体は `auth.uid()` に縛る。引数で利用者や世帯を受け取れば、
    // 他人の世帯を引ける口になる。
    expect(rows.map((row) => row.argument_count)).toEqual([0]);
  });

  it('関数は検索経路を空にして動く', async () => {
    const [row] = await rowConnection<ConfigRow[]>`
      select p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'current_household_id'
    `;

    // 正規化された文字列は版で変わりうるので、`search_path` の項目を引いて値が空であることを見る
    // （先行 `userDeleter.test.ts`）。
    const entry = (row?.proconfig ?? []).find((item) => item.startsWith('search_path='));
    const value = entry?.slice('search_path='.length);

    // ADR-071 理由(4) / 設計 規則2: `security definer` なので検索経路に頼らない。
    expect(['', '""']).toContain(value);
  });

  it('authenticated に切り替えると、参加の表を直接読めない', async () => {
    const execution = withTransaction(
      connection,
      directReaderUser,
      (tx) => tx`select household_id from household_members`,
    );

    // ADR-087 決定3 / 設計 規則3: 2表は関数だけを通す。
    await expect(execution).rejects.toMatchObject({ code: '42501' });
  });

  it('authenticated に切り替えると参加の表に行を作れず、関数は自分の利用者 ID を返したままである', async () => {
    await insertUser(rowConnection, directWriterUser);

    const execution = withTransaction(
      connection,
      directWriterUser,
      (tx) => tx`
        insert into household_members (user_id, household_id)
        values (${directWriterUser}, ${directWriteTargetHousehold})
      `,
    );

    // ADR-087 決定3 / 設計 規則3: 自分で他の世帯に入れれば、その世帯の行を読める。
    await expect(execution).rejects.toMatchObject({ code: '42501' });
    // 例外だけでは「書けたうえで断られた」と見分けがつかない。世帯が動いていないことまで見る。
    await expect(currentHouseholdIdOf(directWriterUser)).resolves.toBe(directWriterUser);
  });

  it('参加の表と招待の表は、anon にも authenticated にも読み書きの権限が無い', async () => {
    // 表の名前を解決するには public の usage が要る。本番の役に揃えて、
    // authenticated に切り替えたトランザクションで問う（問うのは他の役の権限でもよい）。
    const rows = await withTransaction(connection, privilegeReaderUser, (tx) => {
      return tx<PrivilegeRow[]>`
        select r.role, t.table_name, p.privilege
        from unnest(array['anon', 'authenticated']) as r(role)
        cross join unnest(array['household_members', 'household_invitations']) as t(table_name)
        cross join unnest(array['select', 'insert', 'update', 'delete']) as p(privilege)
        where has_table_privilege(r.role, 'public.' || t.table_name, p.privilege)
        order by 1, 2, 3
      `;
    });

    // ADR-087 決定3 / 設計 規則3: Supabase は public の新しい表に既定で権限を付けるので、
    // 明示して取り上げる。
    expect([...rows]).toEqual([]);
  });

  it('参加の表と招待の表は、行レベルセキュリティを有効にし、強制しない', async () => {
    const rows = await rowConnection<RowSecurityRow[]>`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('household_members', 'household_invitations')
      order by c.relname
    `;

    // ADR-087 決定3 / 設計 規則3: 強制すると、所有者である関数自身が0行しか読めなくなる。
    expect([...rows]).toEqual([
      { relname: 'household_invitations', relrowsecurity: true, relforcerowsecurity: false },
      { relname: 'household_members', relrowsecurity: true, relforcerowsecurity: false },
    ]);
  });

  it('参加の行がある利用者も、アカウントを消す関数で消せる', async () => {
    await insertUser(rowConnection, deletedMemberUser);
    await insertHouseholdMember(rowConnection, {
      userId: deletedMemberUser,
      householdId: deletedMemberHousehold,
    });

    const execution = withTransaction(
      connection,
      deletedMemberUser,
      (tx) => tx`select private.delete_own_account()`,
    );

    // ADR-087 決定2・6 / ADR-071 / 設計 規則11: 参加の行が利用者の削除を妨げない。
    await expect(execution).resolves.toBeDefined();
    await expect(countUser(rowConnection, deletedMemberUser)).resolves.toBe(0);
  });

  it('利用者を消すと参加の行も消え、同じ ID で利用者を置き直すと関数は自分の利用者 ID を返す', async () => {
    await insertUser(rowConnection, recreatedMemberUser);
    await insertHouseholdMember(rowConnection, {
      userId: recreatedMemberUser,
      householdId: recreatedMemberHousehold,
    });
    await withTransaction(
      connection,
      recreatedMemberUser,
      (tx) => tx`select private.delete_own_account()`,
    );

    await insertUser(rowConnection, recreatedMemberUser);

    // ADR-087 決定2・6 / 設計 規則11: 参加の行は外部キーの on delete cascade で一緒に消える。
    // 参加の表は authenticator にも select を与えないので、関数の返す世帯で間接に見る。
    await expect(currentHouseholdIdOf(recreatedMemberUser)).resolves.toBe(recreatedMemberUser);
  });
});
