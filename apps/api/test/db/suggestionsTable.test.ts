import postgres from 'postgres';
import type { TransactionSql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import {
  SUGGESTION_CHILD_TABLES,
  insertSuggestion,
  insertSuggestionChildRow,
} from '../support/db/SuggestionRows.js';
import { withTransaction } from '../support/db/WithTransaction.js';

/**
 * 提案の3表の**作り**（制約）の守り（B-45 設計 規則11・12・14 / C-15 / ADR-008 / ADR-010 /
 * ADR-056）。**`pnpm test:db` でだけ走る。**
 *
 * **行レベルセキュリティはここで見ない**（`suggestionsRls.test.ts`）。混ぜると check 違反の
 * 赤を RLS の赤と読み違える（設計 4章）。ここは自世帯の行だけを扱う — **ただし複合外部キーの
 * ケースだけは、他世帯の親を置かないと確かめられない**（設計 規則12）。
 *
 * **世帯 ID と提案 ID はケースごとに固有の固定値を使い、後片付けをしない。**
 * 表は `globalSetup` で1度だけ作られ、ファイルとケースをまたいで共有される。
 *
 * 例外の照合は文言ではなく SQLSTATE で行う（版とロケールで文言が変わる）。
 */
const householdId = 'e5e5e5e5-0000-4000-8000-000000000001';

/** 複合外部キーのケースで親を持つ他世帯（表ごとに固有）。 */
const foreignParentSamples = {
  suggestion_entries: {
    household: 'e5e5e5e5-0001-4000-8000-000000000001',
    stranger: 'e5e5e5e5-0001-4000-8000-000000000002',
    suggestionId: 'e5e5e5e5-0001-4000-8000-00000000000a',
  },
  pantry_snapshot_stock_items: {
    household: 'e5e5e5e5-0002-4000-8000-000000000001',
    stranger: 'e5e5e5e5-0002-4000-8000-000000000002',
    suggestionId: 'e5e5e5e5-0002-4000-8000-00000000000a',
  },
} as const;

const danglingMealSuggestionId = 'e5e5e5e5-0003-4000-8000-00000000000a';
const unknownOriginSuggestionId = 'e5e5e5e5-0004-4000-8000-00000000000a';
const reusedOriginSuggestionId = 'e5e5e5e5-0005-4000-8000-00000000000a';
const negativePositionSuggestionId = 'e5e5e5e5-0006-4000-8000-00000000000a';
const duplicatePositionSuggestionId = 'e5e5e5e5-0007-4000-8000-00000000000a';
const blankNameSuggestionId = 'e5e5e5e5-0008-4000-8000-00000000000a';
const blankAmountSuggestionId = 'e5e5e5e5-0009-4000-8000-00000000000a';
const noAmountSuggestionId = 'e5e5e5e5-000a-4000-8000-00000000000a';

/** 献立の表に置かない献立の識別子（設計 規則11）。 */
const absentMealId = 'e5e5e5e5-0003-4000-8000-0000000000bb';
/** 由来のケースで提案の1件が指す献立の識別子。献立の表には置かない。 */
const entryMealId = 'e5e5e5e5-0004-4000-8000-0000000000bb';

const connection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await connection.end();
});

/**
 * 親の提案を置いてから本題の1文を流す。**親は本題ではない** — 子表の行は
 * `(suggestion_id, household_id)` の複合外部キーで親を指す（設計 規則12）。
 */
function withSuggestion<T>(
  suggestionId: string,
  body: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return withTransaction(connection, householdId, async (tx) => {
    await insertSuggestion(tx, { suggestionId, householdId });
    return body(tx);
  });
}

const eachChildTable = it.each(SUGGESTION_CHILD_TABLES);

