import { and, asc, eq } from 'drizzle-orm';
import type { Meal } from '../domain/entity/Meal.js';
import { createMeal } from '../domain/entity/Meal.js';
import { MealRuleViolation } from '../domain/error/MealRuleViolation.js';
import type { MealRepository } from '../domain/repository/MealRepository.js';
import { amountOf } from '../domain/value/Amount.js';
import type { CookingRecord } from '../domain/value/CookingRecord.js';
import { createCookingRecord } from '../domain/value/CookingRecord.js';
import type { CookingStep } from '../domain/value/CookingStep.js';
import { cookingStepOf } from '../domain/value/CookingStep.js';
import { dateTimeOf } from '../domain/value/DateTime.js';
import { mealIdOf } from '../domain/value/MealId.js';
import type { MealIngredient, MealIngredientKind } from '../domain/value/MealIngredient.js';
import { createMealIngredient } from '../domain/value/MealIngredient.js';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../shared/domain/HouseholdId.js';
import type { HouseholdTransaction } from './db/HouseholdTransaction.js';
import type { CookingRecordRow, CookingStepRow, MealIngredientRow, MealRow } from './db/schema.js';
import { cookingRecords, cookingSteps, mealIngredients, meals } from './db/schema.js';

/**
 * `MealRepository` の実装（B-44 設計 4章・5章）。
 *
 * **トランザクションを開かず、接続も作らず、`set local` も張らない**（設計 規則1 /
 * ADR-029 決定3(a)）。受け取った1つの handle の上でだけ問い合わせる。
 */
export class MealRepositoryImpl implements MealRepository {
  constructor(private readonly tx: HouseholdTransaction) {}

  /**
   * その世帯の献立をすべて返す。0行なら空の配列で、`null` にも例外にもしない（設計 7章）。
   *
   * **引数の世帯で必ず絞る**（設計 規則2 / C-9）。クレームで RLS が絞っていても `where` を
   * 外さない — 網は二重であり、片方を頼ると渡された世帯が実際には使われないままになる。
   * **子表も自分の `household_id` で絞り、親へ結合しない**（設計 規則2・10）。
   *
   * **献立の列の並び順は約束しない**（設計 規則3）ので `order by` を足さない — 再利用の
   * 並びは C-12 が決めるものであり、決めるのは `cookableMealsOf` である（ADR-036 決定4）。
   * **集約の内部の並びだけは約束する**（設計 規則4）ため、材料・手順・調理記録は
   * `position` の昇順で読み、その順で献立に組み直す。
   *
   * 行の組が不変条件に反していれば、生成関数が投げる `MealRuleViolation` を
   * **握りつぶさずそのまま伝える**（設計 規則5 / 7章）。
   */
  async findByHousehold(householdId: HouseholdId): Promise<Meal[]> {
    const mealRows = await this.tx.select().from(meals).where(eq(meals.householdId, householdId));
    if (mealRows.length === 0) return [];

    const ingredientRows = await this.tx
      .select()
      .from(mealIngredients)
      .where(eq(mealIngredients.householdId, householdId))
      .orderBy(asc(mealIngredients.position));
    const stepRows = await this.tx
      .select()
      .from(cookingSteps)
      .where(eq(cookingSteps.householdId, householdId))
      .orderBy(asc(cookingSteps.position));
    const recordRows = await this.tx
      .select()
      .from(cookingRecords)
      .where(eq(cookingRecords.householdId, householdId))
      .orderBy(asc(cookingRecords.position));

    // 子は親ごとに配り直す。世帯で引いた行をそのまま渡すと、世帯に2件以上の献立が
    // あるときに材料と手順が取り違う（設計 規則5）。
    const ingredientsByMeal = groupByMeal(ingredientRows);
    const stepsByMeal = groupByMeal(stepRows);
    const recordsByMeal = groupByMeal(recordRows);

    return mealRows.map((mealRow) =>
      toMeal({
        mealRow,
        ingredientRows: ingredientsByMeal.get(mealRow.id) ?? [],
        stepRows: stepsByMeal.get(mealRow.id) ?? [],
        recordRows: recordsByMeal.get(mealRow.id) ?? [],
      }),
    );
  }

