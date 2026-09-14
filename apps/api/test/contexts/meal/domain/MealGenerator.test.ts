import { describe, expect, it } from 'vitest';
import type {
  MealGenerationInput,
  MealGenerator,
} from '../../../../src/contexts/meal/domain/port/MealGenerator.js';
import { createGeneratedMeal } from '../../../../src/contexts/meal/domain/value/GeneratedMeal.js';
import type { GeneratedMeal } from '../../../../src/contexts/meal/domain/value/GeneratedMeal.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { createPantrySnapshot } from '../../../../src/contexts/meal/domain/value/PantrySnapshot.js';
import type { PantrySnapshot } from '../../../../src/contexts/meal/domain/value/PantrySnapshot.js';
import { createStockItem } from '../../../../src/contexts/meal/domain/value/StockItem.js';
import { expiryDateOf } from '../../../../src/contexts/meal/domain/value/ExpiryDate.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { FixedMealGenerator } from '../../../support/meal/FixedMealGenerator.js';

/** 双方向に代入できるときだけ `true`、片方でも外れれば `never`。増やしても減らしても落ちる形。 */
type SameType<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/** 操作が `generate` 1つだけなら `true`、増やすと `never`（B-15 規則1）。 */
type HasSingleGenerateOperation = SameType<keyof MealGenerator, 'generate'>;

/** 引数が `MealGenerationInput` 1つだけなら `true`、位置引数に散らすと `never`（B-15 前提1）。 */
type TakesSingleInputObject =
  Parameters<MealGenerator['generate']> extends readonly [MealGenerationInput] ? true : never;

/** 入力の項目が4つと双方向に一致すれば `true`、足しても減らしても `never`（B-15 規則2）。 */
type InputHasExactlyFourFields = SameType<
  keyof MealGenerationInput,
  'pantrySnapshot' | 'requiredCount' | 'avoidTitles' | 'asOf'
>;

/** 世帯識別子の項目が無ければ `true`、足すと `never`（B-15 規則2 / NFR-11 / C-9）。 */
type InputTakesNoHouseholdId = 'householdId' extends keyof MealGenerationInput ? never : true;

/** `number` が代入できれば `true`、`3` に狭めると `never`（B-15 規則8 / ADR-021）。 */
type RequiredCountStaysNumber = number extends MealGenerationInput['requiredCount'] ? true : never;

/** 戻り値が生成結果の列を解決する Promise なら `true`、`Meal` の列にすると `never`（B-15 規則3）。 */
type ResolvesGeneratedMeals =
  ReturnType<MealGenerator['generate']> extends Promise<readonly GeneratedMeal[]> ? true : never;

function mainIngredient(name: string) {
  return createMealIngredient({ name, kind: 'main', amount: amountOf('1個') });
}

/**
 * 本題でない値を隠して生成結果を作る。本題は名称だけである。
 *
 * **ヘルパーの名前も英語のままにする** — `GeneratedMeal` に日本語の呼び名を新しく作らない
 * （B-15 3章。同義語を1語増やすことになる）。
 */
function generatedMeal(title: string): GeneratedMeal {
  return createGeneratedMeal({
    title,
    ingredients: [mainIngredient('牛肉')],
    steps: [cookingStepOf('煮る')],
  });
}

function pantrySnapshot(...names: readonly string[]): PantrySnapshot {
  return createPantrySnapshot({
    stockItems: names.map((name) =>
      createStockItem({ name, amount: amountOf('1個'), expiryDate: expiryDateOf('2026-09-20') }),
    ),
  });
}

/** 本題でない値を隠して入力を作る。本題だけが overrides に現れる（`docs/testing.md` 6章）。 */
function input(overrides: Partial<MealGenerationInput> = {}): MealGenerationInput {
  return {
    pantrySnapshot: pantrySnapshot('にんじん', '牛肉'),
    requiredCount: 3,
    avoidTitles: [],
    // 基準日時は引数で渡す。現在時刻を読むとテストが決定的でなくなる（`docs/testing.md` 5章）。
    asOf: dateTimeOf('2026-09-14T12:00:00Z'),
    ...overrides,
  };
}

