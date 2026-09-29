import { describe, expect, it } from 'vitest';
import { listMeals } from '../../../../src/contexts/meal/usecase/ListMeals.js';
import type { ListMeals } from '../../../../src/contexts/meal/usecase/ListMeals.js';
import type { Meal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import type { MealRepository } from '../../../../src/contexts/meal/domain/repository/MealRepository.js';
import { createMeal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { createCookingRecord } from '../../../../src/contexts/meal/domain/value/CookingRecord.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryMealRepository } from '../../../support/meal/InMemoryMealRepository.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

/** 識別子はコード単位の昇順が a < b < c になるように置く（規則3 の同時刻の閉じ方）。 */
const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const idC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function mainIngredient(name: string) {
  return createMealIngredient({ name, kind: 'main', amount: amountOf(null) });
}

function seasoning(name: string) {
  return createMealIngredient({ name, kind: 'seasoning', amount: amountOf(null) });
}

/** 調理記録1件。日時が本題のときだけ引数で上書きする。 */
function cookingRecord(cookedAt = '2026-09-20T10:00:00Z') {
  return createCookingRecord({ cookedAt: dateTimeOf(cookedAt) });
}

/** 献立1件。本題でない値をここに隠す（`docs/testing.md` 6章）。 */
function meal(
  overrides: Omit<Partial<Parameters<typeof createMeal>[0]>, 'id' | 'generatedAt'> & {
    id?: string;
    generatedAt?: string;
  } = {},
): Meal {
  const { id, generatedAt, ...rest } = overrides;
  return createMeal({
    householdId: ourHousehold,
    title: '肉じゃが',
    ingredients: [mainIngredient('にんじん')],
    steps: [cookingStepOf('煮る')],
    cookingRecords: [],
    ...rest,
    id: mealIdOf(id ?? idA),
    generatedAt: dateTimeOf(generatedAt ?? '2026-09-13T12:00:00Z'),
  });
}

/**
 * 本題でない結線を隠す（`docs/testing.md` 6章）。前提の献立は記憶上のリポジトリに置く。
 * 取得が落ちる回だけ、必ず投げるリポジトリに差し替える（記憶上の実装に失敗の口を足さない）。
 */
function setUp(props: { meals?: readonly Meal[]; findByHouseholdThrows?: Error }) {
  const findByHouseholdThrows = props.findByHouseholdThrows;
  const repository: MealRepository =
    findByHouseholdThrows === undefined
      ? new InMemoryMealRepository(...(props.meals ?? []))
      : {
          findByHousehold: () => Promise.reject(findByHouseholdThrows),
          findById: () => Promise.reject(findByHouseholdThrows),
          save: () => Promise.reject(findByHouseholdThrows),
          deleteByHousehold: () => Promise.reject(findByHouseholdThrows),
        };

  return { list: listMeals({ mealRepository: repository }) };
}

/** deps の形。献立のリポジトリのほかに何も取らないことを型として主張する（規則9）。 */
type ListMealsDeps = Parameters<typeof listMeals>[0];

/** deps のキーが献立のリポジトリだけなら `true`、1つでも他のキーがあれば `never`。 */
type DepsTakeOnlyMealRepository = keyof ListMealsDeps extends 'mealRepository' ? true : never;

/** 引数が世帯1つだけなら `true`。基準日時を足した時点で型検査で落ちる（規則9）。 */
type TakesOneArgument = Parameters<ListMeals>['length'] extends 1 ? true : never;

describe('献立の一覧 ListMeals', () => {
  describe('調理記録の有無による振り分け', () => {
    it('調理記録の無い献立は「以前見た献立」の列に入る', async () => {
      // 規則2 / FR-28 / FR-29 注記: 記録0件は seen である。
      const { list } = setUp({ meals: [meal({ id: idA, cookingRecords: [] })] });

      const output = await list(ourHousehold);

      expect(output.seen.map((summary) => summary.mealId)).toEqual([idA]);
      expect(output.cooked).toEqual([]);
    });

    it('調理記録が1件ある献立は「つくった献立」の列に入る', async () => {
      // 規則2 / FR-29: 記録1件以上は cooked である。
      const { list } = setUp({ meals: [meal({ id: idA, cookingRecords: [cookingRecord()] })] });

      const output = await list(ourHousehold);

      expect(output.cooked.map((summary) => summary.mealId)).toEqual([idA]);
      expect(output.seen).toEqual([]);
    });

    it('調理記録が複数ある献立も「つくった献立」に1度だけ現れる', async () => {
      // 規則2 / FR-29: 記録の件数だけ並べない。
      const { list } = setUp({
        meals: [
          meal({
            id: idA,
            cookingRecords: [
              cookingRecord('2026-09-20T10:00:00Z'),
              cookingRecord('2026-09-21T10:00:00Z'),
              cookingRecord('2026-09-22T10:00:00Z'),
            ],
          }),
        ],
      });

      const output = await list(ourHousehold);

      expect(output.cooked.map((summary) => summary.mealId)).toEqual([idA]);
    });

    it('どの献立もちょうど一方の列にだけ現れる', async () => {
      // 規則2: 両方にも、どちらにも無いことも起きない。
      const { list } = setUp({
        meals: [
          meal({ id: idA, generatedAt: '2026-09-13T12:00:00Z', cookingRecords: [] }),
          meal({ id: idB, generatedAt: '2026-09-12T12:00:00Z', cookingRecords: [cookingRecord()] }),
          meal({ id: idC, generatedAt: '2026-09-11T12:00:00Z', cookingRecords: [] }),
        ],
      });

      const output = await list(ourHousehold);

      expect(output.seen.map((summary) => summary.mealId)).toEqual([idA, idC]);
      expect(output.cooked.map((summary) => summary.mealId)).toEqual([idB]);
    });

    it('献立が1件も無い世帯では両方の列が空で返る', async () => {
      // 規則8 / FR-28: 404 にも null にもしない。
      const { list } = setUp({ meals: [] });

      const output = await list(ourHousehold);

      expect(output).toEqual({ seen: [], cooked: [] });
    });
  });

  describe('並び', () => {
    it('以前見た献立は生成日時の新しい順に並ぶ', async () => {
      // 規則3 / FR-28 / ADR-068 決定2: 挿入順と生成日時の順を違えておく。
      const { list } = setUp({
        meals: [
          meal({ id: idA, generatedAt: '2026-09-10T12:00:00Z' }),
          meal({ id: idB, generatedAt: '2026-09-14T12:00:00Z' }),
          meal({ id: idC, generatedAt: '2026-09-12T12:00:00Z' }),
        ],
      });

      const output = await list(ourHousehold);

      expect(output.seen.map((summary) => summary.mealId)).toEqual([idB, idC, idA]);
    });

    it('つくった献立は生成日時の新しい順に並ぶ', async () => {
      // 規則3 / FR-29 / ADR-068 決定2: 古い順に挿入しておく。
      const { list } = setUp({
        meals: [
          meal({ id: idA, generatedAt: '2026-09-10T12:00:00Z', cookingRecords: [cookingRecord()] }),
          meal({ id: idB, generatedAt: '2026-09-12T12:00:00Z', cookingRecords: [cookingRecord()] }),
          meal({ id: idC, generatedAt: '2026-09-14T12:00:00Z', cookingRecords: [cookingRecord()] }),
        ],
      });

      const output = await list(ourHousehold);

      expect(output.cooked.map((summary) => summary.mealId)).toEqual([idC, idB, idA]);
    });

    it('つくった献立は調理記録の日時ではなく献立の生成日時で並ぶ', async () => {
      // 規則3 / ADR-068 決定2 / `docs/screen-design.md` 7章「新しい順（生成日時）」:
      // 記録の日時で並べると A が先になる入力である。
      const { list } = setUp({
        meals: [
          meal({
            id: idA,
            generatedAt: '2026-09-10T12:00:00Z',
            cookingRecords: [cookingRecord('2026-09-20T10:00:00Z')],
          }),
          meal({
            id: idB,
            generatedAt: '2026-09-12T12:00:00Z',
            cookingRecords: [cookingRecord('2026-09-13T10:00:00Z')],
          }),
        ],
      });

      const output = await list(ourHousehold);

      expect(output.cooked.map((summary) => summary.mealId)).toEqual([idB, idA]);
    });

    it('生成日時が同じ献立は識別子の昇順に並ぶ', async () => {
      // 規則3 / C-12 の最終段: 同じ入力で並びが変わらない。挿入は B → A の順にしておく。
      const { list } = setUp({
        meals: [
          meal({ id: idB, generatedAt: '2026-09-13T12:00:00Z' }),
          meal({ id: idA, generatedAt: '2026-09-13T12:00:00Z' }),
        ],
      });

      const output = await list(ourHousehold);

      expect(output.seen.map((summary) => summary.mealId)).toEqual([idA, idB]);
    });
  });

  describe('1件の中身', () => {
    it('件数は主材料だけを数え、調味料を数えない', async () => {
      // 規則4 / C-16 / `docs/screen-design.md` D-4: 調味料は常備の前提である。
      const { list } = setUp({
        meals: [
          meal({
            ingredients: [mainIngredient('じゃがいも'), seasoning('醤油'), mainIngredient('牛肉')],
          }),
        ],
      });

      const output = await list(ourHousehold);

      expect(output.seen[0]?.ingredientCount).toBe(2);
    });

    it('1件には識別子と名称をそのまま載せる', async () => {
      // 規則6 / FR-28: 一覧から献立詳細を開くのに識別子が要り、見分けるのに名称が要る。
      const { list } = setUp({ meals: [meal({ id: idA, title: 'きんぴらごぼう' })] });

      const output = await list(ourHousehold);

      expect(output.seen[0]?.mealId).toBe(idA);
      expect(output.seen[0]?.title).toBe('きんぴらごぼう');
    });

    it('1件に載せるのは識別子・名称・主材料の件数の3つだけである', async () => {
      // 規則6 / B-48a 規則12 / NFR-09 / ADR-068 決定3・4: 世帯・調理記録・生成日時・充足を載せない。
      const { list } = setUp({
        meals: [
          meal({ id: idA, cookingRecords: [] }),
          meal({ id: idB, cookingRecords: [cookingRecord()] }),
        ],
      });

      const output = await list(ourHousehold);

      expect(Object.keys(output.seen[0] ?? {})).toEqual(['mealId', 'title', 'ingredientCount']);
      expect(Object.keys(output.cooked[0] ?? {})).toEqual(['mealId', 'title', 'ingredientCount']);
    });
  });

  describe('世帯の分離', () => {
    it('他世帯の献立はどちらの列にも現れない', async () => {
      // C-9: 世帯をまたいで読まない。
      const { list } = setUp({
        meals: [
          meal({ id: idA, cookingRecords: [] }),
          meal({ id: idB, cookingRecords: [cookingRecord()] }),
          meal({ id: idC, householdId: neighborHousehold, cookingRecords: [] }),
          meal({
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            householdId: neighborHousehold,
            cookingRecords: [cookingRecord()],
          }),
        ],
      });

      const output = await list(ourHousehold);

      expect(output.seen.map((summary) => summary.mealId)).toEqual([idA]);
      expect(output.cooked.map((summary) => summary.mealId)).toEqual([idB]);
    });
  });

  describe('失敗', () => {
    it('献立の取得が失敗したらそのまま伝える', async () => {
      // ADR-045 / 先行 `ShowMeal`: 写せない失敗を規則違反に包まない。
      const failure = new Error('接続が切れた');
      const { list } = setUp({ findByHouseholdThrows: failure });

      await expect(list(ourHousehold)).rejects.toBe(failure);
    });
  });

  describe('依存と引数の形', () => {
    it('依存に取るのは献立のリポジトリだけである', () => {
      // 規則1 / 規則9 / C-8: 在庫も提案も読まない。口を足した時点でこの行が typecheck で落ちる。
      const assertion: DepsTakeOnlyMealRepository = true;

      expect(assertion).toBe(true);
    });

    it('引数は世帯1つだけで、基準日時を取らない', () => {
      // 規則9 / C-9 / ADR-065 理由(4): 時刻に依存する判断が1つも無い。
      const assertion: TakesOneArgument = true;

      expect(assertion).toBe(true);
    });
  });
});