  /**
   * 献立を保存する（C-1。生成結果を献立に変換した時点で保存する）。
   *
   * 引数の世帯と献立の世帯が食い違えば `save.householdMismatch` で断り、**1行も書かない**
   * （設計 7章 / C-9）。RLS の拒否に任せないのは、任せると `rule` の付かない別の失敗に
   * なり、呼ぶ側が理由で分岐できないためである。
   *
   * **書く前に、同じ識別子の献立がその世帯に保存済みかを読む**（設計 規則8 / C-3）。
   * 無ければ親→子の順にすべて書く。有れば名称・材料・手順が**件数と並び順を含めて**
   * 一致することを求め、1つでも違えば `save.contentMismatch` を投げて1行も書かない。
   * 献立は生成後に編集できない（C-3）以上、書き換えを黙って無視して済ませられない —
   * 子表の主キーは `(meal_id, position)` なので、**件数の変わる保存は「無視」にならず、
   * 1度目にも2度目にも無い組み合わせを作る**（設計 7章の注）。
   *
   * **同じ内容の保存はそのまま通る**（べき等）。`withCookingRecord` の経路がこれに乗る。
   * 調理記録は追加のみで、**保存済みが渡された記録の先頭からの並びとして一致すること**を
   * 求め、増えた分だけを書く（設計 規則9 / C-3）。
   *
   * **既存の行を書き換える文を1つも出さない**（設計 規則8b）。上の読み比べが一次の守りで、
   * 一意制約と複合外部キーが二重の網である。**ただし `on conflict … do nothing` は置かない** —
   * 置くと、他世帯の献立と識別子が衝突する保存が**黙って成功する。** 設計 規則8b は
   * 「親は入らず、続く子の複合外部キーが落ちる」と読んでいたが、子の主キーは
   * `(meal_id, position)` なので**子の行も相手世帯の行と衝突して飛ばされ、外部キーの検査に
   * 到達しない。** 衝突を握りつぶさず表に出すため、書き込みは素の insert で行い、
   * **DB の拒否をそのまま伝える**（設計 7章 / ADR-002）。
   *
   * 書き込みが RLS に拒まれたときも同じく**握りつぶさずそのまま伝える**（設計 7章）。
   */
  async save(householdId: HouseholdId, meal: Meal): Promise<void> {
    if (meal.householdId !== householdId) {
      throw new MealRuleViolation(
        'save.householdMismatch',
        '引数の世帯と献立の世帯が食い違っている',
      );
    }

    const storedMealRows = await this.tx
      .select()
      .from(meals)
      .where(and(eq(meals.id, meal.id), eq(meals.householdId, householdId)))
      .limit(1);
    const storedMealRow = storedMealRows[0];

    if (storedMealRow === undefined) {
      await this.insertMeal(householdId, meal);
      return;
    }

    const storedRecordRows = await this.requireSameContent(householdId, meal, storedMealRow);
    await this.insertCookingRecords(householdId, meal, storedRecordRows.length);
  }

  /** 親→子の順に、受け取った handle の上で続けて書く（設計 規則7）。 */
  private async insertMeal(householdId: HouseholdId, meal: Meal): Promise<void> {
    await this.tx.insert(meals).values({
      id: meal.id,
      householdId,
      title: meal.title,
      // `timestamptz` に `Date` を渡す（設計 規則6）。文字列のまま持たない。
      generatedAt: new Date(meal.generatedAt),
    });

    await this.tx.insert(mealIngredients).values(
      meal.ingredients.map((ingredient, position) => ({
        mealId: meal.id,
        householdId,
        // 位置は集約の配列の添字そのもの（設計 10章）。詰め直す経路を作らない。
        position,
        name: ingredient.name,
        kind: ingredient.kind,
        // **分量は `null` をそのまま書く**（「分量なし」。ADR-010 / 設計 規則7）。
        amount: ingredient.amount,
      })),
    );

    await this.tx.insert(cookingSteps).values(
      meal.steps.map((step, position) => ({
        mealId: meal.id,
        householdId,
        position,
        body: step,
      })),
    );

    await this.insertCookingRecords(householdId, meal, 0);
  }

  /**
   * 調理記録のうち、`storedCount` 件目より後ろだけを書く（設計 規則9 / C-3）。
   * 位置は集約の配列の添字そのものなので、詰め直さず添字をそのまま使う。
   */
  private async insertCookingRecords(
    householdId: HouseholdId,
    meal: Meal,
    storedCount: number,
  ): Promise<void> {
    const addedRows = meal.cookingRecords
      .map((record, position) => ({
        mealId: meal.id,
        householdId,
        position,
        cookedAt: new Date(record.cookedAt),
      }))
      .filter((row) => row.position >= storedCount);

    if (addedRows.length === 0) return;

    await this.tx.insert(cookingRecords).values(addedRows);
  }

