import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { OWNER_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';

/**
 * `anon` と `authenticated` に、RLS を素通りする表の権限が付いていないこと。
 *
 * `TRUNCATE` は RLS を見ずに全世帯の行を消す（C-9）。`REFERENCES` と `TRIGGER` も api は使わない。
 * Supabase は既定の権限でこれらを `public` の表に付けるので、今ある表と、これから作る表の両方を見る。
 * 見るのは所有者の接続から（権限の一覧は所有者でないと全部は見えない）。
 */

const ownerConnection = postgres(OWNER_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await ownerConnection.end();
});

const bypassingPrivileges = ['TRUNCATE', 'REFERENCES', 'TRIGGER'];

describe('public の表の権限', () => {
  it('anon と authenticated は、今ある表のどれにも TRUNCATE・REFERENCES・TRIGGER を持たない', async () => {
    const rows = await ownerConnection<
      { grantee: string; table_name: string; privilege_type: string }[]
    >`
      select grantee, table_name, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee in ('anon', 'authenticated')
        and privilege_type in ${ownerConnection(bypassingPrivileges)}
    `;

    expect(rows).toEqual([]);
  });

  it('所有者がこれから作る表にも、anon と authenticated の TRUNCATE・REFERENCES・TRIGGER は付かない', async () => {
    // 表を作って権限を見たら巻き戻す。ほかのテストに表を残さない。
    const rows = await ownerConnection
      .begin(async (tx) => {
        await tx`create table public.table_privileges_probe (id int)`;
        const granted = await tx<{ grantee: string; privilege_type: string }[]>`
          select grantee, privilege_type
          from information_schema.role_table_grants
          where table_schema = 'public'
            and table_name = 'table_privileges_probe'
            and grantee in ('anon', 'authenticated')
            and privilege_type in ${tx(bypassingPrivileges)}
        `;
        throw new ProbeFinished(granted);
      })
      .catch((error: unknown) => {
        if (error instanceof ProbeFinished) return error.rows;
        throw error;
      });

    expect(rows).toEqual([]);
  });
});

class ProbeFinished extends Error {
  constructor(readonly rows: readonly unknown[]) {
    super('表の権限を見終えたので巻き戻す');
  }
}
