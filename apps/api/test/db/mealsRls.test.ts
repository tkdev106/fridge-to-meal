import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import type { MealTable } from '../support/db/MealRows.js';
import {
  MEAL_TABLES,
  insertRow,
  prepareParentMeal,
  selectHouseholdIds,
} from '../support/db/MealRows.js';
import { withTransaction } from '../support/db/WithTransaction.js';

/**
 * 献立の4表に対する行レベルセキュリティの回帰（B-44 設計 規則11 / ADR-029 決定2・決定3 /
 * ADR-028 / NFR-09 / C-9）。**`pnpm test:db` でだけ走る** — `pnpm test` は
 * `apps/api/test/db/**` を除外する。
 *
 * 繋ぐのは `authenticator` だけ。所有者（`postgres`）の接続を使うと行レベルセキュリティが
 * 素通りし、**RLS が無くても緑になる**（先行 `stockItemsRls.test.ts` 規則1）。
 *
 * **世帯 ID と献立 ID はケースごと・表ごとに固有の固定値を使い、使い回さない。**
 * 表は `globalSetup` で1度だけ作られ、ファイルとケースをまたいで共有されるため。
 * **後片付けはしない。**
 *
 * **ここに表の制約（check・外部キー・一意）を混ぜない** — check 違反の赤を RLS の赤と
 * 読み違える。そちらは `mealsTable.test.ts`（設計 4章）。
 */

type RlsSample = {
  readonly owner: string;
  readonly stranger: string;
  readonly mealId: string;
};

/** 他世帯の行が読めないことを見るケースの標本（表ごとに固有）。 */
const invisibleRowSamples: Readonly<Record<MealTable, RlsSample>> = {
  meals: {
    owner: 'a1a1a1a1-0001-4000-8000-000000000001',
    stranger: 'a1a1a1a1-0001-4000-8000-000000000002',
    mealId: 'a1a1a1a1-0001-4000-8000-00000000000a',
  },
  meal_ingredients: {
    owner: 'a1a1a1a1-0002-4000-8000-000000000001',
    stranger: 'a1a1a1a1-0002-4000-8000-000000000002',
    mealId: 'a1a1a1a1-0002-4000-8000-00000000000a',
  },
  cooking_steps: {
    owner: 'a1a1a1a1-0003-4000-8000-000000000001',
    stranger: 'a1a1a1a1-0003-4000-8000-000000000002',
    mealId: 'a1a1a1a1-0003-4000-8000-00000000000a',
  },
  cooking_records: {
    owner: 'a1a1a1a1-0004-4000-8000-000000000001',
    stranger: 'a1a1a1a1-0004-4000-8000-000000000002',
    mealId: 'a1a1a1a1-0004-4000-8000-00000000000a',
  },
};

/** 他世帯の世帯 ID を持つ行を作ろうとするケースの標本（表ごとに固有）。 */
const uncreatableRowSamples: Readonly<Record<MealTable, RlsSample>> = {
  meals: {
    owner: 'b2b2b2b2-0001-4000-8000-000000000001',
    stranger: 'b2b2b2b2-0001-4000-8000-000000000002',
    mealId: 'b2b2b2b2-0001-4000-8000-00000000000a',
  },
  meal_ingredients: {
    owner: 'b2b2b2b2-0002-4000-8000-000000000001',
    stranger: 'b2b2b2b2-0002-4000-8000-000000000002',
    mealId: 'b2b2b2b2-0002-4000-8000-00000000000a',
  },
  cooking_steps: {
    owner: 'b2b2b2b2-0003-4000-8000-000000000001',
    stranger: 'b2b2b2b2-0003-4000-8000-000000000002',
    mealId: 'b2b2b2b2-0003-4000-8000-00000000000a',
  },
  cooking_records: {
    owner: 'b2b2b2b2-0004-4000-8000-000000000001',
    stranger: 'b2b2b2b2-0004-4000-8000-000000000002',
    mealId: 'b2b2b2b2-0004-4000-8000-00000000000a',
  },
};

// 述語を読むだけで行を書かない世帯。読むのは `APP_CONNECTION_STRING` のまま
// （`authenticated` でも `pg_policies` は読める）。所有者では繋がない。
const predicateReaderHouseholdId = '30303030-3030-4030-8030-303030303030';

const connection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await connection.end();
});

type PolicyRow = { cmd: string; qual: string | null; with_check: string | null };

/**
 * ある表に実際に入っているポリシーを、**操作（`cmd`）で引ける形**にして返す。
 *
 * **`policyname` ではなく `cmd` で引く。** 名前で引くと、振る舞いを変えない改名で
 * `undefined` どうしの比較になり、**理由の読めない赤**になる（`docs/testing.md` 4章）。
 */
async function policiesOf(table: MealTable): Promise<Map<string, PolicyRow>> {
  const readRows = await withTransaction(connection, predicateReaderHouseholdId, (tx) => {
    return tx<PolicyRow[]>`
      select cmd, qual, with_check
      from pg_policies
      where tablename = ${table}
    `;
  });

  return new Map(readRows.map((row) => [row.cmd, row]));
}

const eachTable = it.each(MEAL_TABLES);

