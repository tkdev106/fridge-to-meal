import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import { withTransaction } from '../support/db/WithTransaction.js';

/**
 * ローカル Postgres に対する、保存したことのある在庫品の名称（`stock_item_names`）の
 * 行レベルセキュリティの回帰（B-50d 設計 規則8・9 / ADR-056 / ADR-029 決定2 / C-9 / NFR-09）。
 * 先行 `stockItemsRls.test.ts` と同じ構成で、同じ守りを新しい表に掛ける。
 * **`pnpm test:db` でだけ走る** — `pnpm test` は `apps/api/test/db/**` を除外する。
 *
 * 繋ぐのは `authenticator` だけ。所有者（`postgres`）の接続を使うと行レベルセキュリティが
 * 素通りし、**RLS が無くても緑になる。**
 *
 * **世帯 ID はケースごとに固有の固定値を使い、使い回さない。** 表は `globalSetup` で
 * 1度だけ作られ、ファイルとケースをまたいで共有されるため。主キーが (世帯, 名称) なので、
 * 世帯を分ければ同じ名称を使ってもケースどうしが衝突しない。**後片付けはしない。**
 */
const householdId = 'b50d0000-0000-4000-8000-000000000001';

const readerHouseholdId = 'b50d0000-0000-4000-8000-000000000002';
const ownerHouseholdId = 'b50d0000-0000-4000-8000-000000000003';

const writerHouseholdId = 'b50d0000-0000-4000-8000-000000000004';
const writeTargetHouseholdId = 'b50d0000-0000-4000-8000-000000000005';

const strangerUpdateHouseholdId = 'b50d0000-0000-4000-8000-000000000006';
const ownerUpdateHouseholdId = 'b50d0000-0000-4000-8000-000000000007';

const transferSourceHouseholdId = 'b50d0000-0000-4000-8000-000000000008';
const transferTargetHouseholdId = 'b50d0000-0000-4000-8000-000000000009';

const strangerDeletionHouseholdId = 'b50d0000-0000-4000-8000-00000000000a';
const ownerDeletionHouseholdId = 'b50d0000-0000-4000-8000-00000000000b';

const selfUpdateHouseholdId = 'b50d0000-0000-4000-8000-00000000000c';

const selfDeletionHouseholdId = 'b50d0000-0000-4000-8000-00000000000d';

const blankNameHouseholdId = 'b50d0000-0000-4000-8000-00000000000e';

// 述語を読むだけで行を書かない世帯。読むのは `APP_CONNECTION_STRING` のまま
// （`authenticated` でも `pg_policies` は読める）。所有者では繋がない。
const predicateReaderHouseholdId = 'b50d0000-0000-4000-8000-00000000000f';

// 1本の接続で複数のトランザクションを張る。`local` が次のトランザクションへ漏れて
// いないことは、同じ接続を使い回すことでしか見えない。
const connection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await connection.end();
});

type PolicyRow = { cmd: string; qual: string | null; with_check: string | null };

/**
 * `stock_item_names` に実際に入っているポリシーを、**操作（`cmd`）で引ける形**にして返す。
 * **`policyname` ではなく `cmd` で引く** — 名前で引くと、振る舞いを変えない改名で
 * `undefined` どうしの比較になり、理由の読めない赤になる（先行 `stockItemsRls.test.ts`）。
 */
async function stockItemNamePolicies(): Promise<Map<string, PolicyRow>> {
  const readRows = await withTransaction(connection, predicateReaderHouseholdId, (tx) => {
    return tx<PolicyRow[]>`
      select cmd, qual, with_check
      from pg_policies
      where tablename = 'stock_item_names'
    `;
  });

  return new Map(readRows.map((row) => [row.cmd, row]));
}