describe('提案の表の作り', () => {
  eachChildTable(
    '他世帯の提案を指す %s の行は、自世帯の世帯 ID を付けても作れない',
    async (table) => {
      const sample = foreignParentSamples[table];

      // 親の提案は**その世帯のクレーム**で置く。自世帯のクレームでは insert の
      // with check に外れて作れない。
      await withTransaction(connection, sample.household, (tx) => {
        return insertSuggestion(tx, {
          suggestionId: sample.suggestionId,
          householdId: sample.household,
        });
      });

      // 規則12 / ADR-056: 子表の household_id は自分の世帯で RLS の with check を通るが、
      // 親と世帯が食い違うので `(suggestion_id, household_id)` の複合外部キーが拒む。
      await expect(
        withTransaction(connection, sample.stranger, (tx) => {
          return insertSuggestionChildRow(tx, table, {
            suggestionId: sample.suggestionId,
            householdId: sample.stranger,
          });
        }),
      ).rejects.toMatchObject({ code: '23503' });
    },
  );

  it('献立の表に無い献立を指す提案の1件も作れる', async () => {
    // 規則11 / ADR-008: 集約をまたぐ参照は識別子であり、献立への外部キーを張らない。
    const rows = await withSuggestion(danglingMealSuggestionId, async (tx) => {
      await tx`
        insert into suggestion_entries (suggestion_id, household_id, position, meal_id, origin)
        values (${danglingMealSuggestionId}, ${householdId}, 0, ${absentMealId}, 'generated')
      `;
      return tx<{ meal_id: string }[]>`
        select meal_id from suggestion_entries where suggestion_id = ${danglingMealSuggestionId}
      `;
    });

    expect([...rows]).toEqual([{ meal_id: absentMealId }]);
  });

  it('由来が generated でも reused でもない提案の1件は作れない', async () => {
    // 規則14 / C-15: 由来は text ＋ check。enum 型を作らない。
    await expect(
      withSuggestion(unknownOriginSuggestionId, (tx) => {
        return tx`
          insert into suggestion_entries (suggestion_id, household_id, position, meal_id, origin)
          values (${unknownOriginSuggestionId}, ${householdId}, 0, ${entryMealId}, 'mixed')
        `;
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('由来が reused の提案の1件は作れる', async () => {
    // 規則14: 上の check が広すぎ／狭すぎるときに、こちらが落ちる
    // （generated は道具の既定値として各ケースで通っている）。
    const rows = await withSuggestion(reusedOriginSuggestionId, async (tx) => {
      await tx`
        insert into suggestion_entries (suggestion_id, household_id, position, meal_id, origin)
        values (${reusedOriginSuggestionId}, ${householdId}, 0, ${entryMealId}, 'reused')
      `;
      return tx<{ origin: string }[]>`
        select origin from suggestion_entries where suggestion_id = ${reusedOriginSuggestionId}
      `;
    });

    expect([...rows]).toEqual([{ origin: 'reused' }]);
  });

  eachChildTable('位置が負の %s の行は作れない', async (table) => {
    // 規則14 / 規則5: position は集約の配列の添字そのもの。負の添字は無い。
    await expect(
      withSuggestion(negativePositionSuggestionId, (tx) => {
        return insertSuggestionChildRow(tx, table, {
          suggestionId: negativePositionSuggestionId,
          householdId,
          position: -1,
        });
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  eachChildTable('同じ提案で同じ位置の %s の行を2件は作れない', async (table) => {
    // 設計 5章: 主キーは (suggestion_id, position)。同じ位置が2件あると
    // 復元した集約の並びが決まらない（規則5）。
    await expect(
      withSuggestion(duplicatePositionSuggestionId, async (tx) => {
        await insertSuggestionChildRow(tx, table, {
          suggestionId: duplicatePositionSuggestionId,
          householdId,
          position: 0,
        });
        await insertSuggestionChildRow(tx, table, {
          suggestionId: duplicatePositionSuggestionId,
          householdId,
          position: 0,
        });
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('名称が空白だけの在庫スナップショットの在庫品は作れない', async () => {
    // 規則14 / ADR-010: 空白だけの名称は DB でも断つ。
    await expect(
      withSuggestion(blankNameSuggestionId, (tx) => {
        return tx`
          insert into pantry_snapshot_stock_items
            (suggestion_id, household_id, position, name, amount, expiry_date)
          values (${blankNameSuggestionId}, ${householdId}, 0, '   ', '2本', null)
        `;
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('分量が空白だけの在庫スナップショットの在庫品は作れない', async () => {
    // 規則14 / ADR-010: 空白だけの分量は「分量なし」と見分けがつかない。
    // 表し方を2通りにしない。
    await expect(
      withSuggestion(blankAmountSuggestionId, (tx) => {
        return tx`
          insert into pantry_snapshot_stock_items
            (suggestion_id, household_id, position, name, amount, expiry_date)
          values (${blankAmountSuggestionId}, ${householdId}, 0, 'にんじん', '   ', null)
        `;
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('分量の無い在庫スナップショットの在庫品は作れる', async () => {
    // 規則14: 「分量なし」は null。上の check が null まで断つと落ちる。
    const rows = await withSuggestion(noAmountSuggestionId, async (tx) => {
      await tx`
        insert into pantry_snapshot_stock_items
          (suggestion_id, household_id, position, name, amount, expiry_date)
        values (${noAmountSuggestionId}, ${householdId}, 0, 'にんじん', null, null)
      `;
      return tx<{ amount: string | null }[]>`
        select amount from pantry_snapshot_stock_items
        where suggestion_id = ${noAmountSuggestionId}
      `;
    });

    expect([...rows]).toEqual([{ amount: null }]);
  });
});