describe('献立の行レベルセキュリティ', () => {
  eachTable('他世帯の %s の行は識別子で絞って読んでも0行になる', async (table) => {
    const sample = invisibleRowSamples[table];

    // 他世帯の行は**その世帯のクレーム**で置く。自世帯のクレームでは insert の
    // with check に外れて作れない。
    await withTransaction(connection, sample.owner, async (tx) => {
      await prepareParentMeal(tx, table, { mealId: sample.mealId, householdId: sample.owner });
      await insertRow(tx, table, { mealId: sample.mealId, householdId: sample.owner });
    });

    const rowsVisibleToStranger = await withTransaction(connection, sample.stranger, (tx) => {
      return selectHouseholdIds(tx, table, sample.mealId);
    });

    const rowsVisibleToOwner = await withTransaction(connection, sample.owner, (tx) => {
      return selectHouseholdIds(tx, table, sample.mealId);
    });

    // C-9 / NFR-09 / 設計 規則11: 「見えない」は**例外ではなく0行**で表す。
    expect([...rowsVisibleToStranger]).toEqual([]);
    // 0行が「行が無いから」ではないことの裏取り。**子表も自分の household_id で
    // 分離される**（設計 規則11。親への exists に寄りかからない）。
    expect([...rowsVisibleToOwner]).toEqual([{ household_id: sample.owner }]);
  });

  eachTable('他世帯の世帯 ID を持つ %s の行は作れない', async (table) => {
    const sample = uncreatableRowSamples[table];

    // 親の献立は持ち主の世帯で置いておく。**外部キーではなく RLS で拒まれる**ことを
    // 見るため、親が居ないせいの失敗を先に取り除く（設計 規則10）。
    await withTransaction(connection, sample.owner, (tx) => {
      return prepareParentMeal(tx, table, { mealId: sample.mealId, householdId: sample.owner });
    });

    await expect(
      withTransaction(connection, sample.stranger, (tx) => {
        return insertRow(tx, table, { mealId: sample.mealId, householdId: sample.owner });
      }),
      // 文言は Postgres の版とロケールで変わる。SQLSTATE で照合する。
    ).rejects.toMatchObject({ code: '42501' });

    const rowsVisibleToOwner = await withTransaction(connection, sample.owner, (tx) => {
      return selectHouseholdIds(tx, table, sample.mealId);
    });

    // C-9: 例外だけでは「書けたうえで見えないだけ」と見分けがつかない。行の持ち主に
    // なるはずだった世帯のクレームで読み、書かれていないことまで見る。
    // （子表のときに親の献立が見えても、読んでいるのは子表である。）
    expect([...rowsVisibleToOwner]).toEqual([]);
  });

  // ここから下は述語そのものを突き合わせる。**振る舞いでは固定できない**ため —
  // update / delete が where で行を指す以上、その行はまず select のポリシーを通らないと
  // 走査に載らず、「select は通るが update の using で弾かれる」入力が存在しない
  // （`docs/testing.md` 4章）。**述語の文字列を期待値に書かない。**

  eachTable('%s の4つの操作それぞれにポリシーが入っている', async (table) => {
    const policies = await policiesOf(table);

    // 1本に畳まれた（`for all`）・1本消えた場合に、下の3件が `undefined` どうしの
    // 比較になる前に、**読める形**でここが落ちる。ADR-029 決定2 は4本を成果物として
    // 固定している。
    expect([...policies.keys()].sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
  });

  eachTable('%s の update ポリシーの using は select ポリシーと同じ述語である', async (table) => {
    const policies = await policiesOf(table);

    const selectPredicate = policies.get('SELECT')?.qual;
    const updatePredicate = policies.get('UPDATE')?.qual;

    // 比べる前に片方が取れていることを見る。取れていないとポリシーが1本も無くても
    // undefined どうしが等しくなり、緑のまま通る。
    expect(selectPredicate).toBeTruthy();
    // C-9: 他世帯の行を掴めないこと。
    expect(updatePredicate).toBe(selectPredicate);
  });

  eachTable(
    '%s の update ポリシーの with check は insert ポリシーと同じ述語である',
    async (table) => {
      const policies = await policiesOf(table);

      const insertPredicate = policies.get('INSERT')?.with_check;
      const updatePredicate = policies.get('UPDATE')?.with_check;

      expect(insertPredicate).toBeTruthy();
      // C-9: 自世帯の行を他世帯へ移せないこと。
      expect(updatePredicate).toBe(insertPredicate);
    },
  );

  eachTable('%s の delete ポリシーの using は select ポリシーと同じ述語である', async (table) => {
    const policies = await policiesOf(table);

    const selectPredicate = policies.get('SELECT')?.qual;
    const deletePredicate = policies.get('DELETE')?.qual;

    expect(selectPredicate).toBeTruthy();
    // C-9: 他世帯の行を消せないこと。
    expect(deletePredicate).toBe(selectPredicate);
  });

  it('4表の select の述語は互いに同一である', async () => {
    // 設計 規則11 の理由(a)(b): 子表が `exists (select 1 from meals …)` に寄りかかると
    // 4表の述語が揃わず、1本ずつ緩めたときの効きが別の表の緑と絡む。**同じ形の述語が
    // 表ごとに自足している**ことを、文字列を書かずに突き合わせる。
    const [mealsPolicies, ...childPolicies] = await Promise.all(
      MEAL_TABLES.map((table) => policiesOf(table)),
    );

    const mealsPredicate = mealsPolicies?.get('SELECT')?.qual;

    expect(mealsPredicate).toBeTruthy();
    for (const policies of childPolicies) {
      expect(policies.get('SELECT')?.qual).toBe(mealsPredicate);
    }
  });
});
