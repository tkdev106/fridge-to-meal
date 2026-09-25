import { describe, expect, it } from 'vitest';
import { addCookingRecord } from '../../../../src/contexts/meal/usecase/AddCookingRecord.js';
import type { Meal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { createMeal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { createCookingRecord } from '../../../../src/contexts/meal/domain/value/CookingRecord.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import type { MealId } from '../../../../src/contexts/meal/domain/value/MealId.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryMealRepository } from '../../../support/meal/InMemoryMealRepository.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

const idA = mealIdOf('22222222-2222-4222-8222-222222222222');
const idB = mealIdOf('33333333-3333-4333-8333-333333333333');
const unsavedId = mealIdOf('44444444-4444-4444-8444-444444444444');

/**
 * 保存済みの献立1件。本題でない項目は隠す（`docs/testing.md` 6章）。
 * **前提の献立はコンストラクタで置く** — `save` を通して用意しない。
 */
function meal(
  props: {
    id?: MealId;
    householdId?: HouseholdId;
    cookedAts?: readonly string[];
  } = {},
): Meal {
  return createMeal({
    id: props.id ?? idA,
    householdId: props.householdId ?? ourHousehold,
    title: '肉じゃが',
    ingredients: [createMealIngredient({ name: 'にんじん', kind: 'main', amount: null })],
    steps: [cookingStepOf('煮る')],
    generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
    cookingRecords: (props.cookedAts ?? []).map((cookedAt) =>
      createCookingRecord({ cookedAt: dateTimeOf(cookedAt) }),
    ),
  });
}

/** 記憶上のリポジトリでユースケースを1つ組む。依存は献立のリポジトリだけである（C-8 / 規則9）。 */
function setUp(...meals: readonly Meal[]) {
  const mealRepository = new InMemoryMealRepository(...meals);
  const add = addCookingRecord({ mealRepository });

  return { add, mealRepository };
}

/** 保存された結果を、次の取得を通して見る（`docs/testing.md` 3章）。 */
async function storedMeal(
  mealRepository: InMemoryMealRepository,
  householdId: HouseholdId,
  mealId: MealId,
): Promise<Meal> {
  const meals = await mealRepository.findByHousehold(householdId);
  const found = meals.find((candidate) => candidate.id === mealId);
  if (found === undefined) throw new Error(`献立が保持されていない: ${mealId}`);
  return found;
}

/** 記録された日時を並んだ順に読む。並び替えない（C-3 / 規則7）。 */
async function cookedAtsOf(
  mealRepository: InMemoryMealRepository,
  householdId: HouseholdId,
  mealId: MealId,
): Promise<readonly string[]> {
  const found = await storedMeal(mealRepository, householdId, mealId);
  return found.cookingRecords.map((cookingRecord) => cookingRecord.cookedAt);
}

/** 投げられたものをそのまま受け取る。型と `rule` と文面を突き合わせるためのもの。 */
async function thrownBy(execution: Promise<unknown>): Promise<unknown> {
  return execution.then(
    () => null,
    (thrown: unknown) => thrown,
  );
}

/** deps の形。在庫の口を1つも取らないことを型として主張するために取り出す（C-8 / 規則9）。 */
type AddCookingRecordDeps = Parameters<typeof addCookingRecord>[0];

/**
 * deps のキーが `'mealRepository'` だけなら `true`、1つでも他のキーがあれば `never`。
 * `never` になると下の代入が型検査で落ちる。
 */
type DepsTakeMealRepositoryOnly = keyof AddCookingRecordDeps extends 'mealRepository'
  ? true
  : never;

describe('調理記録を足す AddCookingRecord', () => {
  it('指した献立に調理記録を1件足す', async () => {
    // FR-22 / 規則2・5: 世帯で引いて識別子で選び、`withCookingRecord` で1件足す。
    const { add, mealRepository } = setUp(meal());

    await add(ourHousehold, idA, '2026-09-24T12:00:00Z');

    expect(await cookedAtsOf(mealRepository, ourHousehold, idA)).toEqual([
      '2026-09-24T12:00:00.000Z',
    ]);
  });

  it('記録を足しても名称・材料・手順・生成日時は1つも変わらない', async () => {
    // C-3 / 規則5・6: 増えるのは調理記録だけである。
    const { add, mealRepository } = setUp(
      createMeal({
        id: idA,
        householdId: ourHousehold,
        title: '肉じゃが',
        ingredients: [
          createMealIngredient({ name: 'じゃがいも', kind: 'main', amount: amountOf('2個') }),
          createMealIngredient({ name: '醤油', kind: 'seasoning', amount: null }),
        ],
        steps: [cookingStepOf('切る'), cookingStepOf('煮る')],
        generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
        cookingRecords: [],
      }),
    );

    await add(ourHousehold, idA, '2026-09-24T12:00:00Z');

    const found = await storedMeal(mealRepository, ourHousehold, idA);
    expect(found.title).toBe('肉じゃが');
    expect(found.ingredients).toEqual([
      { __brand: 'MealIngredient', name: 'じゃがいも', kind: 'main', amount: '2個' },
      { __brand: 'MealIngredient', name: '醤油', kind: 'seasoning', amount: null },
    ]);
    expect(found.steps).toEqual(['切る', '煮る']);
    expect(found.generatedAt).toBe('2026-09-13T12:00:00.000Z');
  });

  it('世帯に複数の献立があっても、指した1件にだけ記録が付く', async () => {
    // 規則2: 記録が付くのは識別子で選んだ1件だけである。
    const { add, mealRepository } = setUp(meal({ id: idA }), meal({ id: idB }));

    await add(ourHousehold, idA, '2026-09-24T12:00:00Z');

    expect(await cookedAtsOf(mealRepository, ourHousehold, idA)).toEqual([
      '2026-09-24T12:00:00.000Z',
    ]);
    expect(await cookedAtsOf(mealRepository, ourHousehold, idB)).toEqual([]);
  });

  it('同じ献立に何度でも記録を足せる', async () => {
    // FR-31 / 規則7: 2度目以降も断らない。
    const { add, mealRepository } = setUp(meal());

    await add(ourHousehold, idA, '2026-09-24T12:00:00Z');
    await add(ourHousehold, idA, '2026-09-25T12:00:00Z');

    expect(await cookedAtsOf(mealRepository, ourHousehold, idA)).toHaveLength(2);
  });

  it('記録は末尾に足され、並べ替えない', async () => {
    // C-3 / 規則7: 記録された順が事実である。後の呼び出しのほうが古い日時でも並べ替えない。
    const { add, mealRepository } = setUp(meal());

    await add(ourHousehold, idA, '2026-09-25T12:00:00Z');
    await add(ourHousehold, idA, '2026-09-24T12:00:00Z');

    expect(await cookedAtsOf(mealRepository, ourHousehold, idA)).toEqual([
      '2026-09-25T12:00:00.000Z',
      '2026-09-24T12:00:00.000Z',
    ]);
  });

  it('同じ日時の記録が2件並ぶことを断らない', async () => {
    // 規則8 / ADR-057 決定2: 日時を一意にする根拠は `docs/` に無い。
    const { add, mealRepository } = setUp(meal());
    await add(ourHousehold, idA, '2026-09-24T12:00:00Z');

    await expect(add(ourHousehold, idA, '2026-09-24T12:00:00Z')).resolves.not.toThrow();

    expect(await cookedAtsOf(mealRepository, ourHousehold, idA)).toEqual([
      '2026-09-24T12:00:00.000Z',
      '2026-09-24T12:00:00.000Z',
    ]);
  });

  it('保存済みの記録があっても、足すのは末尾の1件だけ', async () => {
    // C-3 / 規則6: 保存済みの記録は先頭からそのまま引き継がれる（追加のみ）。
    const { add, mealRepository } = setUp(meal({ cookedAts: ['2026-09-20T12:00:00Z'] }));

    await add(ourHousehold, idA, '2026-09-24T12:00:00Z');

    expect(await cookedAtsOf(mealRepository, ourHousehold, idA)).toEqual([
      '2026-09-20T12:00:00.000Z',
      '2026-09-24T12:00:00.000Z',
    ]);
  });

  it('時差つきの日時は UTC の正準形に正して記録する', async () => {
    // 規則4: 正すのは本体であり、書式の規則は値オブジェクトの1か所に残す。
    const { add, mealRepository } = setUp(meal());

    await add(ourHousehold, idA, '2026-09-24T21:00:00+09:00');

    expect(await cookedAtsOf(mealRepository, ourHousehold, idA)).toEqual([
      '2026-09-24T12:00:00.000Z',
    ]);
  });

  it('日時が ISO-8601 の瞬間でなければ規則違反で断る', async () => {
    // 7章3行目: 日付だけの表記では瞬間が定まらない。
    const { add } = setUp(meal());

    const execution = add(ourHousehold, idA, '2026-09-24');

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toHaveProperty('rule', 'dateTime.format');
  });

  it('日時が正せない要求では記録を1件も足さない', async () => {
    // 規則4 / NFR-09: 断った回に1行も書かない。
    const { add, mealRepository } = setUp(meal());

    await expect(add(ourHousehold, idA, '2026-09-24')).rejects.toThrow(MealRuleViolation);

    expect(await cookedAtsOf(mealRepository, ourHousehold, idA)).toEqual([]);
  });

  it('その世帯に無い献立を指すと規則違反で断る', async () => {
    // C-9 / 規則3: 世帯で引いてから識別子で選ぶ。
    const { add } = setUp(meal());

    const execution = add(ourHousehold, unsavedId, '2026-09-24T12:00:00Z');

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toHaveProperty('rule', 'addCookingRecord.mealNotFound');
  });

  it('無い献立を指した要求では1件も記録を足さない', async () => {
    // 規則3 / NFR-09: 断った回に1行も書かない。
    const { add, mealRepository } = setUp(meal());

    await expect(add(ourHousehold, unsavedId, '2026-09-24T12:00:00Z')).rejects.toThrow(
      MealRuleViolation,
    );

    expect(await cookedAtsOf(mealRepository, ourHousehold, idA)).toEqual([]);
  });

  it('他の世帯の献立を指した要求も、無い献立と同じ規則で断る', async () => {
    // C-9 / 規則3: 区別を呼び出し側に返さない。
    const { add } = setUp(meal({ householdId: neighborHousehold }));

    const execution = add(ourHousehold, idA, '2026-09-24T12:00:00Z');

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toHaveProperty('rule', 'addCookingRecord.mealNotFound');
  });

  it('他の世帯の献立には記録を1件も足さない', async () => {
    // C-9 / NFR-09: 断ることと、隣の世帯のデータに触れないことは別の主張である。
    const { add, mealRepository } = setUp(meal({ householdId: neighborHousehold }));

    await expect(add(ourHousehold, idA, '2026-09-24T12:00:00Z')).rejects.toThrow(MealRuleViolation);

    expect(await cookedAtsOf(mealRepository, neighborHousehold, idA)).toEqual([]);
  });

  it('断りの文面に献立の識別子も世帯の識別子も出さない', async () => {
    // NFR-09 / 規則3: 識別子を書けば「他の世帯には在る」が漏れる。文面そのものは
    // 検証せず、含まれないことだけを見る（`docs/testing.md` 3章）。
    const { add } = setUp(meal({ householdId: neighborHousehold }));

    const thrown = await thrownBy(add(ourHousehold, idA, '2026-09-24T12:00:00Z'));

    expect(thrown).toBeInstanceOf(MealRuleViolation);
    expect((thrown as MealRuleViolation).message).not.toContain(idA);
    expect((thrown as MealRuleViolation).message).not.toContain(ourHousehold);
  });

  it('保存が読み比べで断ったら、その規則違反をそのまま伝える', async () => {
    // ADR-057 / 7章3行目: 握りつぶさない。HTTP への写像は2周目の仕事である。
    const failure = new MealRuleViolation('save.contentMismatch', '保存済みの内容と食い違う');
    const mealRepository = InMemoryMealRepository.withSaveFailure(
      { onSaveNumber: 1, throws: failure },
      meal(),
    );
    const add = addCookingRecord({ mealRepository });

    await expect(add(ourHousehold, idA, '2026-09-24T12:00:00Z')).rejects.toBe(failure);
  });

  it('在庫の口を1つも依存に取らない', () => {
    // C-8 / 規則9: 「作った」を記録しても在庫は減らさない。在庫の口を依存に足した
    // 時点で、この行が typecheck で落ちる。実行時には何も確かめていない —
    // 確かめているのは型検査のほうである（先行 `MealRepository.test.ts` の C-9 の行）。
    const assertion: DepsTakeMealRepositoryOnly = true;

    expect(assertion).toBe(true);
  });
});