describe('保存したことのある在庫品の名称の行レベルセキュリティ', () => {
  it('クレームを張らなければ同じ接続でも表が0行になり、張り直せば同じ名称がもう一度見える', async () => {
    const visibleRows = await withTransaction(connection, householdId, async (tx) => {
      await tx`
        insert into stock_item_names (household_id, name)
        values (${householdId}, 'にんじん')
      `;
      return tx<{ name: string }[]>`
        select name from stock_item_names where household_id = ${householdId}
      `;
    });

    // 表全体を読む主張はこの1件だけに限る。他のケースが行を足しても
    // 「クレーム無しなら何も見えない」は壊れない。
    const rowsVisibleWithoutClaims = await withTransaction(connection, null, (tx) => {
      return tx<{ name: string }[]>`select name from stock_item_names`;
    });

    const rowsVisibleAfterReapplyingClaims = await withTransaction(
      connection,
      householdId,
      (tx) => {
        return tx<{ name: string }[]>`
          select name from stock_item_names where household_id = ${householdId}
        `;
      },
    );

    // 戻りは件数などを持つ配列なので、素の配列に写してから比べる。
    expect([...visibleRows]).toEqual([{ name: 'にんじん' }]);
    // C-9 / NFR-09 / B-50d 規則8: クレームが無ければ auth.uid() は null。**例外ではなく0行**。
    expect([...rowsVisibleWithoutClaims]).toEqual([]);
    // 3つ目が、0行の理由を「見えない」に絞り込む（1つ目が commit されていないだけ、では
    // 説明がつかなくなる）。
    expect([...rowsVisibleAfterReapplyingClaims]).toEqual([{ name: 'にんじん' }]);
  });

  it('他世帯の名称は世帯で絞らずに読んでも0行になる', async () => {
    // 他世帯の行は**その世帯のクレーム**で置く。自世帯のクレームでは insert の
    // with check に外れて作れない。
    await withTransaction(connection, ownerHouseholdId, async (tx) => {
      await tx`
        insert into stock_item_names (household_id, name)
        values (${ownerHouseholdId}, 'にんじん')
      `;
    });

    // 世帯で絞らず名称だけで読む。where で世帯を絞ると、RLS が無くても0行になってしまう。
    const rowsVisibleToReader = await withTransaction(connection, readerHouseholdId, (tx) => {
      return tx<{ household_id: string }[]>`
        select household_id from stock_item_names
        where household_id = ${ownerHouseholdId} or name = 'にんじん'
      `;
    });

    const rowsVisibleToOwner = await withTransaction(connection, ownerHouseholdId, (tx) => {
      return tx<{ name: string }[]>`
        select name from stock_item_names where household_id = ${ownerHouseholdId}
      `;
    });

    // C-9 / B-50d 規則8: 他世帯の名称は「見えない」。**例外ではなく0行**で表す。
    // 他のケースが自世帯の「にんじん」を足しても、読み手の世帯には1行も書かれないので
    // この主張は壊れない。
    expect([...rowsVisibleToReader]).toEqual([]);
    // 行は実在する。0行が「行が無いから」ではないことの裏取り。
    expect([...rowsVisibleToOwner]).toEqual([{ name: 'にんじん' }]);
  });

  it('他世帯の世帯 ID を持つ名称は作れない', async () => {
    // B-50d 規則8: insert の with check に外れた書き込みは例外で拒まれる。
    await expect(
      withTransaction(connection, writerHouseholdId, (tx) => {
        return tx`
          insert into stock_item_names (household_id, name)
          values (${writeTargetHouseholdId}, 'にんじん')
        `;
      }),
      // 文言は Postgres の版とロケールで変わる。SQLSTATE で照合する。
    ).rejects.toMatchObject({ code: '42501' });

    const rowsVisibleToWriteTarget = await withTransaction(
      connection,
      writeTargetHouseholdId,
      (tx) => {
        return tx<{ name: string }[]>`
          select name from stock_item_names where household_id = ${writeTargetHouseholdId}
        `;
      },
    );

    // 例外だけでは「書けたうえで見えないだけ」と見分けがつかない。行の持ち主になる
    // はずだった世帯のクレームで読み、書かれていないことまで見る。
    expect([...rowsVisibleToWriteTarget]).toEqual([]);
  });

  it('他世帯の名称は update しても影響行数0になり、値も変わらない', async () => {
    await withTransaction(connection, ownerUpdateHouseholdId, async (tx) => {
      await tx`
        insert into stock_item_names (household_id, name)
        values (${ownerUpdateHouseholdId}, 'にんじん')
      `;
    });

    // 影響行数は `returning` の戻り行数で数える。ドライバの `count` の意味に寄りかからない。
    const updatedRows = await withTransaction(connection, strangerUpdateHouseholdId, (tx) => {
      return tx<{ name: string }[]>`
        update stock_item_names set name = 'たまねぎ'
        where household_id = ${ownerUpdateHouseholdId}
        returning name
      `;
    });

    const rowsVisibleToOwner = await withTransaction(connection, ownerUpdateHouseholdId, (tx) => {
      return tx<{ name: string }[]>`
        select name from stock_item_names where household_id = ${ownerUpdateHouseholdId}
      `;
    });

    // C-9 / B-50d 規則8: update の using に外れた行は対象そのものにならない。
    // **例外ではなく影響行数0**になる。
    expect([...updatedRows]).toEqual([]);
    // 対象が存在しなければ0件は当たり前に起きる。行が在り、値が元のままであることまで見る。
    expect([...rowsVisibleToOwner]).toEqual([{ name: 'にんじん' }]);
  });

  it('自世帯の名称の世帯 ID を他世帯へ書き換えられない', async () => {
    await withTransaction(connection, transferSourceHouseholdId, async (tx) => {
      await tx`
        insert into stock_item_names (household_id, name)
        values (${transferSourceHouseholdId}, 'にんじん')
      `;
    });

    // using には当たる（自世帯の行）が、書き込んだあとの行が世帯の述語に外れるため
    // **例外**になる。この例外が update の with check から来ていると読まないこと —
    // with check を固定しているのは末尾の述語の突き合わせのほうである（先行と同じ）。
    await expect(
      withTransaction(connection, transferSourceHouseholdId, (tx) => {
        return tx`
          update stock_item_names set household_id = ${transferTargetHouseholdId}
          where household_id = ${transferSourceHouseholdId}
        `;
      }),
    ).rejects.toMatchObject({ code: '42501' });

    const rowsVisibleToTransferSource = await withTransaction(
      connection,
      transferSourceHouseholdId,
      (tx) => {
        return tx<{ household_id: string; name: string }[]>`
          select household_id, name from stock_item_names
          where household_id = ${transferSourceHouseholdId}
        `;
      },
    );

    // 例外に加えて、行の世帯が移っていないことまで見る。
    expect([...rowsVisibleToTransferSource]).toEqual([
      { household_id: transferSourceHouseholdId, name: 'にんじん' },
    ]);
  });

  it('他世帯の名称は delete しても影響行数0になり、行も残る', async () => {
    await withTransaction(connection, ownerDeletionHouseholdId, async (tx) => {
      await tx`
        insert into stock_item_names (household_id, name)
        values (${ownerDeletionHouseholdId}, 'にんじん')
      `;
    });

    const deletedRows = await withTransaction(connection, strangerDeletionHouseholdId, (tx) => {
      return tx<{ name: string }[]>`
        delete from stock_item_names
        where household_id = ${ownerDeletionHouseholdId}
        returning name
      `;
    });

    const rowsVisibleToOwner = await withTransaction(connection, ownerDeletionHouseholdId, (tx) => {
      return tx<{ name: string }[]>`
        select name from stock_item_names where household_id = ${ownerDeletionHouseholdId}
      `;
    });

    // C-9 / B-50d 規則8: delete の using に外れた行は消せない。**例外ではなく影響行数0**。
    expect([...deletedRows]).toEqual([]);
    // 行が在るのに0件であることの裏取り。
    expect([...rowsVisibleToOwner]).toEqual([{ name: 'にんじん' }]);
  });

  it('自世帯の名称は update でき、影響行数1が返る', async () => {
    await withTransaction(connection, selfUpdateHouseholdId, async (tx) => {
      await tx`
        insert into stock_item_names (household_id, name)
        values (${selfUpdateHouseholdId}, 'にんじん')
      `;
    });

    const updatedRows = await withTransaction(connection, selfUpdateHouseholdId, (tx) => {
      return tx<{ name: string }[]>`
        update stock_item_names set name = 'たまねぎ'
        where household_id = ${selfUpdateHouseholdId}
        returning name
      `;
    });

    const visibleRows = await withTransaction(connection, selfUpdateHouseholdId, (tx) => {
      return tx<{ name: string }[]>`
        select name from stock_item_names where household_id = ${selfUpdateHouseholdId}
      `;
    });

    // 「影響行数0」の対。同じ数え方で0でない値が返ることを1度見ないと、`returning` が
    // 常に0を返す形でも using が壊れていても、上の0件のケースは緑のまま通る。
    expect([...updatedRows]).toEqual([{ name: 'たまねぎ' }]);
    expect([...visibleRows]).toEqual([{ name: 'たまねぎ' }]);
  });

  it('自世帯の名称は delete でき、影響行数1が返る', async () => {
    await withTransaction(connection, selfDeletionHouseholdId, async (tx) => {
      await tx`
        insert into stock_item_names (household_id, name)
        values (${selfDeletionHouseholdId}, 'にんじん')
      `;
    });

    const deletedRows = await withTransaction(connection, selfDeletionHouseholdId, (tx) => {
      return tx<{ name: string }[]>`
        delete from stock_item_names
        where household_id = ${selfDeletionHouseholdId}
        returning name
      `;
    });

    const visibleRows = await withTransaction(connection, selfDeletionHouseholdId, (tx) => {
      return tx<{ name: string }[]>`
        select name from stock_item_names where household_id = ${selfDeletionHouseholdId}
      `;
    });

    // 「影響行数0」の対。
    expect([...deletedRows]).toEqual([{ name: 'にんじん' }]);
    expect([...visibleRows]).toEqual([]);
  });

  it('空白だけの名称の行は DB が拒む', async () => {
    // B-50d 規則9: 在庫品の名称と同じ検査（`stock_items_name_not_blank`）を掛ける。
    // 空白だけの名称は補完に出しても選びようが無い。
    await expect(
      withTransaction(connection, blankNameHouseholdId, (tx) => {
        return tx`
          insert into stock_item_names (household_id, name)
          values (${blankNameHouseholdId}, '   ')
        `;
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  // ここから4件は述語そのものを突き合わせる。**振る舞いでは固定できない**ため —
  // update / delete が where で行を指す以上、その行はまず select のポリシーを通らないと
  // 走査に載らない（先行 `stockItemsRls.test.ts`）。**述語の文字列を期待値に書かない**
  // （正規化の形は Postgres の版で変わりうる）。同じ正規化を通った者どうしを比べる。

  it('4つの操作それぞれにポリシーが入っている', async () => {
    const policies = await stockItemNamePolicies();

    // ADR-056 / B-50d 規則8: 表ごとに4本。`for all` に畳まれた・1本消えた場合に、下の
    // 3件が `undefined` どうしの比較になる前に、読める形でここが落ちる。
    expect([...policies.keys()].sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
  });

  it('update ポリシーの using は select ポリシーと同じ述語である', async () => {
    const policies = await stockItemNamePolicies();

    const selectPredicate = policies.get('SELECT')?.qual;
    const updatePredicate = policies.get('UPDATE')?.qual;

    // 比べる前に片方が取れていることを見る。取れていないと undefined どうしが等しくなる。
    expect(selectPredicate).toBeTruthy();
    // C-9: 他世帯の行を掴めないこと。
    expect(updatePredicate).toBe(selectPredicate);
  });

  it('update ポリシーの with check は insert ポリシーと同じ述語である', async () => {
    const policies = await stockItemNamePolicies();

    const insertPredicate = policies.get('INSERT')?.with_check;
    const updatePredicate = policies.get('UPDATE')?.with_check;

    expect(insertPredicate).toBeTruthy();
    // C-9: 自世帯の行を他世帯へ移せないこと。
    expect(updatePredicate).toBe(insertPredicate);
  });

  it('delete ポリシーの using は select ポリシーと同じ述語である', async () => {
    const policies = await stockItemNamePolicies();

    const selectPredicate = policies.get('SELECT')?.qual;
    const deletePredicate = policies.get('DELETE')?.qual;

    expect(selectPredicate).toBeTruthy();
    // C-9: 他世帯の行を消せないこと。
    expect(deletePredicate).toBe(selectPredicate);
  });
});
