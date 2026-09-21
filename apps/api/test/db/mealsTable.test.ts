import postgres from 'postgres';
import type { TransactionSql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import { MEAL_CHILD_TABLES, insertChildRow, insertMeal } from '../support/db/MealRows.js';
import { withTransaction } from '../support/db/WithTransaction.js';

/**
 * 献立の4表の**作り**（制約）の守り（B-44 設計 規則10・15・16 / C-3 / C-16 / ADR-010）。
 * **`pnpm test:db` でだけ走る。**
 *
 * **行レベルセキュリティはここで見ない**（`mealsRls.test.ts`）。混ぜると check 違反の
 * 赤を RLS の赤と読み違える（設計 4章）。ここは自世帯の行だけを扱う。
 *
 * **世帯 ID と献立 ID はケースごとに固有の固定値を使い、後片付けをしない。**
 * 表は `globalSetup` で1度だけ作られ、ファイルとケースをまたいで共有される。
 *
 * 例外の照合は文言ではなく SQLSTATE で行う（版とロケールで文言が変わる）。
 */
const householdId = 'c3c3c3c3-0000-4000-8000-000000000001';

const danglingMealId = 'c3c3c3c3-0001-4000-8000-00000000000a';
const unknownKindMealId = 'c3c3c3c3-0002-4000-8000-00000000000a';
const seasoningMealId = 'c3c3c3c3-0003-4000-8000-00000000000a';
const blankTitleMealId = 'c3c3c3c3-0004-4000-8000-00000000000a';
const blankNameMealId = 'c3c3c3c3-0005-4000-8000-00000000000a';
const blankBodyMealId = 'c3c3c3c3-0006-4000-8000-00000000000a';
const blankAmountMealId = 'c3c3c3c3-0007-4000-8000-00000000000a';
const noAmountMealId = 'c3c3c3c3-0008-4000-8000-00000000000a';
const negativePositionMealId = 'c3c3c3c3-0009-4000-8000-00000000000a';
const duplicatePositionMealId = 'c3c3c3c3-000a-4000-8000-00000000000a';
const repeatedCookingMealId = 'c3c3c3c3-000b-4000-8000-00000000000a';

const connection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await connection.end();
});

/**
 * 親の献立を置いてから本題の1文を流す。**親は本題ではない** — 子表の行は
 * `(meal_id, household_id)` の複合外部キーで親を指す（設計 規則10）。
 */
function withMeal<T>(mealId: string, body: (tx: TransactionSql) => Promise<T>): Promise<T> {
  return withTransaction(connection, householdId, async (tx) => {
    await insertMeal(tx, { mealId, householdId });
    return body(tx);
  });
}

const eachChildTable = it.each(MEAL_CHILD_TABLES);

