import { describe, expect, it } from 'vitest';
import { createMeal, withCookingRecord } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import type { CookingStep } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { createCookingRecord } from '../../../../src/contexts/meal/domain/value/CookingRecord.js';
import type { CookingRecord } from '../../../../src/contexts/meal/domain/value/CookingRecord.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import type { MealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';

const 世帯識別子 = householdIdOf('11111111-1111-4111-8111-111111111111');
const 献立識別子 = mealIdOf('22222222-2222-4222-8222-222222222222');
const 生成日時 = dateTimeOf('2026-09-13T12:00:00Z');

function 主材料(name: string, amount: string | null = null) {
  return createMealIngredient({ name, kind: 'main', amount: amountOf(amount) });
}

function 調味料(name: string) {
  // C-16 / ADR-023: 種別は主材料と調味料の2つ。調味料は充足の突き合わせに載らない。
  return createMealIngredient({ name, kind: 'seasoning', amount: null });
}

/** 本題でない値を隠して献立を作る。既定は主材料1件・手順1件・調理記録なしの、生成直後の姿。 */
function 献立(overrides: Partial<Parameters<typeof createMeal>[0]> = {}) {
  return createMeal({
    id: 献立識別子,
    householdId: 世帯識別子,
    title: '肉じゃが',
    ingredients: [主材料('牛肉')],
    steps: [cookingStepOf('煮る')],
    // B-14a 規則9: 由来は組み立てる側が渡す。既定値をここで補わない。
    provenance: 'llm',
    generatedAt: 生成日時,
    // B-14a 規則13: 生成直後は調理記録が0件。
    cookingRecords: [],
    ...overrides,
  });
}