  /**
   * 保存済みの内容と突き合わせ、食い違えば `save.contentMismatch` で断る（設計 規則8・9）。
   * 通ったときは保存済みの調理記録の行を返す — 何件目から書けばよいかがそこで決まる。
   */
  private async requireSameContent(
    householdId: HouseholdId,
    meal: Meal,
    storedMealRow: MealRow,
  ): Promise<readonly CookingRecordRow[]> {
    const storedIngredientRows = await this.tx
      .select()
      .from(mealIngredients)
      .where(and(eq(mealIngredients.mealId, meal.id), eq(mealIngredients.householdId, householdId)))
      .orderBy(asc(mealIngredients.position));
    const storedStepRows = await this.tx
      .select()
      .from(cookingSteps)
      .where(and(eq(cookingSteps.mealId, meal.id), eq(cookingSteps.householdId, householdId)))
      .orderBy(asc(cookingSteps.position));
    const storedRecordRows = await this.tx
      .select()
      .from(cookingRecords)
      .where(and(eq(cookingRecords.mealId, meal.id), eq(cookingRecords.householdId, householdId)))
      .orderBy(asc(cookingRecords.position));

    if (
      storedMealRow.title !== meal.title ||
      !sameIngredients(storedIngredientRows, meal.ingredients) ||
      !sameSteps(storedStepRows, meal.steps)
    ) {
      throw new MealRuleViolation(
        'save.contentMismatch',
        '保存済みの献立と名称・材料・手順が食い違っている',
      );
    }

    if (!isPrefixOfCookingRecords(storedRecordRows, meal.cookingRecords)) {
      throw new MealRuleViolation(
        'save.contentMismatch',
        '保存済みの調理記録が、渡された調理記録の先頭からの並びになっていない',
      );
    }

    return storedRecordRows;
  }
}

/** `position` の昇順を保ったまま、献立ごとに配り直す。 */
function groupByMeal<T extends { mealId: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const rowsOfMeal = grouped.get(row.mealId);
    if (rowsOfMeal === undefined) {
      grouped.set(row.mealId, [row]);
    } else {
      rowsOfMeal.push(row);
    }
  }
  return grouped;
}

/**
 * 行から献立を組む。**各値の生成関数と `createMeal` を必ず通す**（設計 規則5）。
 * 素のリテラルは型のブランドがあるため献立として扱えず、通さない実装は書けない。
 * 日時は `timestamptz` から `Date` として受け取り、UTC の正準形にしてから
 * `dateTimeOf` に通す（設計 規則6）。
 */
function toMeal(rows: {
  mealRow: MealRow;
  ingredientRows: readonly MealIngredientRow[];
  stepRows: readonly CookingStepRow[];
  recordRows: readonly CookingRecordRow[];
}): Meal {
  return createMeal({
    id: mealIdOf(rows.mealRow.id),
    householdId: householdIdOf(rows.mealRow.householdId),
    title: rows.mealRow.title,
    ingredients: rows.ingredientRows.map(toMealIngredient),
    steps: rows.stepRows.map((row) => toCookingStep(row)),
    generatedAt: dateTimeOf(rows.mealRow.generatedAt.toISOString()),
    cookingRecords: rows.recordRows.map(toCookingRecord),
  });
}

function toMealIngredient(row: MealIngredientRow): MealIngredient {
  return createMealIngredient({
    name: row.name,
    // 列の値は check（`kind in ('main', 'seasoning')`）が守っている（設計 規則15 / C-16）。
    kind: row.kind as MealIngredientKind,
    amount: amountOf(row.amount),
  });
}

function toCookingStep(row: CookingStepRow): CookingStep {
  return cookingStepOf(row.body);
}

function toCookingRecord(row: CookingRecordRow): CookingRecord {
  return createCookingRecord({ cookedAt: dateTimeOf(row.cookedAt.toISOString()) });
}

/** 材料が**件数と並び順を含めて**同じか（設計 規則8 / C-5）。 */
function sameIngredients(
  storedRows: readonly MealIngredientRow[],
  ingredients: readonly MealIngredient[],
): boolean {
  return (
    storedRows.length === ingredients.length &&
    storedRows.every((row, position) => {
      const ingredient = ingredients[position];
      return (
        ingredient !== undefined &&
        row.name === ingredient.name &&
        row.kind === ingredient.kind &&
        row.amount === ingredient.amount
      );
    })
  );
}

/** 手順が**件数と並び順を含めて**同じか（設計 規則8 / C-3）。 */
function sameSteps(storedRows: readonly CookingStepRow[], steps: readonly CookingStep[]): boolean {
  return (
    storedRows.length === steps.length &&
    storedRows.every((row, position) => row.body === steps[position])
  );
}

/**
 * 保存済みの調理記録が、渡された記録の**先頭からの並び**になっているか（設計 規則9 / C-3）。
 * 記録は追加のみなので、減っていることも途中が違うことも起こらない。
 */
function isPrefixOfCookingRecords(
  storedRows: readonly CookingRecordRow[],
  records: readonly CookingRecord[],
): boolean {
  return (
    storedRows.length <= records.length &&
    storedRows.every((row, position) => {
      const record = records[position];
      return record !== undefined && row.cookedAt.toISOString() === record.cookedAt;
    })
  );
}
