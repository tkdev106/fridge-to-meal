import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import type { Meal } from '../../src/contexts/meal/domain/entity/Meal.js';
import { createMeal, withCookingRecord } from '../../src/contexts/meal/domain/entity/Meal.js';
import { MealRuleViolation } from '../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { amountOf } from '../../src/contexts/meal/domain/value/Amount.js';
import type { CookingRecord } from '../../src/contexts/meal/domain/value/CookingRecord.js';
import { createCookingRecord } from '../../src/contexts/meal/domain/value/CookingRecord.js';
import { cookingStepOf } from '../../src/contexts/meal/domain/value/CookingStep.js';
import { dateTimeOf } from '../../src/contexts/meal/domain/value/DateTime.js';
import type { MealId } from '../../src/contexts/meal/domain/value/MealId.js';
import { mealIdOf } from '../../src/contexts/meal/domain/value/MealId.js';
import type {
  MealIngredient,
  MealIngredientKind,
} from '../../src/contexts/meal/domain/value/MealIngredient.js';
import { createMealIngredient } from '../../src/contexts/meal/domain/value/MealIngredient.js';
import { MealRepositoryImpl } from '../../src/contexts/meal/infrastructure/MealRepositoryImpl.js';
import type { HouseholdTransaction } from '../../src/shared/infrastructure/db/HouseholdTransaction.js';
import { withHouseholdTransaction } from '../../src/shared/infrastructure/db/HouseholdTransaction.js';
import type { HouseholdId } from '../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../src/shared/domain/HouseholdId.js';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';

/**
 * ローカル Postgres に対する `MealRepositoryImpl` の1周目
 * （B-44 設計 規則2・4・5・6・7 と 7章 / C-1 / C-3 / C-16 / ADR-010 / ADR-034）。
 * **`pnpm test:db` でだけ走る** — `pnpm test` は `apps/api/test/db/**` を除外する。
 *
 * 繋ぐのは `authenticator` だけ。所有者（`postgres`）の接続を使うと行レベルセキュリティが
 * 素通りし、**RLS が無くても緑になる**（B-44 設計 9章）。
 *
 * **トランザクションを開くのは `withHouseholdTransaction`（`shared/infrastructure/` のもの）である**
 * （B-17 で pantry から移った。本番と同じ1つの規則を通る）。
 *
 * **世帯 ID と献立 ID はケースごとに固有の固定値を使い、使い回さない。** 表は
 * `globalSetup` で1度だけ作られ、ファイルとケースをまたいで共有されるため。
 * **後片付けはしない。** 1周目の `mealsRls.test.ts` / `mealsTable.test.ts` とも
 * 先頭の並び（`d4d4d4d4`）で分けてある。
 */
const roundTripHouseholdId = householdIdOf('d4d4d4d4-0001-4000-8000-000000000001');
const roundTripMealId = mealIdOf('d4d4d4d4-0001-4000-8000-0000000000a1');

const emptyListingHouseholdId = householdIdOf('d4d4d4d4-0002-4000-8000-000000000002');

const listingHouseholdId = householdIdOf('d4d4d4d4-0003-4000-8000-000000000003');
const listingMealId1 = mealIdOf('d4d4d4d4-0003-4000-8000-0000000000a1');
const listingMealId2 = mealIdOf('d4d4d4d4-0003-4000-8000-0000000000a2');

const perMealIngredientsHouseholdId = householdIdOf('d4d4d4d4-0004-4000-8000-000000000004');
const perMealIngredientsMealId1 = mealIdOf('d4d4d4d4-0004-4000-8000-0000000000a1');
const perMealIngredientsMealId2 = mealIdOf('d4d4d4d4-0004-4000-8000-0000000000a2');

const ingredientOrderHouseholdId = householdIdOf('d4d4d4d4-0005-4000-8000-000000000005');
const ingredientOrderMealId = mealIdOf('d4d4d4d4-0005-4000-8000-0000000000a1');

const stepOrderHouseholdId = householdIdOf('d4d4d4d4-0006-4000-8000-000000000006');
const stepOrderMealId = mealIdOf('d4d4d4d4-0006-4000-8000-0000000000a1');

const cookingRecordOrderHouseholdId = householdIdOf('d4d4d4d4-0007-4000-8000-000000000007');
const cookingRecordOrderMealId = mealIdOf('d4d4d4d4-0007-4000-8000-0000000000a1');

const whitespaceHouseholdId = householdIdOf('d4d4d4d4-0008-4000-8000-000000000008');
const whitespaceMealId = mealIdOf('d4d4d4d4-0008-4000-8000-0000000000a1');

const kindHouseholdId = householdIdOf('d4d4d4d4-0009-4000-8000-000000000009');
const kindMealId = mealIdOf('d4d4d4d4-0009-4000-8000-0000000000a1');

const amountHouseholdId = householdIdOf('d4d4d4d4-000a-4000-8000-00000000000a');
const amountMealId = mealIdOf('d4d4d4d4-000a-4000-8000-0000000000a1');

const noAmountHouseholdId = householdIdOf('d4d4d4d4-000b-4000-8000-00000000000b');
const noAmountMealId = mealIdOf('d4d4d4d4-000b-4000-8000-0000000000a1');

const generatedAtHouseholdId = householdIdOf('d4d4d4d4-000c-4000-8000-00000000000c');
const generatedAtMealId = mealIdOf('d4d4d4d4-000c-4000-8000-0000000000a1');

const cookedAtHouseholdId = householdIdOf('d4d4d4d4-000d-4000-8000-00000000000d');
const cookedAtMealId = mealIdOf('d4d4d4d4-000d-4000-8000-0000000000a1');

const noIngredientsHouseholdId = householdIdOf('d4d4d4d4-000e-4000-8000-00000000000e');
const noIngredientsMealId = mealIdOf('d4d4d4d4-000e-4000-8000-0000000000a1');

const seasoningOnlyHouseholdId = householdIdOf('d4d4d4d4-000f-4000-8000-00000000000f');
const seasoningOnlyMealId = mealIdOf('d4d4d4d4-000f-4000-8000-0000000000a1');

const noStepsHouseholdId = householdIdOf('d4d4d4d4-0010-4000-8000-000000000010');
const noStepsMealId = mealIdOf('d4d4d4d4-0010-4000-8000-0000000000a1');

// 1本の接続で複数のトランザクションを張る。`local` が次のトランザクションへ漏れて
// いないことは、同じ接続を使い回すことでしか見えない（ADR-029 決定3(a)）。
const connection = postgres(APP_CONNECTION_STRING, { max: 1 });
const db = drizzle(connection);

afterAll(async () => {
  await connection.end();
});

/** 材料を1件作る。**本題でない値は省ける** — 省いた分量は「無し」になる（ADR-010）。 */
function ingredient(props: {
  name: string;
  kind?: MealIngredientKind;
  amount?: string | null;
}): MealIngredient {
  return createMealIngredient({
    name: props.name,
    kind: props.kind ?? 'main',
    amount: amountOf(props.amount ?? null),
  });
}

/** 調理記録を1件作る。 */
function cookingRecord(cookedAt: string): CookingRecord {
  return createCookingRecord({ cookedAt: dateTimeOf(cookedAt) });
}

/**
 * 献立を1つ作る。既定は**主材料1件・手順1件・調理記録0件**で、
 * **本題だけが引数に現れる**形にする（`docs/testing.md` 6章）。
 * 素のリテラルを献立として扱わず、必ずドメインの生成関数を通す（B-44 設計 規則5）。
 */
function meal(props: {
  id: MealId;
  householdId: HouseholdId;
  title?: string;
  ingredients?: readonly MealIngredient[];
  steps?: readonly string[];
  generatedAt?: string;
  cookingRecords?: readonly CookingRecord[];
}): Meal {
  return createMeal({
    id: props.id,
    householdId: props.householdId,
    title: props.title ?? 'にんじんの煮物',
    ingredients: props.ingredients ?? [ingredient({ name: 'にんじん', amount: '200g' })],
    steps: (props.steps ?? ['にんじんを切る']).map(cookingStepOf),
    generatedAt: dateTimeOf(props.generatedAt ?? '2026-09-20T09:00:00.000Z'),
    cookingRecords: props.cookingRecords ?? [],
  });
}