describe('献立の表の作り', () => {
  eachChildTable(
    '自世帯に無い献立を指す %s の行は自世帯の世帯 ID を付けても作れない',
    async (table) => {
      // 設計 規則10: 親と子で世帯が食い違う行を**型ではなく DB が不可能にする**。
      // 親の献立を置かないまま子を書く。
      await expect(
        withTransaction(connection, householdId, (tx) => {
          return insertChildRow(tx, table, { mealId: danglingMealId, householdId });
        }),
      ).rejects.toMatchObject({ code: '23503' });
    },
  );

  it('kind が main でも seasoning でもない材料は作れない', async () => {
    // C-16 / 設計 規則15: 種別は text ＋ check。enum 型を作らない。
    await expect(
      withMeal(unknownKindMealId, (tx) => {
        return tx`
          insert into meal_ingredients (meal_id, household_id, position, name, kind, amount)
          values (${unknownKindMealId}, ${householdId}, 0, 'にんじん', 'garnish', '200g')
        `;
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('kind が seasoning の材料は作れる', async () => {
    // C-16: 主材料だけが充足の突き合わせの対象になるが、調味料も材料として保存される。
    // 上の check が広すぎ／狭すぎるときに、こちらが落ちる。
    const rows = await withMeal(seasoningMealId, async (tx) => {
      await tx`
        insert into meal_ingredients (meal_id, household_id, position, name, kind, amount)
        values (${seasoningMealId}, ${householdId}, 0, 'しょうゆ', 'seasoning', '大さじ1')
      `;
      return tx<{ kind: string }[]>`
        select kind from meal_ingredients where meal_id = ${seasoningMealId}
      `;
    });

    expect([...rows]).toEqual([{ kind: 'seasoning' }]);
  });

  it('名称が空白だけの献立は作れない', async () => {
    // 設計 規則16: 空白だけの値は DB でも断つ。ドメインの生成関数（createMeal）と
    // 同じ不変条件を、別の経路で書かれた行にも掛ける。
    await expect(
      withTransaction(connection, householdId, (tx) => {
        return insertMeal(tx, { mealId: blankTitleMealId, householdId, title: '   ' });
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('名称が空白だけの材料は作れない', async () => {
    // 設計 規則16 / C-5: 名称は完全一致で突き合わされる（C-6）ため、空白だけの名称は
    // 永久に不足材料になる。
    await expect(
      withMeal(blankNameMealId, (tx) => {
        return tx`
          insert into meal_ingredients (meal_id, household_id, position, name, kind, amount)
          values (${blankNameMealId}, ${householdId}, 0, '   ', 'main', '200g')
        `;
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('本文が空白だけの手順は作れない', async () => {
    // 設計 規則16
    await expect(
      withMeal(blankBodyMealId, (tx) => {
        return tx`
          insert into cooking_steps (meal_id, household_id, position, body)
          values (${blankBodyMealId}, ${householdId}, 0, '   ')
        `;
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('分量が空白だけの材料は作れない', async () => {
    // ADR-010 / 設計 規則16: 分量は自由文字列だが、空白だけの分量は「分量なし」と
    // 見分けがつかない。表し方を2通りにしない。
    await expect(
      withMeal(blankAmountMealId, (tx) => {
        return tx`
          insert into meal_ingredients (meal_id, household_id, position, name, kind, amount)
          values (${blankAmountMealId}, ${householdId}, 0, 'にんじん', 'main', '   ')
        `;
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('分量の無い材料は作れる', async () => {
    // ADR-034 / 設計 規則7: 「分量なし」は null。上の check が null まで断つと落ちる。
    const rows = await withMeal(noAmountMealId, async (tx) => {
      await tx`
        insert into meal_ingredients (meal_id, household_id, position, name, kind, amount)
        values (${noAmountMealId}, ${householdId}, 0, 'にんじん', 'main', null)
      `;
      return tx<{ amount: string | null }[]>`
        select amount from meal_ingredients where meal_id = ${noAmountMealId}
      `;
    });

    expect([...rows]).toEqual([{ amount: null }]);
  });

  eachChildTable('位置が負の %s の行は作れない', async (table) => {
    // 設計 規則16 / 10章: position は集約の配列の添字そのもの。負の添字は無い。
    await expect(
      withMeal(negativePositionMealId, (tx) => {
        return insertChildRow(tx, table, {
          mealId: negativePositionMealId,
          householdId,
          position: -1,
        });
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  eachChildTable('同じ献立で同じ位置の %s の行を2件は作れない', async (table) => {
    // C-3 / 設計 規則8・9: 位置が集約の中の並びを決める。同じ位置が2件あると
    // 復元した集約の並びが決まらず、`on conflict do nothing` の当たり先も消える。
    await expect(
      withMeal(duplicatePositionMealId, async (tx) => {
        await insertChildRow(tx, table, {
          mealId: duplicatePositionMealId,
          householdId,
          position: 0,
        });
        await insertChildRow(tx, table, {
          mealId: duplicatePositionMealId,
          householdId,
          position: 0,
        });
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('同じ献立に位置を変えて調理記録を複数足せる', async () => {
    // C-3 / 設計 規則9: 献立は生成後に編集できず、**追加されるのは調理記録のみ**。
    // 上の一意が誤って (meal_id) だけに置かれると、一意の守りは緑のまま通ってしまう。
    // 対になるこの1件が、追加のみが効いていることを見る。
    const rows = await withMeal(repeatedCookingMealId, async (tx) => {
      await insertChildRow(tx, 'cooking_records', {
        mealId: repeatedCookingMealId,
        householdId,
        position: 0,
      });
      await insertChildRow(tx, 'cooking_records', {
        mealId: repeatedCookingMealId,
        householdId,
        position: 1,
      });
      return tx<{ position: number }[]>`
        select position from cooking_records
        where meal_id = ${repeatedCookingMealId}
        order by position
      `;
    });

    expect([...rows]).toEqual([{ position: 0 }, { position: 1 }]);
  });
});
