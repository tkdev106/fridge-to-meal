import { describe, expect, it } from 'vitest';
import type { MealRepository } from '../../../../src/contexts/meal/domain/repository/MealRepository.js';
import { createMeal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { createCookingRecord } from '../../../../src/contexts/meal/domain/value/CookingRecord.js';
import type { MealIngredientKind } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryMealRepository } from '../../../support/meal/InMemoryMealRepository.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

/** 本題でない値を隠して献立を1件作る。本題は持ち主の世帯だけである。 */
function nikujaga(householdId: HouseholdId) {
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

/** 材料1件の中身。読み比べの行が1項目ずつ違えるために、素の値で持つ。 */
type IngredientProps = { name: string; kind: MealIngredientKind; amount: string | null };

/** 読み比べの基準になる材料。2件あるのは件数と並び順を違えるためである。 */
const baseIngredients: readonly IngredientProps[] = [
  { name: 'にんじん', kind: 'main', amount: '1本' },
  { name: 'じゃがいも', kind: 'main', amount: null },
];

/** 読み比べの基準になる手順。2件あるのは件数と並び順を違えるためである。 */
const baseSteps: readonly string[] = ['切る', '煮る'];

/**
 * 読み比べの基準の献立を呼ぶたびに新しく組み立てる（B-57 規則6・7）。**参照を使い回さない**
 * — 同じ参照を渡すと、値でなく参照で比べる実装でも緑になる（B-57 10章）。
 * 本題の項目だけを上書きし、既定は肉じゃが・材料2件・手順2件・記録0件である。
 */
function mealOf(
  props: {
    householdId?: HouseholdId;
    title?: string;
    ingredients?: readonly IngredientProps[];
    steps?: readonly string[];
    generatedAt?: string;
    cookedAts?: readonly string[];
  } = {},
) {
  return createMeal({
    id: mealIdOf('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    householdId: props.householdId ?? ourHousehold,
    title: props.title ?? '肉じゃが',
    ingredients: (props.ingredients ?? baseIngredients).map((ingredient) =>
      createMealIngredient({
        name: ingredient.name,
        kind: ingredient.kind,
        amount: amountOf(ingredient.amount),
      }),
    ),
    steps: (props.steps ?? baseSteps).map((step) => cookingStepOf(step)),
    generatedAt: dateTimeOf(props.generatedAt ?? '2026-09-13T12:00:00Z'),
    cookingRecords: (props.cookedAts ?? []).map((cookedAt) =>
      createCookingRecord({ cookedAt: dateTimeOf(cookedAt) }),
    ),
  });
}

/** 注入する失敗。`rule` を持たない素の `Error` で、読み比べの断りと見分けがつく。 */
const injectedFailure = new Error('注入した保存の失敗');

/** 先頭の引数の型を並べる。C-9 が全メソッドに世帯識別子を要求していることの検査に使う。 */
type FirstParameter<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => unknown ? A[0] : never;
};

/**
 * 全メソッドの先頭が `HouseholdId` なら `true`、1つでも違えば `never`。
 * `never` になると下の代入が型検査で落ちる。
 */
type AllMethodsTakeHouseholdIdFirst =
  FirstParameter<MealRepository>[keyof MealRepository] extends HouseholdId ? true : never;

/**
 * 識別子で引く口の先頭が `HouseholdId` なら `true`、違えば `never`（B-52 規則1 / C-9）。
 * 上の総当たりに含まれる主張だが、**この口だけを名指しで押さえる** — 口が1つ消えても
 * 総当たりは緑のままになるため。
 */
type FindByIdTakesHouseholdIdFirst = Parameters<MealRepository['findById']>[0] extends HouseholdId
  ? true
  : never;

describe('献立リポジトリ MealRepository', () => {
  it('全メソッドが世帯識別子を先頭の引数に取る（C-9）', () => {
    // 型の主張。世帯識別子を取らないメソッドを足した時点で、この行が typecheck で落ちる。
    // 実行時には何も確かめていない — 確かめているのは型検査のほうである。
    const assertion: AllMethodsTakeHouseholdIdFirst = true;

    expect(assertion).toBe(true);
  });

  it('識別子で引く口も世帯識別子を先頭の引数に取る（C-9）', () => {
    // 型の主張。世帯を取らない `findById` を置いた時点で、この行が typecheck で落ちる。
    // B-52 規則1: 献立は世帯と識別子の両方で引く。
    const assertion: FindByIdTakesHouseholdIdFirst = true;

    expect(assertion).toBe(true);
  });

  it('他の世帯の献立として保存しようとすると拒む', async () => {
    // C-9 / B-28 7章3行目: interface では強制できない約束なので、実装ごとにここで確かめる。
    const repository: MealRepository = new InMemoryMealRepository();

    const execution = repository.save(neighborHousehold, nikujaga(ourHousehold));

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.householdMismatch' });
  });

  // ここから読み比べ（B-57 規則4〜10 / ADR-057 決定1・2）。本物は保存済みと読み比べ、
  // 食い違えば 1行も書かずに断る。差し替えがそれを持たないと、単体テストの上だけで
  // 「生成後に編集できる」が通る（C-3）。

  it('世帯も内容も食い違う save は、世帯の食い違いとして拒む', async () => {
    // B-57 規則4 / C-9: 判定の順は世帯の食い違いが先である。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());

    const execution = repository.save(neighborHousehold, mealOf({ title: 'カレー' }));

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.householdMismatch' });
  });

  it('注入した失敗の回に内容も食い違うなら、注入した失敗を投げる', async () => {
    // B-57 規則4: 判定の順は「世帯 → 注入 → 読み比べ」。注入の口の意味を変えない。
    const repository: MealRepository = InMemoryMealRepository.withSaveFailure(
      { onSaveNumber: 1, throws: injectedFailure },
      mealOf(),
    );

    const execution = repository.save(ourHousehold, mealOf({ title: 'カレー' }));

    await expect(execution).rejects.toBe(injectedFailure);
  });

  it('内容の食い違いで拒んだ save も、注入の回数に数える', async () => {
    // B-57 規則4: 注入の回数は呼ばれた回数で数える。拒んだ回を数えないと、2回目に
    // 仕掛けた失敗が3回目にずれる。
    const repository: MealRepository = InMemoryMealRepository.withSaveFailure(
      { onSaveNumber: 2, throws: injectedFailure },
      mealOf(),
    );
    // 1回目が拒まれること自体は別の行が確かめる。ここで見るのは回数の数え方だけである。
    await repository.save(ourHousehold, mealOf({ title: 'カレー' })).catch(() => undefined);

    const execution = repository.save(ourHousehold, mealOf());

    await expect(execution).rejects.toBe(injectedFailure);
  });

  it('save で保存済みの献立と名称の違う献立を save すると拒む', async () => {
    // B-57 規則5: コンストラクタで置いた献立だけでなく、save で積んだ献立も読み比べの相手になる。
    const repository: MealRepository = new InMemoryMealRepository();
    await repository.save(ourHousehold, mealOf());

    const execution = repository.save(ourHousehold, mealOf({ title: 'カレー' }));

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('別の世帯の同じ識別子の献立とは読み比べず、こちらの世帯の save は通る', async () => {
    // B-57 規則5 / C-9: 読み比べの相手は同じ世帯の箱の中だけである（本物は世帯で絞って読む）。
    const repository: MealRepository = new InMemoryMealRepository(
      mealOf({ householdId: neighborHousehold }),
    );

    const execution = repository.save(ourHousehold, mealOf({ title: 'カレー' }));

    await expect(execution).resolves.toBeUndefined();
  });

  it('こちらの世帯に保存しても、別の世帯の同じ識別子の献立は元のまま読み戻せる', async () => {
    // B-57 規則5 / C-9: こちらの保存が隣の世帯の献立を書き換えない。
    const repository: MealRepository = new InMemoryMealRepository(
      mealOf({ householdId: neighborHousehold }),
    );
    await repository.save(ourHousehold, mealOf({ title: 'カレー' }));

    const found = await repository.findById(
      neighborHousehold,
      mealIdOf('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    );

    expect(found?.title).toBe('肉じゃが');
  });

  it('保存済みの献立と名称だけ違う献立の save は拒む', async () => {
    // B-57 規則6 / ADR-057 決定1 / C-3: 名称の一致を求める。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());

    const execution = repository.save(ourHousehold, mealOf({ title: 'カレー' }));

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('保存済みの献立と材料の名称だけ違う献立の save は拒む', async () => {
    // B-57 規則6 / ADR-057 決定1 / C-3: 材料の名称の一致を求める。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());

    const execution = repository.save(
      ourHousehold,
      mealOf({
        ingredients: [
          { name: 'たまねぎ', kind: 'main', amount: '1本' },
          { name: 'じゃがいも', kind: 'main', amount: null },
        ],
      }),
    );

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('保存済みの献立と材料の種別だけ違う献立の save は拒む', async () => {
    // B-57 規則6 / ADR-057 決定1 / C-3: 材料の種別の一致を求める。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());

    const execution = repository.save(
      ourHousehold,
      mealOf({
        ingredients: [
          { name: 'にんじん', kind: 'main', amount: '1本' },
          { name: 'じゃがいも', kind: 'seasoning', amount: null },
        ],
      }),
    );

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('保存済みの献立と材料の分量だけ違う献立の save は拒む', async () => {
    // B-57 規則6 / ADR-057 決定1 / C-3: 材料の分量の一致を求める。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());

    const execution = repository.save(
      ourHousehold,
      mealOf({
        ingredients: [
          { name: 'にんじん', kind: 'main', amount: '2本' },
          { name: 'じゃがいも', kind: 'main', amount: null },
        ],
      }),
    );

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('保存済みの分量が null の材料に分量を与えた献立の save は拒む', async () => {
    // B-57 規則6 / ADR-057 決定1 / C-3: null は null とだけ一致する。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());

    const execution = repository.save(
      ourHousehold,
      mealOf({
        ingredients: [
          { name: 'にんじん', kind: 'main', amount: '1本' },
          { name: 'じゃがいも', kind: 'main', amount: '3個' },
        ],
      }),
    );

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('保存済みの献立より材料が増えた献立の save は拒む', async () => {
    // B-57 規則6 / ADR-057 決定1 / C-3: 材料の件数の一致を求める。子表の主キーが位置なので、増えた位置だけが入る形で C-3 を破る。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());

    const execution = repository.save(
      ourHousehold,
      mealOf({
        ingredients: [...baseIngredients, { name: 'たまねぎ', kind: 'main', amount: '1個' }],
      }),
    );

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('保存済みの献立より材料が減った献立の save は拒む', async () => {
    // B-57 規則6 / ADR-057 決定1 / C-3: 材料の件数の一致を求める。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());

    const execution = repository.save(
      ourHousehold,
      mealOf({ ingredients: [{ name: 'にんじん', kind: 'main', amount: '1本' }] }),
    );

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('保存済みの献立と材料の並び順だけ違う献立の save は拒む', async () => {
    // B-57 規則6 / ADR-057 決定1 / C-3: 材料は並び順を含めて一致を求める。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());

    const execution = repository.save(
      ourHousehold,
      mealOf({
        ingredients: [
          { name: 'じゃがいも', kind: 'main', amount: null },
          { name: 'にんじん', kind: 'main', amount: '1本' },
        ],
      }),
    );

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('保存済みの献立と手順の本文だけ違う献立の save は拒む', async () => {
    // B-57 規則6 / ADR-057 決定1 / C-3: 手順の本文の一致を求める。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());

    const execution = repository.save(ourHousehold, mealOf({ steps: ['切る', '炒める'] }));

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('保存済みの献立と手順の件数が違う献立の save は拒む', async () => {
    // B-57 規則6 / ADR-057 決定1 / C-3: 手順の件数の一致を求める。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());

    const execution = repository.save(ourHousehold, mealOf({ steps: ['切る', '煮る', '盛る'] }));

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('保存済みの献立と手順の並び順だけ違う献立の save は拒む', async () => {
    // B-57 規則6 / ADR-057 決定1 / C-3: 手順は並び順を含めて一致を求める。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());

    const execution = repository.save(ourHousehold, mealOf({ steps: ['煮る', '切る'] }));

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('保存済みの調理記録が減った献立の save は拒む', async () => {
    // B-57 規則7 / ADR-057 決定2 / C-3: 調理記録は追加のみで、取り除けない。
    const repository: MealRepository = new InMemoryMealRepository(
      mealOf({ cookedAts: ['2026-09-14T19:00:00Z'] }),
    );

    const execution = repository.save(ourHousehold, mealOf());

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('保存済みの調理記録と調理日時が違う献立の save は拒む', async () => {
    // B-57 規則7 / ADR-057 決定2 / C-3: 保存済みの記録は、渡された記録の先頭からの並びでなければならない。
    const repository: MealRepository = new InMemoryMealRepository(
      mealOf({ cookedAts: ['2026-09-14T19:00:00Z'] }),
    );

    const execution = repository.save(
      ourHousehold,
      mealOf({ cookedAts: ['2026-09-15T19:00:00Z'] }),
    );

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('保存済みの調理記録の前に記録を差し込んだ献立の save は拒む', async () => {
    // B-57 規則7 / ADR-057 決定2 / C-3: 記録は末尾に足すものであり、途中に差し込めない。
    const repository: MealRepository = new InMemoryMealRepository(
      mealOf({ cookedAts: ['2026-09-14T19:00:00Z'] }),
    );

    const execution = repository.save(
      ourHousehold,
      mealOf({ cookedAts: ['2026-09-13T19:00:00Z', '2026-09-14T19:00:00Z'] }),
    );

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.contentMismatch' });
  });

  it('同じ内容を別に組み立て、調理記録を1件足した献立の save は通る', async () => {
    // B-57 規則7・10 / ADR-057 決定2: 同じ内容＋記録の追加はべき等に通る（AddCookingRecord の経路）。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());

    const execution = repository.save(
      ourHousehold,
      mealOf({ cookedAts: ['2026-09-14T19:00:00Z'] }),
    );

    await expect(execution).resolves.toBeUndefined();
  });

  it('生成日時だけ違う献立の save は通る', async () => {
    // B-57 規則8 / ADR-057 結果3: 生成日時は読み比べない。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());

    const execution = repository.save(
      ourHousehold,
      mealOf({ generatedAt: '2026-09-14T12:00:00Z' }),
    );

    await expect(execution).resolves.toBeUndefined();
  });

  it('内容の食い違いで拒んだ後も、保存済みの献立は元の名称のまま読み戻せる', async () => {
    // B-57 規則9 / ADR-057 決定1「1行も書かない」: 拒んだ回は置き換えない。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());
    // 拒むこと自体は別の行が確かめる。ここで見るのは拒んだ後に残るものだけである。
    await repository.save(ourHousehold, mealOf({ title: 'カレー' })).catch(() => undefined);

    const found = await repository.findById(
      ourHousehold,
      mealIdOf('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    );

    expect(found?.title).toBe('肉じゃが');
  });

  it('内容の食い違いで拒んだ後も、世帯の献立は1件のまま', async () => {
    // B-57 規則9: 拒んだ回は積みもしない。
    const repository: MealRepository = new InMemoryMealRepository(mealOf());
    // 拒むこと自体は別の行が確かめる。ここで見るのは拒んだ後に残るものだけである。
    await repository
      .save(
        ourHousehold,
        mealOf({
          ingredients: [...baseIngredients, { name: 'たまねぎ', kind: 'main', amount: '1個' }],
        }),
      )
      .catch(() => undefined);

    expect(await repository.findByHousehold(ourHousehold)).toHaveLength(1);
  });
});
