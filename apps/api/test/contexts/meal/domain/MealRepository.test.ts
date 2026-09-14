import { describe, expect, it } from 'vitest';
import type { MealRepository } from '../../../../src/contexts/meal/domain/repository/MealRepository.js';
import { createMeal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { 記憶上の献立リポジトリ } from '../../../support/meal/InMemoryMealRepository.js';

const 我が家 = householdIdOf('11111111-1111-4111-8111-111111111111');
const 隣の家 = householdIdOf('99999999-9999-4999-8999-999999999999');

/** 本題でない値を隠して献立を1件作る。本題は持ち主の世帯だけである。 */
function 肉じゃが(householdId: HouseholdId) {
  return createMeal({
    id: mealIdOf('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    householdId,
    title: '肉じゃが',
    ingredients: [createMealIngredient({ name: 'にんじん', kind: 'main', amount: null })],
    steps: [cookingStepOf('煮る')],
    generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
    cookingRecords: [],
  });
}

/** 先頭の引数の型を並べる。C-9 が全メソッドに世帯識別子を要求していることの検査に使う。 */
type 先頭の引数<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => unknown ? A[0] : never;
};

/**
 * 全メソッドの先頭が `HouseholdId` なら `true`、1つでも違えば `never`。
 * `never` になると下の代入が型検査で落ちる。
 */
type 全メソッドが世帯識別子を先頭に取るか =
  先頭の引数<MealRepository>[keyof MealRepository] extends HouseholdId ? true : never;

describe('献立リポジトリ MealRepository', () => {
  it('全メソッドが世帯識別子を先頭の引数に取る（C-9）', () => {
    // 型の主張。世帯識別子を取らないメソッドを足した時点で、この行が typecheck で落ちる。
    // 実行時には何も確かめていない — 確かめているのは型検査のほうである。
    const 主張: 全メソッドが世帯識別子を先頭に取るか = true;

    expect(主張).toBe(true);
  });

  it('他の世帯の献立として保存しようとすると拒む', async () => {
    // C-9 / B-28 7章3行目: interface では強制できない約束なので、実装ごとにここで確かめる。
    const repository: MealRepository = new 記憶上の献立リポジトリ();

    const 実行 = repository.save(隣の家, 肉じゃが(我が家));

    await expect(実行).rejects.toThrow(MealRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'save.householdMismatch' });
  });
});