describe('MealGenerator', () => {
  it('生成の操作を1つだけ持つ', () => {
    // B-15 規則1 / 前提1: 型の主張。操作を増やした時点でこの行が typecheck で落ちる。
    // 実行時には何も確かめていない — 確かめているのは型検査のほうである。
    const assertion: HasSingleGenerateOperation = true;

    expect(assertion).toBe(true);
  });

  it('生成の操作は入力を1つのオブジェクトで受け取る', () => {
    // B-15 前提1: 位置引数に散らすと、必要件数と他の値の取り違えを型が止められない。
    const assertion: TakesSingleInputObject = true;

    expect(assertion).toBe(true);
  });

  it('入力は在庫スナップショット・必要件数・避けるべき名称・基準日時の4つだけを持つ', () => {
    // B-15 規則2 / prompt-design 2.1: 5つめを足しても1つ減らしても typecheck で落ちる。
    const assertion: InputHasExactlyFourFields = true;

    expect(assertion).toBe(true);
  });

  it('入力は世帯識別子を取らない', () => {
    // B-15 規則2 / NFR-11: 世帯の識別は生成の関心事ではなく、外へ出すものを最小にする。
    // C-9 が世帯を要求するのはリポジトリの全メソッドであり、この出口は対象外である。
    const assertion: InputTakesNoHouseholdId = true;

    expect(assertion).toBe(true);
  });

  it('必要件数は数であって3に狭められていない', () => {
    // B-15 規則8 / ADR-021 / 前提2: 件数は呼ぶ側の判断として残す。リテラル型に狭めると、
    // ADR-021 が定めた契約の形が消える。
    const assertion: RequiredCountStaysNumber = true;

    expect(assertion).toBe(true);
  });

  it('戻り値は生成結果の列を解決する Promise である', () => {
    // B-15 規則3 / C-1 / ADR-035: 返すのは GeneratedMeal であって Meal ではない。
    // 識別子も世帯も持たず、永続化は呼ぶ側の仕事である。
    const assertion: ResolvesGeneratedMeals = true;

    expect(assertion).toBe(true);
  });

  it('必要件数ぶんの生成結果を返す', async () => {
    // B-15 規則4 / prompt-design 6.4: 返すのは1件以上 requiredCount 件以下。
    const mealGenerator: MealGenerator = new FixedMealGenerator(
      generatedMeal('肉じゃが'),
      generatedMeal('カレー'),
      generatedMeal('親子丼'),
    );

    const generatedMeals = await mealGenerator.generate(input({ requiredCount: 3 }));

    expect(generatedMeals.length).toBe(3);
  });

  it('必要件数に満たなくても投げず、得られた件数で返す', async () => {
    // B-15 規則4 / 7章2行目 / prompt-design 論点1 / C-15: 件数を埋める再生成は契約に入れない。
    // 投げるのは0件のときだけである。
    const mealGenerator: MealGenerator = new FixedMealGenerator(generatedMeal('肉じゃが'));

    const generatedMeals = await mealGenerator.generate(input({ requiredCount: 3 }));

    expect(generatedMeals.length).toBe(1);
  });

  it('必要件数より多く得られたら先頭から必要件数までを返す', async () => {
    // B-15 規則4 / prompt-design 6.4 / C-2: 切るのは実装の仕事。先頭から切る。
    const mealGenerator: MealGenerator = new FixedMealGenerator(
      generatedMeal('肉じゃが'),
      generatedMeal('カレー'),
      generatedMeal('親子丼'),
      generatedMeal('麻婆豆腐'),
    );

    const generatedMeals = await mealGenerator.generate(input({ requiredCount: 3 }));

    expect(generatedMeals.map((generatedMeal) => generatedMeal.title)).toEqual([
      '肉じゃが',
      'カレー',
      '親子丼',
    ]);
  });

  it('1件も返せないときは規則違反を投げる', async () => {
    // B-15 規則5 / 7章1行目 / prompt-design 論点1: 0件を返さない。空の列で返すと、
    // 呼ぶ側が「生成が失敗した」と「生成するものが無かった」を見分けられない。
    const mealGenerator: MealGenerator = new FixedMealGenerator();

    await expect(mealGenerator.generate(input())).rejects.toThrow(MealRuleViolation);
  });

  it('1件も返せない規則違反は識別子から判別できる', async () => {
    // B-15 7章 / 前提4 / ADR-025: 反した規則は識別子で持つ。文言ではなく rule で分岐できること。
    const mealGenerator: MealGenerator = new FixedMealGenerator();

    await expect(mealGenerator.generate(input())).rejects.toThrow(
      expect.objectContaining({ rule: 'mealGenerator.empty' }),
    );
  });

  it('生成側の並びのまま返し、並べ替えない', async () => {
    // B-15 規則6 / prompt-design 6.4・3章 D-4: 並べ替えも優先順位づけも約束しない。
    // 充足は生成側が判定できないため、ここで順位をつける根拠が無い。
    const mealGenerator: MealGenerator = new FixedMealGenerator(
      generatedMeal('肉じゃが'),
      generatedMeal('あさりの酒蒸し'),
      generatedMeal('カレー'),
    );

    const generatedMeals = await mealGenerator.generate(input({ requiredCount: 3 }));

    expect(generatedMeals.map((generatedMeal) => generatedMeal.title)).toEqual([
      '肉じゃが',
      'あさりの酒蒸し',
      'カレー',
    ]);
  });

  it('同じ名称の生成結果を2件以上含めない', async () => {
    // B-15 規則7 / prompt-design 6.2 / C-13: 同じ名称が並ぶと提案が1件ぶん無駄になる。
    // 残すのは先に出たほうである。
    const mealGenerator: MealGenerator = new FixedMealGenerator(
      generatedMeal('肉じゃが'),
      generatedMeal('肉じゃが'),
      generatedMeal('カレー'),
    );

    const generatedMeals = await mealGenerator.generate(input({ requiredCount: 3 }));

    expect(generatedMeals.map((generatedMeal) => generatedMeal.title)).toEqual([
      '肉じゃが',
      'カレー',
    ]);
  });

  it('避けるべき名称が0件でも生成する', async () => {
    // B-15 規則9 / ADR-021: 避けるべき名称は努力目標であって、生成の前提ではない。
    // 初回の提案では必ず0件になる。
    const mealGenerator: MealGenerator = new FixedMealGenerator(generatedMeal('肉じゃが'));

    const generatedMeals = await mealGenerator.generate(input({ avoidTitles: [] }));

    expect(generatedMeals.length).toBe(1);
  });

  it('避けるべき名称が50件を超えても拒まない', async () => {
    // B-15 規則9 / ADR-021 の結果2 / prompt-design 論点4: 上限50件をポートが検査しない。
    // 切るのは呼ぶ側である — ここで検査すると呼ぶ側の規則が2か所に散る。
    const mealGenerator: MealGenerator = new FixedMealGenerator(generatedMeal('肉じゃが'));
    const avoidTitles = Array.from({ length: 51 }, (_, index) => `過去の献立${index + 1}`);

    const generatedMeals = await mealGenerator.generate(input({ avoidTitles }));

    expect(generatedMeals.length).toBe(1);
  });

  it('在庫が0件のスナップショットでも、呼ばれたら拒まずに生成する', async () => {
    // B-15 規則10 / prompt-design 8章: 「そもそも呼ばない」条件はポートの外にある。
    // 在庫0件で呼ばない判断は呼ぶ側の仕事であり、呼ばれたら生成する。
    const mealGenerator: MealGenerator = new FixedMealGenerator(generatedMeal('肉じゃが'));

    const generatedMeals = await mealGenerator.generate(
      input({ pantrySnapshot: pantrySnapshot() }),
    );

    expect(generatedMeals.length).toBe(1);
  });

  it('同じ名称を落としてから必要件数で切る', async () => {
    // B-15 規則7 / prompt-design 6.1 段階5・6.2・6.4: 重複の除去は献立ごとの検証にあり、
    // 6.4 が切るのは「検証を通った」ものである。順序が逆だと、先頭3件（肉じゃが・カレー・
    // 肉じゃが）を採ってから重複を落として2件になり、通せたはずの1件を落とす。
    const mealGenerator: MealGenerator = new FixedMealGenerator(
      generatedMeal('肉じゃが'),
      generatedMeal('カレー'),
      generatedMeal('肉じゃが'),
      generatedMeal('親子丼'),
    );

    const generatedMeals = await mealGenerator.generate(input({ requiredCount: 3 }));

    expect(generatedMeals.length).toBe(3);
    expect(generatedMeals.map((generatedMeal) => generatedMeal.title)).toEqual([
      '肉じゃが',
      'カレー',
      '親子丼',
    ]);
  });
});
