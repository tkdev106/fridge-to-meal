import { describe, expect, it } from 'vitest';
import type { StockItemDto } from '@fridge-to-meal/contract';
import { showMeal } from '../../../../src/contexts/meal/usecase/ShowMeal.js';
import type { ShowMeal } from '../../../../src/contexts/meal/usecase/ShowMeal.js';
import { showLatestSuggestion } from '../../../../src/contexts/meal/usecase/ShowLatestSuggestion.js';
import type { Meal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import type { MealRepository } from '../../../../src/contexts/meal/domain/repository/MealRepository.js';
import { createMeal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { createSuggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { createCookingRecord } from '../../../../src/contexts/meal/domain/value/CookingRecord.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { createPantrySnapshot } from '../../../../src/contexts/meal/domain/value/PantrySnapshot.js';
import { createSuggestionEntry } from '../../../../src/contexts/meal/domain/value/SuggestionEntry.js';
import { suggestionIdOf } from '../../../../src/contexts/meal/domain/value/SuggestionId.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { FixedListStockItems } from '../../../support/pantry/FixedStockItemUsecases.js';
import { InMemoryMealRepository } from '../../../support/meal/InMemoryMealRepository.js';
import { InMemorySuggestionRepository } from '../../../support/meal/InMemorySuggestionRepository.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const idC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** 在庫品の識別子。献立の出力には出てこない（ADR-037）ので番号で配る。 */
let stockItemSequence = 0;
function stockItem(props: {
  name: string;
  amount?: string | null;
  expiryDate?: string | null;
  useForMeals?: boolean;
}): StockItemDto {
  stockItemSequence += 1;
  return {
    id: `00000000-0000-4000-8000-${String(stockItemSequence).padStart(12, '0')}`,
    name: props.name,
    ingredientId: null,
    amount: props.amount ?? null,
    expiryDate: props.expiryDate ?? null,
    useForMeals: props.useForMeals ?? true,
  };
}

function mainIngredient(name: string, amount: string | null = null) {
  return createMealIngredient({ name, kind: 'main', amount: amountOf(amount) });
}

function seasoning(name: string) {
  return createMealIngredient({ name, kind: 'seasoning', amount: amountOf(null) });
}

function meal(overrides: Partial<Parameters<typeof createMeal>[0]> = {}): Meal {
  return createMeal({
    id: mealIdOf(idA),
    householdId: ourHousehold,
    title: '肉じゃが',
    ingredients: [mainIngredient('にんじん')],
    steps: [cookingStepOf('煮る')],
    generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
    cookingRecords: [],
    ...overrides,
  });
}

/**
 * 本題でない結線を隠す（`docs/testing.md` 6章）。前提の献立は記憶上のリポジトリに置き、
 * 現在の在庫は在庫の一覧の代役が返す。
 */
function setUp(props: {
  meals?: readonly Meal[];
  stockItems?: readonly StockItemDto[];
  listStockItemsThrows?: Error;
  findByIdThrows?: Error;
}) {
  const mealRepository = new InMemoryMealRepository(...(props.meals ?? []));
  const listStockItems = new FixedListStockItems(
    props.listStockItemsThrows === undefined
      ? { returns: { stockItems: [...(props.stockItems ?? [])] } }
      : { throws: props.listStockItemsThrows },
  );

  // 献立が引けない回は、必ず投げるリポジトリに差し替える（記憶上の実装に失敗の口を足さない）。
  const findByIdThrows = props.findByIdThrows;
  const failingRepository: MealRepository = {
    findByHousehold: () => Promise.reject(findByIdThrows ?? new Error('用意されていない失敗')),
    findById: () => Promise.reject(findByIdThrows ?? new Error('用意されていない失敗')),
    save: () => Promise.reject(findByIdThrows ?? new Error('用意されていない失敗')),
    deleteByHousehold: () => Promise.reject(findByIdThrows ?? new Error('用意されていない失敗')),
  };
  const repository = findByIdThrows === undefined ? mealRepository : failingRepository;

  return {
    show: showMeal({ listStockItems: listStockItems.list, mealRepository: repository }),
    listStockItems,
    mealRepository,
  };
}

/** 献立詳細の出力から、識別子と調理記録の有無を除いた中身（名称・材料・手順・充足）を取り出す。 */
function mealContentOf(output: Awaited<ReturnType<ShowMeal>>) {
  return {
    title: output.title,
    ingredients: output.ingredients,
    steps: output.steps,
    coverage: output.coverage,
  };
}

/** deps の形。在庫を書き換える口を1つも取らないことを型として主張する（C-8 / 規則10）。 */
type ShowMealDeps = Parameters<typeof showMeal>[0];

/** deps のキーが2つだけなら `true`、1つでも他のキーがあれば `never`（代入が型検査で落ちる）。 */
type DepsTakeNoStockItemWritePort = keyof ShowMealDeps extends 'listStockItems' | 'mealRepository'
  ? true
  : never;

/** 引数が世帯と識別子の2つだけなら `true`。基準日時を足した時点で型検査で落ちる（規則11）。 */
type TakesTwoArguments = Parameters<ShowMeal>['length'] extends 2 ? true : never;

describe('献立1件を充足つきで返す ShowMeal', () => {
  describe('献立の中身', () => {
    it('献立1件を名称・材料・手順つきで返す', async () => {
      // 規則1 / FR-30: 識別子・名称・材料・手順を持つ。
      const { show } = await setUp({
        meals: [
          meal({
            title: '肉じゃが',
            ingredients: [mainIngredient('にんじん', '1本')],
            steps: [cookingStepOf('切る'), cookingStepOf('煮る')],
          }),
        ],
        stockItems: [],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.mealId).toBe(idA);
      expect(output.title).toBe('肉じゃが');
      expect(output.ingredients).toEqual([{ name: 'にんじん', kind: 'main', amount: '1本' }]);
      expect(output.steps).toEqual(['切る', '煮る']);
    });

    it('世帯と識別子の両方が一致する献立だけを返す', async () => {
      // 規則1 / C-9: 指した識別子の献立だけが返る。
      const { show } = await setUp({
        meals: [
          meal({ id: mealIdOf(idA), title: '肉じゃが' }),
          meal({ id: mealIdOf(idB), title: 'きんぴら' }),
        ],
      });

      const output = await show(ourHousehold, mealIdOf(idB));

      expect(output.title).toBe('きんぴら');
    });

    it('材料は保存された並びのまま返す', async () => {
      // 規則7 / C-3 / C-5: 並べ替えも補完もしない。
      const { show } = await setUp({
        meals: [
          meal({
            ingredients: [mainIngredient('じゃがいも'), seasoning('醤油'), mainIngredient('牛肉')],
          }),
        ],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.ingredients.map((ingredient) => ingredient.name)).toEqual([
        'じゃがいも',
        '醤油',
        '牛肉',
      ]);
    });

    it('手順は保存された並びのまま返す', async () => {
      // 規則7 / C-3 / FR-30: 手順の並びは献立そのものである。
      const { show } = await setUp({
        meals: [
          meal({ steps: [cookingStepOf('切る'), cookingStepOf('炒める'), cookingStepOf('煮る')] }),
        ],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.steps).toEqual(['切る', '炒める', '煮る']);
    });

    it('分量の無い材料は分量なしのまま返す', async () => {
      // 規則7 / ADR-010: 分量は自由文字列で、未設定は null のままである。
      const { show } = await setUp({
        meals: [meal({ ingredients: [mainIngredient('にんじん', null)] })],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.ingredients[0]?.amount).toBeNull();
    });

    it('献立1件の出力に由来を載せない', async () => {
      // 規則8 / FR-35 / ADR-067 論点1: 由来は提案の1件の性質であって献立の性質ではない。
      const { show } = await setUp({ meals: [meal()] });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect('origin' in output).toBe(false);
    });

    it('献立1件の出力に世帯も調理記録も生成日時も載せない', async () => {
      // 規則9 / NFR-09 / B-48a 規則12: どれも contract のこの型には無い。
      const { show } = await setUp({
        meals: [
          meal({
            cookingRecords: [createCookingRecord({ cookedAt: dateTimeOf('2026-09-20T10:00:00Z') })],
          }),
        ],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect('householdId' in output).toBe(false);
      expect('cookingRecords' in output).toBe(false);
      expect('generatedAt' in output).toBe(false);
    });
  });

  describe('引けない献立', () => {
    it('その世帯に献立が無い識別子を指したら断る', async () => {
      // 規則2: 無ければ規則違反で断る。
      const { show } = await setUp({});

      await expect(show(ourHousehold, mealIdOf(idA))).rejects.toThrow(MealRuleViolation);
      await expect(show(ourHousehold, mealIdOf(idA))).rejects.toMatchObject({
        rule: 'showMeal.mealNotFound',
      });
    });

    it('他世帯の献立を指した回も、その世帯に無い回と同じ規則で断る', async () => {
      // C-9 / NFR-09 / 規則2: 世帯で分けたことが断り方の違いとして漏れない。
      const { show } = await setUp({
        meals: [meal({ id: mealIdOf(idB), householdId: neighborHousehold })],
      });

      const neighborRule = await show(ourHousehold, mealIdOf(idB)).then(
        () => null,
        (thrown: { rule?: string }) => thrown.rule,
      );
      const unknownRule = await show(ourHousehold, mealIdOf(idC)).then(
        () => null,
        (thrown: { rule?: string }) => thrown.rule,
      );

      expect(neighborRule).toBe(unknownRule);
    });

    it('断りの文面に献立の識別子も世帯も載せない', async () => {
      // NFR-09 / 規則2: 文面から「他の世帯には在る」が漏れない。
      const { show } = await setUp({
        meals: [meal({ id: mealIdOf(idB), householdId: neighborHousehold })],
      });

      const message = await show(ourHousehold, mealIdOf(idB)).then(
        () => '',
        (thrown: Error) => thrown.message,
      );

      expect(message).not.toContain(idB);
      expect(message).not.toContain(ourHousehold);
      expect(message).not.toContain(neighborHousehold);
    });

    it('在庫の取得が落ちる回でも、その世帯に無い献立を指せば同じ規則で断る', async () => {
      // 規則3: 献立を先に引く。引けなければ在庫を1行も読まない。
      const { show } = await setUp({ listStockItemsThrows: new Error('在庫が引けない') });

      await expect(show(ourHousehold, mealIdOf(idA))).rejects.toThrow(MealRuleViolation);
    });

    it('献立の取得が失敗したらそのまま伝える', async () => {
      // 先行 `ShowLatestSuggestion`: 写せない失敗を規則違反に包まない（ADR-045）。
      const { show } = await setUp({ findByIdThrows: new Error('接続が切れた') });

      await expect(show(ourHousehold, mealIdOf(idA))).rejects.toThrow('接続が切れた');
    });
  });

  describe('現在の在庫での充足', () => {
    it('充足は保存時ではなく現在の在庫で算出する', async () => {
      // 規則4 / FR-32 / ADR-009: 保存されているのは献立であって充足ではない。
      const { show } = await setUp({
        meals: [meal({ ingredients: [mainIngredient('にんじん')] })],
        stockItems: [stockItem({ name: 'にんじん' })],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.coverage.covered.map((ingredient) => ingredient.name)).toEqual(['にんじん']);
      expect(output.coverage.missing).toEqual([]);
    });

    it('献立に使わない在庫品の名称の主材料も、献立1件の充足では賄える材料に載る', async () => {
      // FR-32 / FR-43 / 設計書 規則11: 献立詳細の充足は献立に使うかどうかで変えない。
      const { show } = await setUp({
        meals: [meal({ ingredients: [mainIngredient('にんじん')] })],
        stockItems: [stockItem({ name: 'にんじん', useForMeals: false })],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.coverage.covered.map((ingredient) => ingredient.name)).toEqual(['にんじん']);
    });

    it('在庫に無い主材料は不足になる', async () => {
      // 規則4 / FR-32。
      const { show } = await setUp({
        meals: [meal({ ingredients: [mainIngredient('にんじん')] })],
        stockItems: [stockItem({ name: '玉ねぎ' })],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.coverage.missing.map((ingredient) => ingredient.name)).toEqual(['にんじん']);
      expect(output.coverage.covered).toEqual([]);
    });

    it('突き合わせは名称の完全一致で、前後の空白だけ落とす', async () => {
      // C-6 / 規則4: 表記ゆれは吸収しないが、前後空白は両側で落とす。
      const { show } = await setUp({
        meals: [meal({ ingredients: [mainIngredient('にんじん')] })],
        stockItems: [stockItem({ name: '  にんじん  ' })],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.coverage.covered.map((ingredient) => ingredient.name)).toEqual(['にんじん']);
    });

    it('名称が前方一致するだけの在庫品は主材料を賄わない', async () => {
      // C-6 / 規則4: 完全一致である。
      const { show } = await setUp({
        meals: [meal({ ingredients: [mainIngredient('にんじん')] })],
        stockItems: [stockItem({ name: 'にんじんジュース' })],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.coverage.missing.map((ingredient) => ingredient.name)).toEqual(['にんじん']);
    });

    it('調味料は賄えるものにも不足にも現れない', async () => {
      // C-16 / ADR-023 / 規則5: 調味料は常備の前提である。
      const { show } = await setUp({
        meals: [meal({ ingredients: [mainIngredient('にんじん'), seasoning('醤油')] })],
        stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: '醤油' })],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.coverage.covered.map((ingredient) => ingredient.name)).not.toContain('醤油');
      expect(output.coverage.missing.map((ingredient) => ingredient.name)).not.toContain('醤油');
    });

    it('賄える材料には同じ名称の在庫品のうち最も早い期限を載せる', async () => {
      // 規則6 / ADR-061 決定2: 最も早い期限が、先に使うべき在庫品を指す。
      const { show } = await setUp({
        meals: [meal({ ingredients: [mainIngredient('にんじん')] })],
        stockItems: [
          stockItem({ name: 'にんじん', expiryDate: '2026-10-05' }),
          stockItem({ name: 'にんじん', expiryDate: '2026-09-30' }),
        ],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.coverage.covered[0]?.expiryDate).toBe('2026-09-30');
    });

    it('期限を持つ在庫品が無ければ賄える材料の期限は null になる', async () => {
      // 規則6 / ADR-036: 期限は任意である。
      const { show } = await setUp({
        meals: [meal({ ingredients: [mainIngredient('にんじん')] })],
        stockItems: [stockItem({ name: 'にんじん', expiryDate: null })],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.coverage.covered[0]?.expiryDate).toBeNull();
    });

    it('期限切れの在庫品も落とさず、期限を日付のまま載せる', async () => {
      // 規則6 / ADR-061 決定2: 残日数も「今日」も載せない（基準日時を持たない）。
      const { show } = await setUp({
        meals: [meal({ ingredients: [mainIngredient('にんじん')] })],
        stockItems: [stockItem({ name: 'にんじん', expiryDate: '2020-01-01' })],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.coverage.covered[0]?.expiryDate).toBe('2020-01-01');
    });

    it('在庫が0件でも通り、主材料がすべて不足になる', async () => {
      // 規則12 / FR-32: 在庫が空であることは断る理由にならない。
      const { show } = await setUp({
        meals: [meal({ ingredients: [mainIngredient('にんじん'), mainIngredient('牛肉')] })],
        stockItems: [],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.coverage.missing).toHaveLength(2);
      expect(output.coverage.covered).toHaveLength(0);
    });
  });

  describe('読み取り専用であること', () => {
    it('献立を1件も保存しない', async () => {
      // C-3 / 規則10: 読み取りの経路である。呼んだだけで献立が変わってはいけない。
      const { show, mealRepository } = await setUp({ meals: [meal()] });
      const before = (await mealRepository.findByHousehold(ourHousehold)).map(
        (stored) => stored.title,
      );

      await show(ourHousehold, mealIdOf(idA));

      const after = await mealRepository.findByHousehold(ourHousehold);
      expect(after.map((stored) => stored.title)).toEqual(before);
    });

    it('依存に在庫を書き換える口を1つも取らない', () => {
      // C-8 / 規則10: 在庫の登録・更新・削除の口を足した時点で、この行が typecheck で
      // 落ちる。実行時には何も確かめていない（先行 `CookingRecordRoutes.test.ts`「依存の形」）。
      const assertion: DepsTakeNoStockItemWritePort = true;

      expect(assertion).toBe(true);
    });

    it('基準日時を受け取らない', () => {
      // 規則11 / ADR-065 理由(4): 引数は世帯と識別子の2つだけで、時計も読まない。
      const assertion: TakesTwoArguments = true;

      expect(assertion).toBe(true);
    });
  });

  describe('調理記録の有無', () => {
    it('調理記録が1件もない献立は cooked が偽になる', async () => {
      // 規則1 / FR-31 / ADR-070 決定2: 0件なら偽。
      const { show } = await setUp({ meals: [meal({ cookingRecords: [] })] });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.cooked).toBe(false);
    });

    it('調理記録が1件ある献立は cooked が真になる', async () => {
      // 規則1 / FR-31 / ADR-070 決定2: 1件以上なら真（ADR-068 決定3 の振り分けと同じ判定）。
      const { show } = await setUp({
        meals: [
          meal({
            cookingRecords: [createCookingRecord({ cookedAt: dateTimeOf('2026-09-20T10:00:00Z') })],
          }),
        ],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.cooked).toBe(true);
    });

    it('調理記録が複数ある献立も cooked は真で、件数を載せない', async () => {
      // 規則1 / 規則4 / ADR-070 決定2: 件数によって値の意味を変えない。
      const { show } = await setUp({
        meals: [
          meal({
            cookingRecords: [
              createCookingRecord({ cookedAt: dateTimeOf('2026-09-18T10:00:00Z') }),
              createCookingRecord({ cookedAt: dateTimeOf('2026-09-19T10:00:00Z') }),
              createCookingRecord({ cookedAt: dateTimeOf('2026-09-20T10:00:00Z') }),
            ],
          }),
        ],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(output.cooked).toBe(true);
    });

    it('他世帯の調理記録のある献立を指したら断り、cooked を返さない', async () => {
      // 規則2 / C-9 / NFR-09 / ADR-070 決定3: 値は世帯で引けた献立からだけ導く。
      const { show } = await setUp({
        meals: [
          meal({
            id: mealIdOf(idB),
            householdId: neighborHousehold,
            cookingRecords: [createCookingRecord({ cookedAt: dateTimeOf('2026-09-20T10:00:00Z') })],
          }),
        ],
      });

      await expect(show(ourHousehold, mealIdOf(idB))).rejects.toThrow(MealRuleViolation);
      await expect(show(ourHousehold, mealIdOf(idB))).rejects.toMatchObject({
        rule: 'showMeal.mealNotFound',
      });
    });

    it('献立詳細の出力は識別子・名称・材料・手順・充足・cooked のほかに何も載せない', async () => {
      // 規則4 / NFR-09 / ADR-070 決定2: 記録の日時・件数・識別子・世帯を載せない。
      const { show } = await setUp({
        meals: [
          meal({
            cookingRecords: [createCookingRecord({ cookedAt: dateTimeOf('2026-09-20T10:00:00Z') })],
          }),
        ],
      });

      const output = await show(ourHousehold, mealIdOf(idA));

      expect(Object.keys(output).sort()).toEqual([
        'cooked',
        'coverage',
        'ingredients',
        'mealId',
        'steps',
        'title',
      ]);
    });

    it('調理記録のある献立でも、名称・材料・手順・充足は記録のない献立と同じ値を返す', async () => {
      // 規則5 / FR-30 / C-3 / ADR-009: 記録の有無は献立の中身でも充足でもない。
      const { show } = await setUp({
        meals: [
          meal({ id: mealIdOf(idA), cookingRecords: [] }),
          meal({
            id: mealIdOf(idB),
            cookingRecords: [createCookingRecord({ cookedAt: dateTimeOf('2026-09-20T10:00:00Z') })],
          }),
        ],
        stockItems: [stockItem({ name: 'にんじん', expiryDate: '2026-09-30' })],
      });

      const withoutRecord = await show(ourHousehold, mealIdOf(idA));
      const withRecord = await show(ourHousehold, mealIdOf(idB));

      expect(mealContentOf(withRecord)).toEqual(mealContentOf(withoutRecord));
    });
  });

  describe('提案の1件との一致', () => {
    it('同じ献立と同じ在庫なら、提案の1件と同じ中身を返す', async () => {
      // 規則16 / ADR-065 理由(2): 写しを2つ持たない。由来だけが提案の側にある。
      const stockItems = [stockItem({ name: 'にんじん', expiryDate: '2026-09-30' })];
      const stored = meal({
        ingredients: [mainIngredient('にんじん', '1本'), seasoning('醤油')],
        steps: [cookingStepOf('切る'), cookingStepOf('煮る')],
      });

      const suggestionRepository = new InMemorySuggestionRepository({});
      await suggestionRepository.save(
        ourHousehold,
        createSuggestion({
          id: suggestionIdOf('66666666-6666-4666-8666-666666666666'),
          householdId: ourHousehold,
          entries: [createSuggestionEntry({ mealId: mealIdOf(idA), origin: 'reused' })],
          pantrySnapshot: createPantrySnapshot({ stockItems: [] }),
          generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
        }),
      );

      const mealRepository = new InMemoryMealRepository(stored);
      const listStockItems = new FixedListStockItems({ returns: { stockItems } });
      const show = showMeal({ listStockItems: listStockItems.list, mealRepository });
      const showSuggestion = showLatestSuggestion({
        listStockItems: listStockItems.list,
        mealRepository,
        suggestionRepository,
      });

      const mealOutput = await show(ourHousehold, mealIdOf(idA));
      const suggestionOutput = await showSuggestion(ourHousehold);

      if (suggestionOutput.outcome !== 'suggested') throw new Error('提案が返らなかった');
      const entry = suggestionOutput.suggestion.entries[0];
      if (entry === undefined) throw new Error('提案の1件が無かった');
      const { origin, ...entryWithoutOrigin } = entry;
      // ADR-070 決定1: 調理記録の有無は献立詳細の側にだけあり、提案の1件には無い。
      const { cooked, ...mealWithoutCooked } = mealOutput;

      expect(origin).toBe('reused');
      expect(cooked).toBe(false);
      expect(mealWithoutCooked).toEqual(entryWithoutOrigin);
    });
  });
});