/**
 * **クレームを張らない** handle を1つ作る（`withHouseholdTransaction` には無い経路 —
 * 本体は常にクレームを張る。ADR-029 理由(1)）。
 *
 * `set local role authenticated` だけは張る。張らないと `authenticator` に献立の4表の
 * 権限が無く、確かめたい「0行」ではなく権限エラーで落ちる。
 */
function transactionWithoutClaims<T>(body: (tx: HouseholdTransaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role authenticated`);
    return body(tx);
  });
}

/**
 * 実行が投げたものを返す（投げなければ `null`）。**同じ実行を2度走らせない**ための形で、
 * 行を書く実行に `rejects` を2度当てると二重に書いてしまう。
 */
function failureOf(execution: Promise<unknown>): Promise<unknown> {
  return execution.then(
    () => null,
    (error: unknown) => error,
  );
}

/**
 * 一覧から識別子で1件引き当てる。**`findByHousehold` は並び順を約束しない**
 * （設計 規則3）ので、添字で取らない。
 */
function foundMealOf(meals: readonly Meal[], id: MealId): Meal | undefined {
  return meals.find((found) => found.id === id);
}

/**
 * 行を直接差し込む道具。**クレームを張った単位の中で、`authenticator` のまま**使う
 * （所有者の接続を使うと RLS が素通りする）。
 *
 * `test/support/db/MealRows.ts` は名称・本文・`cooked_at` を固定で持つため、位置ごとに
 * 内容を変えるケース（設計 規則4）には足りない。**TransactionSql ではなく drizzle の
 * handle を取る**点も違うので、このファイルに置く。
 */
async function insertMealRow(
  tx: HouseholdTransaction,
  props: { mealId: MealId; householdId: HouseholdId; title?: string; generatedAt?: string },
): Promise<void> {
  await tx.execute(sql`
    insert into meals (id, household_id, title, generated_at)
    values (
      ${props.mealId},
      ${props.householdId},
      ${props.title ?? 'にんじんの煮物'},
      ${props.generatedAt ?? '2026-09-20T09:00:00.000Z'}
    )
  `);
}

async function insertIngredientRow(
  tx: HouseholdTransaction,
  props: {
    mealId: MealId;
    householdId: HouseholdId;
    position: number;
    name: string;
    kind?: MealIngredientKind;
    amount?: string | null;
  },
): Promise<void> {
  await tx.execute(sql`
    insert into meal_ingredients (meal_id, household_id, position, name, kind, amount)
    values (
      ${props.mealId},
      ${props.householdId},
      ${props.position},
      ${props.name},
      ${props.kind ?? 'main'},
      ${props.amount ?? null}
    )
  `);
}

async function insertStepRow(
  tx: HouseholdTransaction,
  props: { mealId: MealId; householdId: HouseholdId; position: number; body: string },
): Promise<void> {
  await tx.execute(sql`
    insert into cooking_steps (meal_id, household_id, position, body)
    values (${props.mealId}, ${props.householdId}, ${props.position}, ${props.body})
  `);
}

async function insertCookingRecordRow(
  tx: HouseholdTransaction,
  props: { mealId: MealId; householdId: HouseholdId; position: number; cookedAt: string },
): Promise<void> {
  await tx.execute(sql`
    insert into cooking_records (meal_id, household_id, position, cooked_at)
    values (${props.mealId}, ${props.householdId}, ${props.position}, ${props.cookedAt})
  `);
}

describe('献立リポジトリの実装（保存と読み戻し）', () => {
  it('保存した献立を同じ世帯の findByHousehold で読み戻せる', async () => {
    const foundMeals = await withHouseholdTransaction(db, roundTripHouseholdId, async (tx) => {
      const repository = new MealRepositoryImpl(tx);
      await repository.save(
        roundTripHouseholdId,
        meal({
          id: roundTripMealId,
          householdId: roundTripHouseholdId,
          title: 'にんじんの煮物',
        }),
      );
      return repository.findByHousehold(roundTripHouseholdId);
    });

    // C-1 / 設計 規則7: 生成した献立が残ること。行と集約の往復が成り立っていることを、
    // 保存したものと同じ値が返ることで見る。
    expect(foundMeals).toHaveLength(1);
    expect(foundMealOf(foundMeals, roundTripMealId)).toMatchObject({
      id: roundTripMealId,
      title: 'にんじんの煮物',
    });
  });

  it('献立が1件も無い世帯には空の配列を返す', async () => {
    const foundMeals = await withHouseholdTransaction(db, emptyListingHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findByHousehold(emptyListingHouseholdId),
    );

    // 設計 7章: 0行は空の配列。`null` でも例外でもない。
    expect(foundMeals).toEqual([]);
  });

  it('その世帯の献立をすべて返す', async () => {
    const foundMeals = await withHouseholdTransaction(db, listingHouseholdId, async (tx) => {
      const repository = new MealRepositoryImpl(tx);
      await repository.save(
        listingHouseholdId,
        meal({ id: listingMealId1, householdId: listingHouseholdId, title: 'にんじんの煮物' }),
      );
      await repository.save(
        listingHouseholdId,
        meal({ id: listingMealId2, householdId: listingHouseholdId, title: 'たまねぎのスープ' }),
      );
      return repository.findByHousehold(listingHouseholdId);
    });

    // 設計 規則3: 献立の列の**並び順を約束しない**。だから期待値も集合で書く —
    // 順序を書くと、約束していないものを守らせることになる。
    expect(foundMeals).toHaveLength(2);
    expect(new Set(foundMeals.map((found) => found.id))).toEqual(
      new Set([listingMealId1, listingMealId2]),
    );
  });

  it('2件の献立を読み戻すと、材料はそれぞれの献立に付く', async () => {
    const foundMeals = await withHouseholdTransaction(
      db,
      perMealIngredientsHouseholdId,
      async (tx) => {
        const repository = new MealRepositoryImpl(tx);
        await repository.save(
          perMealIngredientsHouseholdId,
          meal({
            id: perMealIngredientsMealId1,
            householdId: perMealIngredientsHouseholdId,
            ingredients: [ingredient({ name: 'にんじん' })],
          }),
        );
        await repository.save(
          perMealIngredientsHouseholdId,
          meal({
            id: perMealIngredientsMealId2,
            householdId: perMealIngredientsHouseholdId,
            ingredients: [ingredient({ name: 'たまねぎ' })],
          }),
        );
        return repository.findByHousehold(perMealIngredientsHouseholdId);
      },
    );

    // 設計 規則5: 子の行は自分の献立に付く。世帯だけで引いて配り忘れると取り違える。
    expect(
      foundMealOf(foundMeals, perMealIngredientsMealId1)?.ingredients.map(
        (mealIngredient) => mealIngredient.name,
      ),
    ).toEqual(['にんじん']);
    expect(
      foundMealOf(foundMeals, perMealIngredientsMealId2)?.ingredients.map(
        (mealIngredient) => mealIngredient.name,
      ),
    ).toEqual(['たまねぎ']);
  });

  it('位置の降順に差し込んだ材料の行は、位置の昇順の材料として読み戻る', async () => {
    const foundMeals = await withHouseholdTransaction(
      db,
      ingredientOrderHouseholdId,
      async (tx) => {
        await insertMealRow(tx, {
          mealId: ingredientOrderMealId,
          householdId: ingredientOrderHouseholdId,
        });
        // 差し込む順を位置の降順にする。`order by` の無い実装では、挿入した順が
        // そのまま返って赤くなる。
        await insertIngredientRow(tx, {
          mealId: ingredientOrderMealId,
          householdId: ingredientOrderHouseholdId,
          position: 2,
          name: 'じゃがいも',
        });
        await insertIngredientRow(tx, {
          mealId: ingredientOrderMealId,
          householdId: ingredientOrderHouseholdId,
          position: 1,
          name: 'たまねぎ',
        });
        await insertIngredientRow(tx, {
          mealId: ingredientOrderMealId,
          householdId: ingredientOrderHouseholdId,
          position: 0,
          name: 'にんじん',
        });
        await insertStepRow(tx, {
          mealId: ingredientOrderMealId,
          householdId: ingredientOrderHouseholdId,
          position: 0,
          body: 'にんじんを切る',
        });

        return new MealRepositoryImpl(tx).findByHousehold(ingredientOrderHouseholdId);
      },
    );

    // 設計 規則4: 集約の内部の並びは約束する（位置の昇順）。
    expect(
      foundMealOf(foundMeals, ingredientOrderMealId)?.ingredients.map(
        (mealIngredient) => mealIngredient.name,
      ),
    ).toEqual(['にんじん', 'たまねぎ', 'じゃがいも']);
  });

  it('位置の降順に差し込んだ手順の行は、位置の昇順の手順として読み戻る', async () => {
    const foundMeals = await withHouseholdTransaction(db, stepOrderHouseholdId, async (tx) => {
      await insertMealRow(tx, { mealId: stepOrderMealId, householdId: stepOrderHouseholdId });
      await insertIngredientRow(tx, {
        mealId: stepOrderMealId,
        householdId: stepOrderHouseholdId,
        position: 0,
        name: 'にんじん',
      });
      await insertStepRow(tx, {
        mealId: stepOrderMealId,
        householdId: stepOrderHouseholdId,
        position: 2,
        body: 'しあげる',
      });
      await insertStepRow(tx, {
        mealId: stepOrderMealId,
        householdId: stepOrderHouseholdId,
        position: 1,
        body: 'なべに入れる',
      });
      await insertStepRow(tx, {
        mealId: stepOrderMealId,
        householdId: stepOrderHouseholdId,
        position: 0,
        body: 'にんじんを切る',
      });

      return new MealRepositoryImpl(tx).findByHousehold(stepOrderHouseholdId);
    });

    // 設計 規則4: 手順の順序は配列の並びそのもの。入れ替わると作れない献立になる。
    expect(foundMealOf(foundMeals, stepOrderMealId)?.steps).toEqual([
      'にんじんを切る',
      'なべに入れる',
      'しあげる',
    ]);
  });

  it('位置の降順に差し込んだ調理記録の行は、位置の昇順の記録として読み戻る', async () => {
    const foundMeals = await withHouseholdTransaction(
      db,
      cookingRecordOrderHouseholdId,
      async (tx) => {
        await insertMealRow(tx, {
          mealId: cookingRecordOrderMealId,
          householdId: cookingRecordOrderHouseholdId,
        });
        await insertIngredientRow(tx, {
          mealId: cookingRecordOrderMealId,
          householdId: cookingRecordOrderHouseholdId,
          position: 0,
          name: 'にんじん',
        });
        await insertStepRow(tx, {
          mealId: cookingRecordOrderMealId,
          householdId: cookingRecordOrderHouseholdId,
          position: 0,
          body: 'にんじんを切る',
        });
        await insertCookingRecordRow(tx, {
          mealId: cookingRecordOrderMealId,
          householdId: cookingRecordOrderHouseholdId,
          position: 2,
          cookedAt: '2026-09-20T18:30:00.000Z',
        });
        await insertCookingRecordRow(tx, {
          mealId: cookingRecordOrderMealId,
          householdId: cookingRecordOrderHouseholdId,
          position: 1,
          cookedAt: '2026-09-19T18:30:00.000Z',
        });
        await insertCookingRecordRow(tx, {
          mealId: cookingRecordOrderMealId,
          householdId: cookingRecordOrderHouseholdId,
          position: 0,
          cookedAt: '2026-09-18T18:30:00.000Z',
        });

        return new MealRepositoryImpl(tx).findByHousehold(cookingRecordOrderHouseholdId);
      },
    );

    // 設計 規則4 / C-3: 記録された順が事実である。位置が並びを持っている。
    expect(
      foundMealOf(foundMeals, cookingRecordOrderMealId)?.cookingRecords.map(
        (record) => record.cookedAt,
      ),
    ).toEqual(['2026-09-18T18:30:00.000Z', '2026-09-19T18:30:00.000Z', '2026-09-20T18:30:00.000Z']);
  });

  it('材料の名称の前後の空白は落として読み戻す', async () => {
    const foundMeals = await withHouseholdTransaction(db, whitespaceHouseholdId, async (tx) => {
      // 行を直接差し込むのは、`save` を通すと空白がどこで落ちたか見分けられないため。
      await insertMealRow(tx, { mealId: whitespaceMealId, householdId: whitespaceHouseholdId });
      await insertIngredientRow(tx, {
        mealId: whitespaceMealId,
        householdId: whitespaceHouseholdId,
        position: 0,
        name: '  にんじん  ',
      });
      await insertStepRow(tx, {
        mealId: whitespaceMealId,
        householdId: whitespaceHouseholdId,
        position: 0,
        body: 'にんじんを切る',
      });

      return new MealRepositoryImpl(tx).findByHousehold(whitespaceHouseholdId);
    });

    // C-6 / 設計 規則5: 充足判定は名称の完全一致。前後の空白が残ると、同じ食材が
    // 別物になる（行から組むときも `createMealIngredient` を通す）。
    expect(foundMealOf(foundMeals, whitespaceMealId)?.ingredients[0]?.name).toBe('にんじん');
  });

  it('主材料と調味料の種別はそのまま読み戻せる', async () => {
    const foundMeals = await withHouseholdTransaction(db, kindHouseholdId, async (tx) => {
      const repository = new MealRepositoryImpl(tx);
      await repository.save(
        kindHouseholdId,
        meal({
          id: kindMealId,
          householdId: kindHouseholdId,
          ingredients: [
            ingredient({ name: 'にんじん', kind: 'main' }),
            ingredient({ name: 'しお', kind: 'seasoning' }),
          ],
        }),
      );
      return repository.findByHousehold(kindHouseholdId);
    });

    // C-16: 主材料だけが充足の突き合わせに載る。種別が落ちると調味料まで不足に数える。
    expect(
      foundMealOf(foundMeals, kindMealId)?.ingredients.map((mealIngredient) => mealIngredient.kind),
    ).toEqual(['main', 'seasoning']);
  });

  it('分量は自由文字列のまま読み戻せる', async () => {
    const foundMeals = await withHouseholdTransaction(db, amountHouseholdId, async (tx) => {
      const repository = new MealRepositoryImpl(tx);
      await repository.save(
        amountHouseholdId,
        meal({
          id: amountMealId,
          householdId: amountHouseholdId,
          ingredients: [ingredient({ name: 'こむぎこ', amount: '大さじ 1と1/2' })],
        }),
      );
      return repository.findByHousehold(amountHouseholdId);
    });

    // ADR-010 / ADR-034: 分量は自由文字列。数値と単位に分解しない。
    expect(foundMealOf(foundMeals, amountMealId)?.ingredients[0]?.amount).toBe('大さじ 1と1/2');
  });

  it('分量の無い材料は分量なしのまま読み戻せる', async () => {
    const foundMeals = await withHouseholdTransaction(db, noAmountHouseholdId, async (tx) => {
      const repository = new MealRepositoryImpl(tx);
      await repository.save(
        noAmountHouseholdId,
        meal({
          id: noAmountMealId,
          householdId: noAmountHouseholdId,
          // C-16: 主材料が1件も無い献立は作れない。分量なしの材料は調味料のほうに置く。
          ingredients: [
            ingredient({ name: 'にんじん', amount: '200g' }),
            ingredient({ name: 'しお', kind: 'seasoning', amount: null }),
          ],
        }),
      );
      return repository.findByHousehold(noAmountHouseholdId);
    });

    // ADR-010 / 設計 規則7: 「分量なし」は `null` の一通り。空文字に化けさせない。
    expect(foundMealOf(foundMeals, noAmountMealId)?.ingredients[1]?.amount).toBeNull();
  });

  it('生成日時は同じ瞬間として読み戻せる', async () => {
    const foundMeals = await withHouseholdTransaction(db, generatedAtHouseholdId, async (tx) => {
      const repository = new MealRepositoryImpl(tx);
      await repository.save(
        generatedAtHouseholdId,
        meal({
          id: generatedAtMealId,
          householdId: generatedAtHouseholdId,
          generatedAt: '2026-09-20T09:00:00.123Z',
        }),
      );
      return repository.findByHousehold(generatedAtHouseholdId);
    });

    // 設計 規則6 / C-12: UTC の正準形で往復する。ミリ秒を捨てると、同じ秒に生成された
    // 献立の並びが入力の書き方で変わる。
    expect(foundMealOf(foundMeals, generatedAtMealId)?.generatedAt).toBe(
      '2026-09-20T09:00:00.123Z',
    );
  });

  it('調理日時は同じ瞬間として読み戻せる', async () => {
    const foundMeals = await withHouseholdTransaction(db, cookedAtHouseholdId, async (tx) => {
      const repository = new MealRepositoryImpl(tx);
      await repository.save(
        cookedAtHouseholdId,
        meal({
          id: cookedAtMealId,
          householdId: cookedAtHouseholdId,
          cookingRecords: [cookingRecord('2026-09-20T18:30:00.456Z')],
        }),
      );
      return repository.findByHousehold(cookedAtHouseholdId);
    });

    // 設計 規則6 / C-12
    expect(foundMealOf(foundMeals, cookedAtMealId)?.cookingRecords[0]?.cookedAt).toBe(
      '2026-09-20T18:30:00.456Z',
    );
  });

  it('材料の行が1件も無い献立を読み戻すと拒む', async () => {
    const thrown = await failureOf(
      withHouseholdTransaction(db, noIngredientsHouseholdId, async (tx) => {
        await insertMealRow(tx, {
          mealId: noIngredientsMealId,
          householdId: noIngredientsHouseholdId,
        });
        await insertStepRow(tx, {
          mealId: noIngredientsMealId,
          householdId: noIngredientsHouseholdId,
          position: 0,
          body: 'にんじんを切る',
        });

        return new MealRepositoryImpl(tx).findByHousehold(noIngredientsHouseholdId);
      }),
    );

    // 設計 規則5 / 7章: 不変条件に反する行の組は、握りつぶさずそのまま伝わる。
    expect(thrown).toBeInstanceOf(MealRuleViolation);
    expect(thrown).toHaveProperty('rule', 'meal.ingredients.empty');
  });

  it('調味料しか材料の行が無い献立を読み戻すと拒む', async () => {
    const thrown = await failureOf(
      withHouseholdTransaction(db, seasoningOnlyHouseholdId, async (tx) => {
        await insertMealRow(tx, {
          mealId: seasoningOnlyMealId,
          householdId: seasoningOnlyHouseholdId,
        });
        await insertIngredientRow(tx, {
          mealId: seasoningOnlyMealId,
          householdId: seasoningOnlyHouseholdId,
          position: 0,
          name: 'しお',
          kind: 'seasoning',
        });
        await insertStepRow(tx, {
          mealId: seasoningOnlyMealId,
          householdId: seasoningOnlyHouseholdId,
          position: 0,
          body: 'しおをふる',
        });

        return new MealRepositoryImpl(tx).findByHousehold(seasoningOnlyHouseholdId);
      }),
    );

    // C-16 / 設計 規則5: 主材料が無いと不足が常に0件になり、在庫に関わらず
    // 「作れる」と判定されてしまう。
    expect(thrown).toBeInstanceOf(MealRuleViolation);
    expect(thrown).toHaveProperty('rule', 'meal.ingredients.noMain');
  });

  it('手順の行が1件も無い献立を読み戻すと拒む', async () => {
    const thrown = await failureOf(
      withHouseholdTransaction(db, noStepsHouseholdId, async (tx) => {
        await insertMealRow(tx, { mealId: noStepsMealId, householdId: noStepsHouseholdId });
        await insertIngredientRow(tx, {
          mealId: noStepsMealId,
          householdId: noStepsHouseholdId,
          position: 0,
          name: 'にんじん',
        });

        return new MealRepositoryImpl(tx).findByHousehold(noStepsHouseholdId);
      }),
    );

    // 設計 規則5 / 7章
    expect(thrown).toBeInstanceOf(MealRuleViolation);
    expect(thrown).toHaveProperty('rule', 'meal.steps.empty');
  });
});

/**
 * `MealRepositoryImpl` の2周目
 * （B-44 設計 規則1・2・8・8b・9 と 7章 / C-3 / C-9 / NFR-09 / ADR-002 / ADR-029）。
 *
 * 前提は1周目と同じ — 繋ぐのは `authenticator` だけ、世帯 ID と献立 ID は
 * **ケースごとに固有の固定値**、後片付けはしない。
 */
const titleMismatchHouseholdId = householdIdOf('d4d4d4d4-0011-4000-8000-000000000011');
const titleMismatchMealId = mealIdOf('d4d4d4d4-0011-4000-8000-0000000000a1');

const ingredientMismatchHouseholdId = householdIdOf('d4d4d4d4-0012-4000-8000-000000000012');
const ingredientMismatchMealId = mealIdOf('d4d4d4d4-0012-4000-8000-0000000000a1');

const stepMismatchHouseholdId = householdIdOf('d4d4d4d4-0013-4000-8000-000000000013');
const stepMismatchMealId = mealIdOf('d4d4d4d4-0013-4000-8000-0000000000a1');

const moreIngredientsHouseholdId = householdIdOf('d4d4d4d4-0014-4000-8000-000000000014');
const moreIngredientsMealId = mealIdOf('d4d4d4d4-0014-4000-8000-0000000000a1');

const fewerIngredientsHouseholdId = householdIdOf('d4d4d4d4-0015-4000-8000-000000000015');
const fewerIngredientsMealId = mealIdOf('d4d4d4d4-0015-4000-8000-0000000000a1');

const moreStepsHouseholdId = householdIdOf('d4d4d4d4-0016-4000-8000-000000000016');
const moreStepsMealId = mealIdOf('d4d4d4d4-0016-4000-8000-0000000000a1');

const repeatedSaveHouseholdId = householdIdOf('d4d4d4d4-0017-4000-8000-000000000017');
const repeatedSaveMealId = mealIdOf('d4d4d4d4-0017-4000-8000-0000000000a1');

const addedRecordHouseholdId = householdIdOf('d4d4d4d4-0018-4000-8000-000000000018');
const addedRecordMealId = mealIdOf('d4d4d4d4-0018-4000-8000-0000000000a1');

const fewerRecordsHouseholdId = householdIdOf('d4d4d4d4-0019-4000-8000-000000000019');
const fewerRecordsMealId = mealIdOf('d4d4d4d4-0019-4000-8000-0000000000a1');

const reapplyClaimsHouseholdId = householdIdOf('d4d4d4d4-001a-4000-8000-00000000001a');
const reapplyClaimsMealId = mealIdOf('d4d4d4d4-001a-4000-8000-0000000000a1');

const rollbackHouseholdId = householdIdOf('d4d4d4d4-001b-4000-8000-00000000001b');
const rollbackMealId = mealIdOf('d4d4d4d4-001b-4000-8000-0000000000a1');

const listingOwnerHouseholdId = householdIdOf('d4d4d4d4-001c-4000-8000-00000000001c');
const listingStrangerHouseholdId = householdIdOf('d4d4d4d4-002c-4000-8000-00000000002c');
const ownHouseholdMealId1 = mealIdOf('d4d4d4d4-001c-4000-8000-0000000000a1');
const ownHouseholdMealId2 = mealIdOf('d4d4d4d4-001c-4000-8000-0000000000a2');
const otherHouseholdMealId = mealIdOf('d4d4d4d4-002c-4000-8000-0000000000a1');

const listingMismatchHouseholdId = householdIdOf('d4d4d4d4-001d-4000-8000-00000000001d');
const listingPassedHouseholdId = householdIdOf('d4d4d4d4-002d-4000-8000-00000000002d');
const listingMismatchMealId = mealIdOf('d4d4d4d4-001d-4000-8000-0000000000a1');

const saveMismatchHouseholdId = householdIdOf('d4d4d4d4-001e-4000-8000-00000000001e');
const saveMismatchMealSideHouseholdId = householdIdOf('d4d4d4d4-002e-4000-8000-00000000002e');
const saveMismatchMealId = mealIdOf('d4d4d4d4-001e-4000-8000-0000000000a1');

const untouchedHouseholdId = householdIdOf('d4d4d4d4-001f-4000-8000-00000000001f');
const untouchedMealSideHouseholdId = householdIdOf('d4d4d4d4-002f-4000-8000-00000000002f');
const untouchedMealId = mealIdOf('d4d4d4d4-001f-4000-8000-0000000000a1');

const collisionOwnerHouseholdId = householdIdOf('d4d4d4d4-0020-4000-8000-000000000020');
const colliderHouseholdId = householdIdOf('d4d4d4d4-0030-4000-8000-000000000030');
const collisionMealId = mealIdOf('d4d4d4d4-0020-4000-8000-0000000000a1');

const survivorOwnerHouseholdId = householdIdOf('d4d4d4d4-0021-4000-8000-000000000021');
const survivorColliderHouseholdId = householdIdOf('d4d4d4d4-0031-4000-8000-000000000031');
const survivorMealId = mealIdOf('d4d4d4d4-0021-4000-8000-0000000000a1');

const noClaimsHouseholdId = householdIdOf('d4d4d4d4-0022-4000-8000-000000000022');
const noClaimsMealId = mealIdOf('d4d4d4d4-0022-4000-8000-0000000000a1');

describe('献立リポジトリの実装（不変・追加・世帯の分離）', () => {
  it('同じ識別子で名称だけ違う献立の save を断る', async () => {
    await withHouseholdTransaction(db, titleMismatchHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(
        titleMismatchHouseholdId,
        meal({
          id: titleMismatchMealId,
          householdId: titleMismatchHouseholdId,
          title: 'にんじんの煮物',
        }),
      ),
    );

    const thrown = await failureOf(
      withHouseholdTransaction(db, titleMismatchHouseholdId, (tx) =>
        new MealRepositoryImpl(tx).save(
          titleMismatchHouseholdId,
          meal({
            id: titleMismatchMealId,
            householdId: titleMismatchHouseholdId,
            title: 'たまねぎのスープ',
          }),
        ),
      ),
    );

    const foundMeals = await withHouseholdTransaction(db, titleMismatchHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findByHousehold(titleMismatchHouseholdId),
    );

    // C-3 / 設計 規則8: 献立は生成後に編集できない。黙って無視せず断る。
    expect(thrown).toBeInstanceOf(MealRuleViolation);
    expect(thrown).toHaveProperty('rule', 'save.contentMismatch');
    // 例外だけでは、書き換えたうえで別の理由で投げた実装と見分けがつかない。
    expect(foundMealOf(foundMeals, titleMismatchMealId)?.title).toBe('にんじんの煮物');
  });

  it('同じ識別子で材料の内容だけ違う献立の save を断る', async () => {
    await withHouseholdTransaction(db, ingredientMismatchHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(
        ingredientMismatchHouseholdId,
        meal({
          id: ingredientMismatchMealId,
          householdId: ingredientMismatchHouseholdId,
          ingredients: [ingredient({ name: 'にんじん' })],
        }),
      ),
    );

    const thrown = await failureOf(
      withHouseholdTransaction(db, ingredientMismatchHouseholdId, (tx) =>
        new MealRepositoryImpl(tx).save(
          ingredientMismatchHouseholdId,
          // 件数も位置も同じまま、名称だけを変える。
          meal({
            id: ingredientMismatchMealId,
            householdId: ingredientMismatchHouseholdId,
            ingredients: [ingredient({ name: 'たまねぎ' })],
          }),
        ),
      ),
    );

    const foundMeals = await withHouseholdTransaction(db, ingredientMismatchHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findByHousehold(ingredientMismatchHouseholdId),
    );

    // C-3 / C-5 / 設計 規則8
    expect(thrown).toBeInstanceOf(MealRuleViolation);
    expect(thrown).toHaveProperty('rule', 'save.contentMismatch');
    expect(
      foundMealOf(foundMeals, ingredientMismatchMealId)?.ingredients.map(
        (mealIngredient) => mealIngredient.name,
      ),
    ).toEqual(['にんじん']);
  });

  it('同じ識別子で手順の内容だけ違う献立の save を断る', async () => {
    await withHouseholdTransaction(db, stepMismatchHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(
        stepMismatchHouseholdId,
        meal({
          id: stepMismatchMealId,
          householdId: stepMismatchHouseholdId,
          steps: ['にんじんを切る'],
        }),
      ),
    );

    const thrown = await failureOf(
      withHouseholdTransaction(db, stepMismatchHouseholdId, (tx) =>
        new MealRepositoryImpl(tx).save(
          stepMismatchHouseholdId,
          meal({
            id: stepMismatchMealId,
            householdId: stepMismatchHouseholdId,
            steps: ['たまねぎを切る'],
          }),
        ),
      ),
    );

    const foundMeals = await withHouseholdTransaction(db, stepMismatchHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findByHousehold(stepMismatchHouseholdId),
    );

    // C-3 / 設計 規則8
    expect(thrown).toBeInstanceOf(MealRuleViolation);
    expect(thrown).toHaveProperty('rule', 'save.contentMismatch');
    expect(foundMealOf(foundMeals, stepMismatchMealId)?.steps).toEqual(['にんじんを切る']);
  });

  it('材料が増えた save を断る', async () => {
    await withHouseholdTransaction(db, moreIngredientsHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(
        moreIngredientsHouseholdId,
        meal({
          id: moreIngredientsMealId,
          householdId: moreIngredientsHouseholdId,
          ingredients: [ingredient({ name: 'にんじん' }), ingredient({ name: 'たまねぎ' })],
        }),
      ),
    );

    const thrown = await failureOf(
      withHouseholdTransaction(db, moreIngredientsHouseholdId, (tx) =>
        new MealRepositoryImpl(tx).save(
          moreIngredientsHouseholdId,
          meal({
            id: moreIngredientsMealId,
            householdId: moreIngredientsHouseholdId,
            ingredients: [
              ingredient({ name: 'にんじん' }),
              ingredient({ name: 'たまねぎ' }),
              ingredient({ name: 'じゃがいも' }),
            ],
          }),
        ),
      ),
    );

    const foundMeals = await withHouseholdTransaction(db, moreIngredientsHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findByHousehold(moreIngredientsHouseholdId),
    );

    // C-3 / 設計 7章の注: 子表の主キーは `(meal_id, position)` なので、黙って無視する形
    // （当初案）では2番の行だけが新しく入り、**1度目にも2度目にも無い組み合わせ**になる。
    expect(thrown).toBeInstanceOf(MealRuleViolation);
    expect(thrown).toHaveProperty('rule', 'save.contentMismatch');
    expect(foundMealOf(foundMeals, moreIngredientsMealId)?.ingredients).toHaveLength(2);
  });

  it('材料が減った save を断る', async () => {
    await withHouseholdTransaction(db, fewerIngredientsHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(
        fewerIngredientsHouseholdId,
        meal({
          id: fewerIngredientsMealId,
          householdId: fewerIngredientsHouseholdId,
          ingredients: [ingredient({ name: 'にんじん' }), ingredient({ name: 'たまねぎ' })],
        }),
      ),
    );

    const thrown = await failureOf(
      withHouseholdTransaction(db, fewerIngredientsHouseholdId, (tx) =>
        new MealRepositoryImpl(tx).save(
          fewerIngredientsHouseholdId,
          meal({
            id: fewerIngredientsMealId,
            householdId: fewerIngredientsHouseholdId,
            ingredients: [ingredient({ name: 'にんじん' })],
          }),
        ),
      ),
    );

    const foundMeals = await withHouseholdTransaction(db, fewerIngredientsHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findByHousehold(fewerIngredientsHouseholdId),
    );

    // C-3 / 設計 規則8: 減った save は古い行が残るだけで「無視」にもなっていない。
    expect(thrown).toBeInstanceOf(MealRuleViolation);
    expect(thrown).toHaveProperty('rule', 'save.contentMismatch');
    expect(foundMealOf(foundMeals, fewerIngredientsMealId)?.ingredients).toHaveLength(2);
  });

  it('手順の件数が変わる save を断る', async () => {
    await withHouseholdTransaction(db, moreStepsHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(
        moreStepsHouseholdId,
        meal({
          id: moreStepsMealId,
          householdId: moreStepsHouseholdId,
          steps: ['にんじんを切る'],
        }),
      ),
    );

    const thrown = await failureOf(
      withHouseholdTransaction(db, moreStepsHouseholdId, (tx) =>
        new MealRepositoryImpl(tx).save(
          moreStepsHouseholdId,
          meal({
            id: moreStepsMealId,
            householdId: moreStepsHouseholdId,
            steps: ['にんじんを切る', 'なべに入れる'],
          }),
        ),
      ),
    );

    const foundMeals = await withHouseholdTransaction(db, moreStepsHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findByHousehold(moreStepsHouseholdId),
    );

    // C-3 / 設計 規則8
    expect(thrown).toBeInstanceOf(MealRuleViolation);
    expect(thrown).toHaveProperty('rule', 'save.contentMismatch');
    expect(foundMealOf(foundMeals, moreStepsMealId)?.steps).toHaveLength(1);
  });

  it('同じ内容の save は通り、読み戻しても変わらない', async () => {
    const savedMeal = meal({
      id: repeatedSaveMealId,
      householdId: repeatedSaveHouseholdId,
      title: 'にんじんの煮物',
      ingredients: [ingredient({ name: 'にんじん', amount: '200g' })],
      steps: ['にんじんを切る'],
    });

    await withHouseholdTransaction(db, repeatedSaveHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(repeatedSaveHouseholdId, savedMeal),
    );

    const secondSave = withHouseholdTransaction(db, repeatedSaveHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(repeatedSaveHouseholdId, savedMeal),
    );

    // 設計 規則8: **べき等でなければならない** — `withCookingRecord` の経路がこれに乗る。
    await expect(secondSave).resolves.toBeUndefined();

    const foundMeals = await withHouseholdTransaction(db, repeatedSaveHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findByHousehold(repeatedSaveHouseholdId),
    );

    expect(foundMeals).toHaveLength(1);
    expect(foundMealOf(foundMeals, repeatedSaveMealId)).toMatchObject({
      title: 'にんじんの煮物',
      steps: ['にんじんを切る'],
    });
  });

  it('調理記録を1件足した献立を save し直すと、記録だけが増える', async () => {
    const savedMeal = meal({
      id: addedRecordMealId,
      householdId: addedRecordHouseholdId,
      cookingRecords: [cookingRecord('2026-09-19T18:30:00.000Z')],
    });

    await withHouseholdTransaction(db, addedRecordHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(addedRecordHouseholdId, savedMeal),
    );

    await withHouseholdTransaction(db, addedRecordHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(
        addedRecordHouseholdId,
        withCookingRecord(savedMeal, cookingRecord('2026-09-20T18:30:00.000Z')),
      ),
    );

    const foundMeals = await withHouseholdTransaction(db, addedRecordHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findByHousehold(addedRecordHouseholdId),
    );

    // C-3 / 設計 規則9: 増えるのは調理記録だけで、末尾に足した分が入る（追加のみ）。
    expect(
      foundMealOf(foundMeals, addedRecordMealId)?.cookingRecords.map((record) => record.cookedAt),
    ).toEqual(['2026-09-19T18:30:00.000Z', '2026-09-20T18:30:00.000Z']);
  });

  it('調理記録が減った save を断る', async () => {
    await withHouseholdTransaction(db, fewerRecordsHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(
        fewerRecordsHouseholdId,
        meal({
          id: fewerRecordsMealId,
          householdId: fewerRecordsHouseholdId,
          cookingRecords: [
            cookingRecord('2026-09-19T18:30:00.000Z'),
            cookingRecord('2026-09-20T18:30:00.000Z'),
          ],
        }),
      ),
    );

    const thrown = await failureOf(
      withHouseholdTransaction(db, fewerRecordsHouseholdId, (tx) =>
        new MealRepositoryImpl(tx).save(
          fewerRecordsHouseholdId,
          meal({
            id: fewerRecordsMealId,
            householdId: fewerRecordsHouseholdId,
            cookingRecords: [cookingRecord('2026-09-19T18:30:00.000Z')],
          }),
        ),
      ),
    );

    const foundMeals = await withHouseholdTransaction(db, fewerRecordsHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findByHousehold(fewerRecordsHouseholdId),
    );

    // C-3 / 設計 規則9: 保存済みの記録は渡された記録の接頭辞でなければならない。
    expect(thrown).toBeInstanceOf(MealRuleViolation);
    expect(thrown).toHaveProperty('rule', 'save.contentMismatch');
    expect(foundMealOf(foundMeals, fewerRecordsMealId)?.cookingRecords).toHaveLength(2);
  });

  it('保存した献立は、クレームを張らないトランザクションからは読めず、張り直せば読める', async () => {
    await withHouseholdTransaction(db, reapplyClaimsHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(
        reapplyClaimsHouseholdId,
        meal({ id: reapplyClaimsMealId, householdId: reapplyClaimsHouseholdId }),
      ),
    );

    const mealsReadWithoutClaims = await transactionWithoutClaims((tx) =>
      new MealRepositoryImpl(tx).findByHousehold(reapplyClaimsHouseholdId),
    );

    const mealsReadAfterReapplyingClaims = await withHouseholdTransaction(
      db,
      reapplyClaimsHouseholdId,
      (tx) => new MealRepositoryImpl(tx).findByHousehold(reapplyClaimsHouseholdId),
    );

    // ADR-029 理由(1): クレームを張り忘れた問い合わせは**0行**になる（例外ではない）。
    expect(mealsReadWithoutClaims).toEqual([]);
    // ADR-029 理由(4): 3つ目が、0行の理由を「見えない」に絞り込む唯一の手である
    // （1つ目が commit されていないだけ、では説明がつかなくなる）。
    expect(mealsReadAfterReapplyingClaims).toHaveLength(1);
  });

  it('トランザクションの本体が例外を投げると、その中で保存した献立は残らない', async () => {
    const bodyFailure = new Error('本体が投げた');

    // ADR-029 決定3(a): 寿命を持つのは呼ぶ側。本体が投げたら1つの単位ごと巻き戻る。
    await expect(
      withHouseholdTransaction(db, rollbackHouseholdId, async (tx) => {
        await new MealRepositoryImpl(tx).save(
          rollbackHouseholdId,
          meal({ id: rollbackMealId, householdId: rollbackHouseholdId }),
        );
        throw bodyFailure;
      }),
    ).rejects.toBe(bodyFailure);

    const foundMeals = await withHouseholdTransaction(db, rollbackHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findByHousehold(rollbackHouseholdId),
    );

    expect(foundMeals).toEqual([]);
  });

  it('他世帯が保存した献立は findByHousehold に含まれない', async () => {
    await withHouseholdTransaction(db, listingOwnerHouseholdId, async (tx) => {
      const repository = new MealRepositoryImpl(tx);
      await repository.save(
        listingOwnerHouseholdId,
        meal({ id: ownHouseholdMealId1, householdId: listingOwnerHouseholdId }),
      );
      await repository.save(
        listingOwnerHouseholdId,
        meal({ id: ownHouseholdMealId2, householdId: listingOwnerHouseholdId }),
      );
    });

    await withHouseholdTransaction(db, listingStrangerHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(
        listingStrangerHouseholdId,
        meal({ id: otherHouseholdMealId, householdId: listingStrangerHouseholdId }),
      ),
    );

    const foundMeals = await withHouseholdTransaction(db, listingOwnerHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findByHousehold(listingOwnerHouseholdId),
    );

    const foundIds = foundMeals.map((found) => found.id);

    // C-9 / NFR-09: 世帯をまたぐ取得を許さない。順序は約束しないので集合で比べる。
    expect(new Set(foundIds)).toEqual(new Set([ownHouseholdMealId1, ownHouseholdMealId2]));
    expect(foundIds).not.toContain(otherHouseholdMealId);
  });

  it('クレームで見えている献立でも、引数の世帯が食い違えば findByHousehold は空になる', async () => {
    const foundMeals = await withHouseholdTransaction(
      db,
      listingMismatchHouseholdId,
      async (tx) => {
        const repository = new MealRepositoryImpl(tx);
        await repository.save(
          listingMismatchHouseholdId,
          meal({ id: listingMismatchMealId, householdId: listingMismatchHouseholdId }),
        );
        // 設計 規則2: RLS で見えていても、引数の世帯で必ず絞る（網は二重）。
        // `where` を外した実装なら、ここで献立が返ってしまう。
        return repository.findByHousehold(listingPassedHouseholdId);
      },
    );

    // C-9
    expect(foundMeals).toEqual([]);
  });

  it('引数の世帯と献立の世帯が食い違う save を拒む', async () => {
    const thrown = await failureOf(
      withHouseholdTransaction(db, saveMismatchHouseholdId, (tx) =>
        new MealRepositoryImpl(tx).save(
          saveMismatchHouseholdId,
          meal({ id: saveMismatchMealId, householdId: saveMismatchMealSideHouseholdId }),
        ),
      ),
    );

    // C-9 / 設計 7章: RLS の拒否に任せない — 任せると `rule` の付かない別の失敗になり、
    // 呼ぶ側が理由で分岐できない。
    expect(thrown).toBeInstanceOf(MealRuleViolation);
    expect(thrown).toHaveProperty('rule', 'save.householdMismatch');
  });

  it('食い違う save は1行も書かない', async () => {
    const mealsVisibleToArgumentHousehold = await withHouseholdTransaction(
      db,
      untouchedHouseholdId,
      async (tx) => {
        const repository = new MealRepositoryImpl(tx);

        // 拒否は**同じトランザクションの中で**捕まえる。外で捕まえると単位が終わって
        // しまい、「1行も書いていない」ことが見えない（設計 7章）。
        const thrown = await failureOf(
          repository.save(
            untouchedHouseholdId,
            meal({ id: untouchedMealId, householdId: untouchedMealSideHouseholdId }),
          ),
        );
        expect(thrown).toBeInstanceOf(MealRuleViolation);

        // RLS に任せた実装なら、拒まれた文でトランザクションが中断していて、
        // この問い合わせ自体が落ちる。
        return repository.findByHousehold(untouchedHouseholdId);
      },
    );

    const mealsVisibleToMealSideHousehold = await withHouseholdTransaction(
      db,
      untouchedMealSideHouseholdId,
      (tx) => new MealRepositoryImpl(tx).findByHousehold(untouchedMealSideHouseholdId),
    );

    expect(mealsVisibleToArgumentHousehold).toEqual([]);
    // 献立側の世帯にも行は残らない（**書かれていない**ことの裏取り）。
    expect(mealsVisibleToMealSideHousehold).toEqual([]);
  });

  it('他世帯の献立と識別子が衝突する save は失敗する', async () => {
    await withHouseholdTransaction(db, collisionOwnerHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(
        collisionOwnerHouseholdId,
        meal({ id: collisionMealId, householdId: collisionOwnerHouseholdId }),
      ),
    );

    const thrown = await failureOf(
      withHouseholdTransaction(db, colliderHouseholdId, (tx) =>
        new MealRepositoryImpl(tx).save(
          colliderHouseholdId,
          meal({ id: collisionMealId, householdId: colliderHouseholdId }),
        ),
      ),
    );

    expect(thrown).toBeInstanceOf(Error);
    // ADR-002 / 設計 7章: DB が拒んだ書き込みを**ドメインの例外型に包み直さない**
    // （SQLSTATE も期待値に書かない — 版で変わる）。
    expect(thrown).not.toBeInstanceOf(MealRuleViolation);
  });

  it('識別子が衝突した save の後も、相手世帯の献立は元のままである', async () => {
    await withHouseholdTransaction(db, survivorOwnerHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(
        survivorOwnerHouseholdId,
        meal({
          id: survivorMealId,
          householdId: survivorOwnerHouseholdId,
          title: 'にんじんの煮物',
        }),
      ),
    );

    await failureOf(
      withHouseholdTransaction(db, survivorColliderHouseholdId, (tx) =>
        new MealRepositoryImpl(tx).save(
          survivorColliderHouseholdId,
          meal({
            id: survivorMealId,
            householdId: survivorColliderHouseholdId,
            title: 'たまねぎのスープ',
          }),
        ),
      ),
    );

    const foundMeals = await withHouseholdTransaction(db, survivorOwnerHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findByHousehold(survivorOwnerHouseholdId),
    );

    // C-9 / NFR-09: 失敗するだけなら、相手世帯の行を書き換えたうえで別の理由で
    // 投げた実装と見分けがつかない。
    expect(foundMealOf(foundMeals, survivorMealId)?.title).toBe('にんじんの煮物');
  });

  it('クレームを張らないトランザクションでの save は失敗し、規則違反にはならない', async () => {
    const thrown = await failureOf(
      transactionWithoutClaims((tx) =>
        new MealRepositoryImpl(tx).save(
          noClaimsHouseholdId,
          meal({ id: noClaimsMealId, householdId: noClaimsHouseholdId }),
        ),
      ),
    );

    // ADR-029 / 設計 7章: 書き込みが RLS に拒まれたら、握りつぶさずそのまま伝える。
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(MealRuleViolation);
  });
});

/**
 * `MealRepositoryImpl` の3周目 — **識別子で1件引く口**（B-52 周A / 設計 規則1・2・7 /
 * C-3 / C-5 / C-9 / NFR-09 / ADR-066 論点2）。
 *
 * 前提は1周目と同じ — 繋ぐのは `authenticator` だけ、世帯 ID と献立 ID は
 * **ケースごとに固有の固定値**、後片付けはしない。
 */
const byIdRoundTripHouseholdId = householdIdOf('d4d4d4d4-0040-4000-8000-000000000040');
const byIdRoundTripMealId = mealIdOf('d4d4d4d4-0040-4000-8000-0000000000a1');

const byIdUnknownHouseholdId = householdIdOf('d4d4d4d4-0041-4000-8000-000000000041');
const byIdUnknownStoredMealId = mealIdOf('d4d4d4d4-0041-4000-8000-0000000000a1');
const byIdUnknownMissingMealId = mealIdOf('d4d4d4d4-0041-4000-8000-0000000000a2');

const byIdOwnerHouseholdId = householdIdOf('d4d4d4d4-0042-4000-8000-000000000042');
const byIdStrangerHouseholdId = householdIdOf('d4d4d4d4-0052-4000-8000-000000000052');
const byIdStrangerMealId = mealIdOf('d4d4d4d4-0052-4000-8000-0000000000a1');

const byIdMismatchHouseholdId = householdIdOf('d4d4d4d4-0043-4000-8000-000000000043');
const byIdMismatchPassedHouseholdId = householdIdOf('d4d4d4d4-0053-4000-8000-000000000053');
const byIdMismatchMealId = mealIdOf('d4d4d4d4-0043-4000-8000-0000000000a1');

const byIdNoClaimsHouseholdId = householdIdOf('d4d4d4d4-0044-4000-8000-000000000044');
const byIdNoClaimsMealId = mealIdOf('d4d4d4d4-0044-4000-8000-0000000000a1');

const byIdChildOrderHouseholdId = householdIdOf('d4d4d4d4-0045-4000-8000-000000000045');
const byIdChildOrderMealId = mealIdOf('d4d4d4d4-0045-4000-8000-0000000000a1');

const byIdEmptyHouseholdId = householdIdOf('d4d4d4d4-0046-4000-8000-000000000046');
const byIdEmptyMealId = mealIdOf('d4d4d4d4-0046-4000-8000-0000000000a1');

describe('献立リポジトリの実装（識別子で1件引く）', () => {
  it('保存した献立を同じ世帯の findById で識別子を指して読み戻せる', async () => {
    const foundMeal = await withHouseholdTransaction(db, byIdRoundTripHouseholdId, async (tx) => {
      const repository = new MealRepositoryImpl(tx);
      await repository.save(
        byIdRoundTripHouseholdId,
        meal({
          id: byIdRoundTripMealId,
          householdId: byIdRoundTripHouseholdId,
          title: 'にんじんの煮物',
          ingredients: [ingredient({ name: 'にんじん', amount: '200g' })],
          steps: ['にんじんを切る'],
        }),
      );
      return repository.findById(byIdRoundTripHouseholdId, byIdRoundTripMealId);
    });

    // B-52 規則1 / FR-30: 名称・材料・手順の揃った献立が返る。
    expect(foundMeal?.id).toBe(byIdRoundTripMealId);
    expect(foundMeal?.title).toBe('にんじんの煮物');
    expect(foundMeal?.ingredients.map((mealIngredient) => mealIngredient.name)).toEqual([
      'にんじん',
    ]);
    expect(foundMeal?.steps).toEqual(['にんじんを切る']);
  });

  it('その世帯に無い識別子には null を返す', async () => {
    const foundMeal = await withHouseholdTransaction(db, byIdUnknownHouseholdId, async (tx) => {
      const repository = new MealRepositoryImpl(tx);
      await repository.save(
        byIdUnknownHouseholdId,
        meal({ id: byIdUnknownStoredMealId, householdId: byIdUnknownHouseholdId }),
      );
      return repository.findById(byIdUnknownHouseholdId, byIdUnknownMissingMealId);
    });

    // B-52 規則2: 無ければ `null`。例外にもしないし、別の献立でも埋めない。
    expect(foundMeal).toBeNull();
  });

  it('他世帯が保存した献立は findById が null を返す', async () => {
    await withHouseholdTransaction(db, byIdStrangerHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(
        byIdStrangerHouseholdId,
        meal({ id: byIdStrangerMealId, householdId: byIdStrangerHouseholdId }),
      ),
    );

    const foundMeal = await withHouseholdTransaction(db, byIdOwnerHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findById(byIdOwnerHouseholdId, byIdStrangerMealId),
    );

    // C-9 / NFR-09: 他世帯の献立は「無い」と同じ返り方をする。区別して返すと、
    // 識別子を総当たりする者に他世帯の献立の存在が漏れる。
    expect(foundMeal).toBeNull();
  });

  it('クレームで見えている献立でも、引数の世帯が食い違えば null を返す', async () => {
    const foundMeal = await withHouseholdTransaction(db, byIdMismatchHouseholdId, async (tx) => {
      const repository = new MealRepositoryImpl(tx);
      await repository.save(
        byIdMismatchHouseholdId,
        meal({ id: byIdMismatchMealId, householdId: byIdMismatchHouseholdId }),
      );
      // B-52 規則1 / C-9: RLS で見えていても、引数の世帯で必ず絞る（網は二重）。
      // `where` の世帯を落とした実装なら、ここで献立が返ってしまう。
      return repository.findById(byIdMismatchPassedHouseholdId, byIdMismatchMealId);
    });

    expect(foundMeal).toBeNull();
  });

  it('クレームを張らないトランザクションでは findById が null を返し、張り直せば読める', async () => {
    await withHouseholdTransaction(db, byIdNoClaimsHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).save(
        byIdNoClaimsHouseholdId,
        meal({ id: byIdNoClaimsMealId, householdId: byIdNoClaimsHouseholdId }),
      ),
    );

    const mealReadWithoutClaims = await transactionWithoutClaims((tx) =>
      new MealRepositoryImpl(tx).findById(byIdNoClaimsHouseholdId, byIdNoClaimsMealId),
    );

    const mealReadAfterReapplyingClaims = await withHouseholdTransaction(
      db,
      byIdNoClaimsHouseholdId,
      (tx) => new MealRepositoryImpl(tx).findById(byIdNoClaimsHouseholdId, byIdNoClaimsMealId),
    );

    // ADR-029 理由(1): クレームを張り忘れた問い合わせは**0行**になる（例外ではない）。
    expect(mealReadWithoutClaims).toBeNull();
    // ADR-029 理由(4): 3つ目が、0行の理由を「見えない」に絞り込む唯一の手である。
    expect(mealReadAfterReapplyingClaims?.id).toBe(byIdNoClaimsMealId);
  });

  it('材料・手順・調理記録は位置の昇順で読み戻る', async () => {
    const foundMeal = await withHouseholdTransaction(db, byIdChildOrderHouseholdId, async (tx) => {
      await insertMealRow(tx, {
        mealId: byIdChildOrderMealId,
        householdId: byIdChildOrderHouseholdId,
      });
      // 差し込む順を位置の降順にする。`order by` の無い実装では、挿入した順が
      // そのまま返って赤くなる。
      for (const [position, name] of [
        [2, 'じゃがいも'],
        [1, 'たまねぎ'],
        [0, 'にんじん'],
      ] as const) {
        await insertIngredientRow(tx, {
          mealId: byIdChildOrderMealId,
          householdId: byIdChildOrderHouseholdId,
          position,
          name,
        });
      }
      for (const [position, body] of [
        [2, 'しあげる'],
        [1, '煮る'],
        [0, 'にんじんを切る'],
      ] as const) {
        await insertStepRow(tx, {
          mealId: byIdChildOrderMealId,
          householdId: byIdChildOrderHouseholdId,
          position,
          body,
        });
      }
      for (const [position, cookedAt] of [
        [1, '2026-09-20T18:30:00.000Z'],
        [0, '2026-09-19T18:30:00.000Z'],
      ] as const) {
        await insertCookingRecordRow(tx, {
          mealId: byIdChildOrderMealId,
          householdId: byIdChildOrderHouseholdId,
          position,
          cookedAt,
        });
      }

      return new MealRepositoryImpl(tx).findById(byIdChildOrderHouseholdId, byIdChildOrderMealId);
    });

    // B-52 規則7 / C-3 / C-5: 集約の内部の並びは位置の昇順で約束する
    // （`findByHousehold` と同じ組み立てを通る）。
    expect(foundMeal?.ingredients.map((mealIngredient) => mealIngredient.name)).toEqual([
      'にんじん',
      'たまねぎ',
      'じゃがいも',
    ]);
    expect(foundMeal?.steps).toEqual(['にんじんを切る', '煮る', 'しあげる']);
    expect(foundMeal?.cookingRecords.map((record) => record.cookedAt)).toEqual([
      '2026-09-19T18:30:00.000Z',
      '2026-09-20T18:30:00.000Z',
    ]);
  });

  it('献立が1件も無い世帯では findById が null を返す', async () => {
    const foundMeal = await withHouseholdTransaction(db, byIdEmptyHouseholdId, (tx) =>
      new MealRepositoryImpl(tx).findById(byIdEmptyHouseholdId, byIdEmptyMealId),
    );

    // B-52 規則2: 0行は `null`。空の配列でも例外でもない。
    expect(foundMeal).toBeNull();
  });
});
