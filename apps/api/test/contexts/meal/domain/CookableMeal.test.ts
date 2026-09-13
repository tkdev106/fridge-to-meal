import { describe, expect, it } from 'vitest';
import { createCookableMeal } from '../../../../src/contexts/meal/domain/value/CookableMeal.js';
import { createMeal, type Meal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';

const 世帯識別子 = householdIdOf('11111111-1111-4111-8111-111111111111');

/** 本題でない値を隠して献立を作る。 */
function 献立(overrides: Partial<Parameters<typeof createMeal>[0]> = {}) {
  return createMeal({
    id: mealIdOf('22222222-2222-4222-8222-222222222222'),
    householdId: 世帯識別子,
    title: '肉じゃが',
    ingredients: [createMealIngredient({ name: 'にんじん', kind: 'main', amount: null })],
    steps: [cookingStepOf('煮る')],
    generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
    cookingRecords: [],
    ...overrides,
  });
}

describe('作れる献立 CookableMeal', () => {
  it('渡した献立をそのまま抱える', () => {
    // B-14b 規則5 / ADR-036 決定5: 工場は判定をしない。抱えるものを作り替えもしない。
    const meal = 献立();

    expect(createCookableMeal({ meal }).meal).toBe(meal);
  });

  it('充足を持たず、献立だけを抱える', () => {
    // B-14b 規則4 / ADR-035 の論法: 不足0件のものだけを通すのだから、
    // 充足を持たせても中身は常に同じで、持つ意味がない。
    const meal = 献立();

    expect(createCookableMeal({ meal })).toEqual({ __brand: 'CookableMeal', meal });
  });

  it('作ったあとに抱えている献立を差し替えられない', () => {
    // ADR-036 決定5: ブランドは「不足0件の判定を通った」ことの印である。
    // 差し替えられると、その印が指している中身が変わり、印が意味を失う。
    const cookableMeal = createCookableMeal({ meal: 献立() });

    expect(() => {
      (cookableMeal as { meal: Meal }).meal = 献立({ title: 'カレー' });
    }).toThrow(TypeError);
  });
});