describe('献立 Meal', () => {
  it('識別子・世帯・名称・材料・手順・生成日時を持つ', () => {
    // domain-model 4章: 集約が持つ項目。generatedAt は C-12 の並べ替えの鍵でもある。
    const meal = 献立({
      title: '肉じゃが',
      ingredients: [主材料('牛肉')],
      steps: [cookingStepOf('煮る')],
      generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
    });

    expect(meal.id).toBe(献立識別子);
    expect(meal.householdId).toBe(世帯識別子);
    expect(meal.title).toBe('肉じゃが');
    expect(meal.ingredients.length).toBe(1);
    expect(meal.steps.length).toBe(1);
    expect(meal.generatedAt).toBe('2026-09-13T12:00:00.000Z');
  });

  it('由来は呼ぶ側が渡したものをそのまま持つ', () => {
    // B-14a 規則9 / domain-model 4章 / prompt-design 2.2: 生成の由来は値であり、
    // 組み立てる側が渡す。
    expect(献立({ provenance: 'llm' }).provenance).toBe('llm');
  });

  it('名称の前後の空白は落とす', () => {
    // B-14a 規則1: 先行の createStockItem / createMealIngredient と同じ正規化。
    expect(献立({ title: '  肉じゃが  ' }).title).toBe('肉じゃが');
  });

  it('名称の途中の空白は落とさない', () => {
    // B-14a 規則1: 落とすのは前後だけ。途中を詰めると別の名称になる。
    expect(献立({ title: '鶏むね肉 の 照り焼き' }).title).toBe('鶏むね肉 の 照り焼き');
  });

  it('空の名称を許さない', () => {
    // domain-model 4章 / B-14a 7章: 名称の無い献立は画面にも一覧にも出せない。
    expect(() => 献立({ title: '' })).toThrow(MealRuleViolation);
    expect(() => 献立({ title: '   ' })).toThrow(MealRuleViolation);
  });

  it('空の名称の規則違反は識別子から判別できる', () => {
    // B-14a 7章 / ADR-025: 反した規則は識別子で持つ。文言ではなく rule で分岐できること。
    expect(() => 献立({ title: '' })).toThrow(
      expect.objectContaining({ rule: 'meal.title.empty' }),
    );
  });

  it('材料が1件も無い献立を許さない', () => {
    // domain-model 4章 / B-14a 規則2: 材料の無い献立は充足を算出できない。
    expect(() => 献立({ ingredients: [] })).toThrow(MealRuleViolation);
  });

  it('材料が空の規則違反は識別子から判別できる', () => {
    // B-14a 7章 / ADR-025.
    expect(() => 献立({ ingredients: [] })).toThrow(
      expect.objectContaining({ rule: 'meal.ingredients.empty' }),
    );
  });

  it('主材料が1件も無い献立を許さない', () => {
    // C-16 / B-14a 規則3 / domain-model 4章: 調味料だけでは充足の突き合わせに
    // 載る材料が1件も無く、常に「作れる」と判定されてしまう。
    expect(() => 献立({ ingredients: [調味料('しょうゆ'), 調味料('みりん')] })).toThrow(
      MealRuleViolation,
    );
  });

  it('主材料が無い規則違反は、材料が空の違反と識別子で見分けられる', () => {
    // B-14a 7章 / ADR-025: 直し方が違う2つの違反を、呼ぶ側が rule で見分けられること。
    expect(() => 献立({ ingredients: [調味料('しょうゆ'), 調味料('みりん')] })).toThrow(
      expect.objectContaining({ rule: 'meal.ingredients.noMain' }),
    );
  });

  it('主材料が1件あれば、残りが調味料でも作れる', () => {
    // B-14a 規則2・規則3 / C-16: 境界は主材料1件。
    const meal = 献立({
      ingredients: [主材料('牛肉'), 調味料('しょうゆ'), 調味料('みりん')],
    });

    expect(meal.ingredients.length).toBe(3);
  });

  it('手順が1件も無い献立を許さない', () => {
    // domain-model 4章 / B-14a 規則4: 手順の無い献立は作れる形になっていない。
    expect(() => 献立({ steps: [] })).toThrow(MealRuleViolation);
  });

  it('手順が空の規則違反は識別子から判別できる', () => {
    // B-14a 7章 / ADR-025.
    expect(() => 献立({ steps: [] })).toThrow(
      expect.objectContaining({ rule: 'meal.steps.empty' }),
    );
  });

  it('手順は渡した順に並び、並べ替えも番号の付与もしない', () => {
    // B-14a 規則4 / prompt-design 2.2: 順序は配列の添字が持つ。番号の項目を置かない。
    const meal = 献立({
      steps: [cookingStepOf('切る'), cookingStepOf('炒める'), cookingStepOf('煮る')],
    });

    expect(meal.steps).toEqual(['切る', '炒める', '煮る']);
  });

  it('材料は名称と分量の文字列として載る', () => {
    // C-5 / B-14a 規則16 / FR-17: 献立は在庫品を参照せず、名称と分量を文字列として複製する。
    const meal = 献立({ ingredients: [主材料('にんじん', '200g')] });

    const 一件目 = meal.ingredients[0];
    expect(一件目?.name).toBe('にんじん');
    expect(一件目?.amount).toBe('200g');
  });

  it('材料は在庫品の識別子を持たない', () => {
    // C-5 / ADR-008 / B-14a 規則16: 在庫品を消しても献立は成立する。参照を持たせると
    // 集約をまたぐ参照になり、在庫の削除が献立を壊す。
    const meal = 献立({ ingredients: [主材料('にんじん', '200g')] });

    expect(meal.ingredients.map((ingredient) => 'stockItemId' in ingredient)).toEqual([false]);
  });

  it('同じ名称の材料が2件あっても拒まない', () => {
    // B-14a 規則15 / prompt-design 6.3: 重複の除去は腐敗防止層の正規化であり、
    // domain-model 4章の不変条件ではない。
    const meal = 献立({ ingredients: [主材料('にんじん'), 主材料('にんじん')] });

    expect(meal.ingredients.length).toBe(2);
  });

  it('腐敗防止層が見る長さの上限をドメインでは見ない', () => {
    // B-14a 規則14 / prompt-design 6.2 / domain-model 4章: 名称40字・手順8件・
    // 材料12件の上限は腐敗防止層の検証の規則であって、不変条件の表に無い。
    const meal = 献立({
      title: '肉じゃが'.repeat(11),
      ingredients: Array.from({ length: 13 }, (_, 添字) => 主材料(`にんじん${添字 + 1}`)),
      steps: Array.from({ length: 9 }, (_, 添字) => cookingStepOf(`${添字 + 1}番目の手順`)),
    });

    expect(meal.steps.length).toBe(9);
    expect(meal.ingredients.length).toBe(13);
  });

  it('調理記録が0件の献立を作れる', () => {
    // B-14a 規則13 / domain-model 5章: 生成直後の姿。空は規則違反ではない。
    expect(献立({ cookingRecords: [] }).cookingRecords.length).toBe(0);
  });

  it('作ったあとに書き換えられない', () => {
    // C-3 / B-14a 規則10: 献立は生成後に編集できない。可変にすると不変条件を
    // 通らない書き換えが可能になる。
    const meal = 献立();

    expect(() => {
      (meal as { title: string }).title = 'カレー';
    }).toThrow(TypeError);
  });

  it('持っている材料・手順・調理記録の列に後から足せない', () => {
    // C-3 / B-14a 規則10: 列そのものも凍結する。凍結しないと、集約を通さずに
    // 材料や記録を足せてしまう。
    const meal = 献立();

    expect(() => (meal.ingredients as MealIngredient[]).push(主材料('じゃがいも'))).toThrow(
      TypeError,
    );
    expect(() => (meal.steps as CookingStep[]).push(cookingStepOf('盛る'))).toThrow(TypeError);
    expect(() =>
      (meal.cookingRecords as CookingRecord[]).push(
        createCookingRecord({ cookedAt: dateTimeOf('2026-09-13T12:00:00Z') }),
      ),
    ).toThrow(TypeError);
  });

  it('呼ぶ側が渡した材料と手順の配列を後から書き換えても、献立の材料と手順は変わらない', () => {
    // B-14a 規則10: 受け取った配列は複製してから凍結する。複製しないと、呼ぶ側が
    // 持ち続けている参照から不変条件を通らない変更が入る。
    const 渡した材料 = [主材料('牛肉')];
    const 渡した手順 = [cookingStepOf('煮る')];
    const meal = 献立({ ingredients: 渡した材料, steps: 渡した手順 });

    渡した材料.push(主材料('じゃがいも'));
    渡した手順.push(cookingStepOf('盛る'));

    expect(meal.ingredients.length).toBe(1);
    expect(meal.steps.length).toBe(1);
  });

  it('呼ぶ側が渡した調理記録の配列を後から足しても、献立の調理記録は増えない', () => {
    // B-14a 規則10・規則11 / C-3: 記録が増える入口は withCookingRecord だけである。
    const 渡した調理記録 = [createCookingRecord({ cookedAt: dateTimeOf('2026-09-13T12:00:00Z') })];
    const meal = 献立({ cookingRecords: 渡した調理記録 });

    渡した調理記録.push(createCookingRecord({ cookedAt: dateTimeOf('2026-09-14T12:00:00Z') }));

    expect(meal.cookingRecords.length).toBe(1);
  });

  it('調理記録を足した献立は、記録が末尾に1件増えている', () => {
    // B-14a 規則11 / FR-22 / domain-model 5章: 「作った」の記録は追加のみ。
    const 元の献立 = 献立({ cookingRecords: [] });

    const 足したもの = withCookingRecord(
      元の献立,
      createCookingRecord({ cookedAt: dateTimeOf('2026-09-13T12:00:00Z') }),
    );

    expect(足したもの.cookingRecords.length).toBe(1);
    expect(足したもの.cookingRecords[0]?.cookedAt).toBe('2026-09-13T12:00:00.000Z');
  });

  it('調理記録を足しても、元の献立は変わらない', () => {
    // B-14a 規則11 / C-3: 作り直しで表す。元の献立を書き換えない。
    const 元の献立 = 献立({ cookingRecords: [] });

    withCookingRecord(
      元の献立,
      createCookingRecord({ cookedAt: dateTimeOf('2026-09-13T12:00:00Z') }),
    );

    expect(元の献立.cookingRecords.length).toBe(0);
  });

  it('調理日時が既存より古くても拒まず、記録された順に末尾へ足す', () => {
    // B-14a 規則11: 並べ替えない。記録された順が事実である。
    const 一度目 = withCookingRecord(
      献立({ cookingRecords: [] }),
      createCookingRecord({ cookedAt: dateTimeOf('2026-09-13T12:00:00Z') }),
    );

    const 二度目 = withCookingRecord(
      一度目,
      createCookingRecord({ cookedAt: dateTimeOf('2026-09-01T12:00:00Z') }),
    );

    expect(二度目.cookingRecords.map((record) => record.cookedAt)).toEqual([
      '2026-09-13T12:00:00.000Z',
      '2026-09-01T12:00:00.000Z',
    ]);
  });

  it('調理記録を足した献立は、識別子・世帯・名称・材料・手順・由来・生成日時を元から引き継ぐ', () => {
    // B-14a 規則12 / C-9 / C-3: 引き継ぐ7つを引数に取らないので、世帯の所属を
    // 変える経路が型として起こせない。
    const 元の献立 = 献立({
      title: '肉じゃが',
      ingredients: [主材料('牛肉', '200g')],
      steps: [cookingStepOf('煮る')],
      generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
    });

    const 足したもの = withCookingRecord(
      元の献立,
      createCookingRecord({ cookedAt: dateTimeOf('2026-09-14T12:00:00Z') }),
    );

    expect(足したもの.id).toBe(献立識別子);
    expect(足したもの.householdId).toBe(世帯識別子);
    expect(足したもの.title).toBe('肉じゃが');
    expect(足したもの.ingredients).toEqual(元の献立.ingredients);
    expect(足したもの.steps).toEqual(元の献立.steps);
    expect(足したもの.provenance).toBe('llm');
    expect(足したもの.generatedAt).toBe('2026-09-13T12:00:00.000Z');
  });
});
