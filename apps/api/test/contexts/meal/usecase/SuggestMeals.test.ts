import { describe, expect, it } from 'vitest';
import type { StockItemDto, SuggestMealsOutput, SuggestionOutput } from '@fridge-to-meal/contract';
import {
  suggestMeals,
  suggestNewMeals,
} from '../../../../src/contexts/meal/usecase/SuggestMeals.js';
import type { Meal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { createMeal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import type { Suggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import { createSuggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import type { GeneratedMeal } from '../../../../src/contexts/meal/domain/value/GeneratedMeal.js';
import { createGeneratedMeal } from '../../../../src/contexts/meal/domain/value/GeneratedMeal.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { createPantrySnapshot } from '../../../../src/contexts/meal/domain/value/PantrySnapshot.js';
import type { StockItem } from '../../../../src/contexts/meal/domain/value/StockItem.js';
import { createStockItem } from '../../../../src/contexts/meal/domain/value/StockItem.js';
import type { SuggestionEntryOrigin } from '../../../../src/contexts/meal/domain/value/SuggestionEntry.js';
import { createSuggestionEntry } from '../../../../src/contexts/meal/domain/value/SuggestionEntry.js';
import { suggestionIdOf } from '../../../../src/contexts/meal/domain/value/SuggestionId.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { expiryDateOf } from '../../../../src/contexts/meal/domain/value/ExpiryDate.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { createCookingRecord } from '../../../../src/contexts/meal/domain/value/CookingRecord.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { FixedListStockItems } from '../../../support/pantry/FixedStockItemUsecases.js';
import type { SaveFailure } from '../../../support/meal/InMemoryMealRepository.js';
import { InMemoryMealRepository } from '../../../support/meal/InMemoryMealRepository.js';
import { InMemorySuggestionRepository } from '../../../support/meal/InMemorySuggestionRepository.js';
import { FixedGeneratedMealChecker } from '../../../support/meal/FixedGeneratedMealChecker.js';
import type { MealGenerationOutcome } from '../../../support/meal/FixedMealGenerator.js';
import { FixedMealGenerator } from '../../../support/meal/FixedMealGenerator.js';
import { fixedMealIdGenerator } from '../../../support/meal/FixedMealIdGenerator.js';
import { fixedSuggestionIdGenerator } from '../../../support/meal/FixedSuggestionIdGenerator.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

/** 献立の識別子。C-12 の最後の段は `MealId` の昇順なので、a < b < c < d の順になっている。 */
const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const idC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const idD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** 提案の識別子。本題が識別子でないときに発行させる値（#6 だけが自分で literal を渡す）。 */
const suggestionId = '55555555-5555-4555-8555-555555555555';

/** 基準日時。現在時刻を読まず引数で渡す（`docs/testing.md` 5章）。時差つきの表記である。 */
const asOf = '2026-09-14T12:00:00+09:00';

/** 本題が在庫品の識別子でないときの採番。在庫品の識別子は提案には出てこない（ADR-037）。 */
let sequence = 0;
function nextStockItemId() {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

/** 在庫の一覧が返す在庫品1件。テストの本題でない項目を隠す（`docs/testing.md` 6章）。 */
function stockItem(props: {
  id?: string;
  name: string;
  ingredientId?: string | null;
  amount?: string | null;
  expiryDate?: string | null;
  useForMeals?: boolean;
}): StockItemDto {
  return {
    id: props.id ?? nextStockItemId(),
    name: props.name,
    ingredientId: props.ingredientId ?? null,
    amount: props.amount ?? null,
    expiryDate: props.expiryDate ?? null,
    useForMeals: props.useForMeals ?? true,
  };
}

/**
 * 在庫スナップショットに入れる献立側の在庫品1件。持つのは**名称・分量・期限の3項目**だけで
 * ある（ADR-037 決定1）。C-7 の一致はこの3つ組の多重集合で見るので、上の `stockItem` と同じ
 * 3項目を渡せば「在庫が変わっていない」回になる（ADR-037 決定2）。
 */
function mealStockItem(props: {
  name: string;
  amount?: string | null;
  expiryDate?: string | null;
}): StockItem {
  return createStockItem({
    name: props.name,
    amount: amountOf(props.amount ?? null),
    expiryDate: expiryDateOf(props.expiryDate ?? null),
  });
}

/** 主材料。突き合わせの対象になる側（C-16 / ADR-023）。 */
function mainIngredient(name: string) {
  return createMealIngredient({ name, kind: 'main', amount: null });
}

/** 調味料。充足の突き合わせには載らない側（C-16 / ADR-023）。 */
function seasoning(name: string, amount: string) {
  return createMealIngredient({ name, kind: 'seasoning', amount: amountOf(amount) });
}

/**
 * 生成器が返す生成結果1件。本題でない値を隠す（`docs/testing.md` 6章）。既定は
 * 主材料1件・手順1件で、識別子も世帯も生成日時も持たない（ADR-035 / C-1）。
 */
function generatedMeal(
  overrides: Partial<Parameters<typeof createGeneratedMeal>[0]> = {},
): GeneratedMeal {
  return createGeneratedMeal({
    title: 'ごま和え',
    ingredients: [mainIngredient('にんじん')],
    steps: [cookingStepOf('和える')],
    ...overrides,
  });
}

/**
 * 期限が1日ずつずれた在庫4件。下の `cookableMealsForStaggeredExpiryStockItems` と組にすると、C-12 の順が
 * A→B→C→D に閉じる（既存の「作れる献立が4件あるとき」と同じ組み合わせ）。
 */
function staggeredExpiryStockItems(): StockItemDto[] {
  return [
    stockItem({ name: '豚肉', expiryDate: '2026-09-15' }),
    stockItem({ name: 'にんじん', expiryDate: '2026-09-16' }),
    stockItem({ name: 'たまねぎ', expiryDate: '2026-09-17' }),
    stockItem({ name: 'じゃがいも', expiryDate: '2026-09-18' }),
  ];
}

/** 上の在庫で作れる献立4件。並びは C-12 の順とわざと違えてある（先頭が C）。 */
function cookableMealsForStaggeredExpiryStockItems(): Meal[] {
  return [
    meal({ id: mealIdOf(idC), title: '肉じゃが', ingredients: [mainIngredient('たまねぎ')] }),
    meal({ id: mealIdOf(idA), title: '生姜焼き', ingredients: [mainIngredient('豚肉')] }),
    meal({ id: mealIdOf(idD), title: 'ポトフ', ingredients: [mainIngredient('じゃがいも')] }),
    meal({ id: mealIdOf(idB), title: 'きんぴら', ingredients: [mainIngredient('にんじん')] }),
  ];
}

/** 本題が提案の識別子でないときの採番。発行器が出す `suggestionId` と別の値にしてある。 */
let suggestionSequence = 0;
function nextSuggestionId() {
  suggestionSequence += 1;
  return `66666666-6666-4666-8666-${String(suggestionSequence).padStart(12, '0')}`;
}

/**
 * 事前に置いておく提案1回ぶん。除外に効くのは `entries` の献立の識別子だけなので、
 * **在庫スナップショットの既定は空である**（C-11 / 規則7）。
 *
 * **C-7 の比較が本題の回だけ `pantrySnapshot` を渡す。** 既定を空のままにしてあるのは、
 * 在庫が1件以上あるテストが意図せず短絡を通らないようにするためである（B-28 設計書 11章）。
 */
function storedSuggestion(props: {
  mealIds: readonly string[];
  householdId?: HouseholdId;
  origin?: SuggestionEntryOrigin;
  generatedAt?: string;
  pantrySnapshot?: readonly StockItem[];
}): Suggestion {
  return createSuggestion({
    id: suggestionIdOf(nextSuggestionId()),
    householdId: props.householdId ?? ourHousehold,
    entries: props.mealIds.map((mealId) =>
      createSuggestionEntry({ mealId: mealIdOf(mealId), origin: props.origin ?? 'reused' }),
    ),
    pantrySnapshot: createPantrySnapshot({ stockItems: props.pantrySnapshot ?? [] }),
    generatedAt: dateTimeOf(props.generatedAt ?? '2026-09-13T12:00:00Z'),
  });
}

/**
 * 生成の由来を持つ提案を `count` 回ぶん置く（ADR-049 決定1 / NFR-C2）。**上限の数に入るのは
 * これだけである** — 再利用だけで組めた提案（C-14 が保存させる回）は数に入らない。
 *
 * 生成日時の既定は基準日時の1時間前で、24時間の窓の内側である（決定2。基準日時は
 * `2026-09-14T03:00:00Z` なので、窓の下端は `2026-09-13T03:00:00Z`）。
 *
 * 並べる献立は `idA` に揃えてある。**上限の回は献立を1件も置かないので**（`meals: []`）、
 * C-11 の除外にも C-7 の比較にも効かない。
 */
function storedGeneratedSuggestions(
  count: number,
  generatedAt = '2026-09-14T02:00:00Z',
): Suggestion[] {
  return Array.from({ length: count }, () =>
    storedSuggestion({ mealIds: [idA], origin: 'generated', generatedAt }),
  );
}

/** 本題でない値を隠して献立を作る。既定は我が家の、主材料1件・手順1件・調理記録なし。 */
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
 * その在庫では作れない献立。主材料を**在庫に置かない `豚肉`** に揃えてあるので、再利用で
 * 採られることがない（B-28 規則2 / C-10）。生成に渡す入力が本題の回は、再利用が0件のまま
 * 生成へ回ることが前提である。
 */
function uncookableMeal(props: {
  id: string;
  title: string;
  generatedAt?: string;
  householdId?: HouseholdId;
}): Meal {
  return meal({
    id: mealIdOf(props.id),
    householdId: props.householdId ?? ourHousehold,
    title: props.title,
    ingredients: [mainIngredient('豚肉')],
    generatedAt: dateTimeOf(props.generatedAt ?? '2026-09-13T12:00:00Z'),
  });
}

/** 番号から作る献立の識別子。上の3つ（A〜D）とは別の並びに置いてある。 */
function numberedMealId(ordinal: number): string {
  return `77777777-7777-4777-8777-${String(ordinal).padStart(12, '0')}`;
}

/**
 * 名称も生成日時も異なる献立を `count` 件作る。**`maxAvoidTitles` の確認に使う**
 * （B-28 規則8 / prompt-design D-6・論点4）。
 *
 * `献立01` が最も新しく、番号が1つ増えるごとに生成日時が1分だけ古くなる。上限で落ちるのが
 * 古いほうであることを、名称の番号だけで読めるようにするためである。どれも `uncookableMeal`
 * なので、件数が増えても再利用の経路には載らない。
 */
function mealsWithDistinctTitlesAndGeneratedAt(count: number): Meal[] {
  return Array.from({ length: count }, (_, index) =>
    uncookableMeal({
      id: numberedMealId(index + 1),
      title: `献立${String(index + 1).padStart(2, '0')}`,
      generatedAt: `2026-09-13T12:${String(59 - index).padStart(2, '0')}:00Z`,
    }),
  );
}

/**
 * 記憶上の実装で結線し、ユースケースを1つ作る。テストの本題でない結線をここに隠す
 * （`docs/testing.md` 6章）。前提の献立も前提の提案も**登録や提案の経路を通さず
 * リポジトリへ直接置く。**
 *
 * **在庫は世帯で分けられない。** 在庫の一覧の代役は決まった出力を返すものなので、
 * 渡した在庫がそのまま我が家の在庫になる（#17 の注）。**前提の提案は世帯で分けられる** —
 * 提案自身が世帯を持つためである（C-9）。
 *
 * **返す `mealGenerator` を見てよいのは「呼ばないこと」が要件の回だけである**（C-7 / C-15 /
 * `docs/testing.md` 2章・3章）。それ以外の回数は実装の都合であり、数えない。
 *
 * **既定は「生成結果0件」と「発行できる献立の識別子0件」である。** 生成器は0件なら
 * `mealGenerator.empty` を投げ、発行器は尽きれば投げる。再利用で組めるはずの回に生成へ
 * 回ったり識別子を発行したりすれば、そのテストがその場で落ちる（C-15 / `docs/testing.md` 2章）。
 *
 * **生成結果の確かめの既定は全部残す**（B-78 8章）。`generatedMeals` は「どの回も同じ結果」で
 * あり、3件未満なら作り直しも同じものを返す — 1回目に残した名称と同じなので全部落ち
 * （B-78 規則11）、確かめが本題でないテストの提案の中身は変わらない。回ごとに変えるときは
 * `generatedMealsByCall` を渡す（渡せば `generatedMeals` は読まない）。
 */
function setUp(
  props: {
    stockItems?: readonly StockItemDto[];
    meals?: readonly Meal[];
    recentSuggestions?: readonly Suggestion[];
    generatedMeals?: readonly GeneratedMeal[];
    generatedMealsByCall?: readonly MealGenerationOutcome[];
    droppedTitles?: readonly string[];
    mealIdsToIssue?: readonly string[];
    mealSaveFailure?: SaveFailure;
    suggestionIdsToIssue?: readonly string[];
    listStockItemsThrows?: Error;
    findRecentThrows?: Error;
    findLatestThrows?: Error;
  } = {},
) {
  const listStockItems = new FixedListStockItems(
    props.listStockItemsThrows === undefined
      ? { returns: { stockItems: [...(props.stockItems ?? [])] } }
      : { throws: props.listStockItemsThrows },
  );
  const mealRepository =
    props.mealSaveFailure === undefined
      ? new InMemoryMealRepository(...(props.meals ?? []))
      : InMemoryMealRepository.withSaveFailure(props.mealSaveFailure, ...(props.meals ?? []));
  const suggestionRepository = new InMemorySuggestionRepository({
    ...(props.findRecentThrows === undefined ? {} : { findRecentThrows: props.findRecentThrows }),
    ...(props.findLatestThrows === undefined ? {} : { findLatestThrows: props.findLatestThrows }),
  });
  // 前提の提案は**`suggest` を通さずリポジトリへ直接積む。** 1回の呼び出しでは生成日時も
  // 提案の識別子も1つしか作れず、直近3回より前の提案を置けないためである（C-11）。
  // 記憶上の実装は配列へ積むだけなので、待たずとも積み終わっている。
  for (const suggestion of props.recentSuggestions ?? []) {
    void suggestionRepository.save(suggestion.householdId, suggestion);
  }
  const mealGenerator =
    props.generatedMealsByCall === undefined
      ? new FixedMealGenerator(...(props.generatedMeals ?? []))
      : FixedMealGenerator.byCall(...props.generatedMealsByCall);
  const generatedMealChecker = new FixedGeneratedMealChecker({
    droppedTitles: props.droppedTitles ?? [],
  });
  // **2つの入口を同じ結線から作る**（B-32）。既定の提案と明示操作は同じ依存を見ており、
  // 片方だけ別の記憶上の実装に繋ぐと、同じ前提の下で振る舞いを比べられなくなる。
  // **識別子の発行器も1つずつである** — 明示操作を2度呼ぶ回（上限の数に入ることを見る回）が、
  // 用意した識別子を順に使い切ることまで含めて1つの前提になる。
  const deps = {
    listStockItems: listStockItems.list,
    mealRepository,
    suggestionRepository,
    mealGenerator,
    generatedMealChecker,
    generateMealId: fixedMealIdGenerator(props.mealIdsToIssue ?? []),
    generateSuggestionId: fixedSuggestionIdGenerator(props.suggestionIdsToIssue ?? [suggestionId]),
  };
  const suggest = suggestMeals(deps);
  const suggestNew = suggestNewMeals(deps);

  return {
    mealRepository,
    suggestionRepository,
    mealGenerator,
    generatedMealChecker,
    suggest,
    suggestNew,
  };
}

/**
 * 結末から提案を取り出す。**提案を返した結末でなければ、その場で落ちる**（B-31b 規則1）。
 *
 * 判別子を `as` で潰して素通しにしない — そうすると、結末を直に見る3件を除くどこでも
 * `outcome` が検査されなくなる。ここで断つことで、中身を読む既存の it が同時に
 * 「提案を返す回であること」の見張りも兼ねる。
 */
function suggestionOf(output: SuggestMealsOutput): SuggestionOutput {
  if (output.outcome !== 'suggested') {
    throw new Error(`提案を返した結末ではない: ${String(output.outcome)}`);
  }

  return output.suggestion;
}

/** 返した提案が並べる献立の識別子。並びが本題なので集合にしない。 */
const mealIdsOf = (output: SuggestMealsOutput) =>
  suggestionOf(output).entries.map((entry) => entry.mealId);

describe('献立を提案する SuggestMeals', () => {
  it('再利用だけで組んだ回の結末は、提案を返したことを名乗る', async () => {
    // B-31b 規則1・2 / FR-34 / C-15 / screen-design S-1: 結末は判別できる1つの戻り値で返す。
    // 投げも `null` も使わないので、呼び出し側は `outcome` だけを見て分岐できる。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(output.outcome).toBe('suggested');
  });

  it('在庫で作れる献立が1件あれば、その1件を再利用した提案を返す', async () => {
    // FR-34 / FR-16 / 規則9: 在庫で作れる既存の献立をそのまま並べる。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA]);
  });

  it('在庫に無い主材料を含む献立は、提案に入らない', async () => {
    // C-10 / 規則2: 再利用の対象は不足0件のものだけ。「ほぼ作れる」は使わない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [
        meal({ id: mealIdOf(idA), title: '肉じゃが', ingredients: [mainIngredient('にんじん')] }),
        meal({ id: mealIdOf(idB), title: '生姜焼き', ingredients: [mainIngredient('豚肉')] }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA]);
  });

  it('提案の1件は、献立リポジトリが返した順ではなく C-12 の順に並ぶ', async () => {
    // C-12 / ADR-036 決定4 / 規則6(a): 期限の近い在庫を使う献立が上に来る。
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん', expiryDate: '2026-09-20' }),
        stockItem({ name: '豚肉', expiryDate: '2026-09-15' }),
      ],
      meals: [
        meal({ id: mealIdOf(idA), title: '肉じゃが', ingredients: [mainIngredient('にんじん')] }),
        meal({ id: mealIdOf(idB), title: '生姜焼き', ingredients: [mainIngredient('豚肉')] }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idB, idA]);
  });

  it('作れる献立が4件あるときは、C-12 の順で上位3件だけを採る', async () => {
    // FR-16 / C-15 / 規則6(c)・10: 上限は3件。切るのはこのユースケースである。
    const cookableMeals = [
      meal({ id: mealIdOf(idC), title: '肉じゃが', ingredients: [mainIngredient('たまねぎ')] }),
      meal({ id: mealIdOf(idA), title: '生姜焼き', ingredients: [mainIngredient('豚肉')] }),
      meal({ id: mealIdOf(idD), title: 'ポトフ', ingredients: [mainIngredient('じゃがいも')] }),
      meal({ id: mealIdOf(idB), title: 'きんぴら', ingredients: [mainIngredient('にんじん')] }),
    ];
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: '豚肉', expiryDate: '2026-09-15' }),
        stockItem({ name: 'にんじん', expiryDate: '2026-09-16' }),
        stockItem({ name: 'たまねぎ', expiryDate: '2026-09-17' }),
        stockItem({ name: 'じゃがいも', expiryDate: '2026-09-18' }),
      ],
      meals: cookableMeals,
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA, idB, idC]);
  });

  it('提案の1件は、すべて由来が再利用になる', async () => {
    // FR-35 / C-15 / 規則9: 生成と混ぜない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: '豚肉' })],
      meals: [
        meal({ id: mealIdOf(idA), title: '肉じゃが', ingredients: [mainIngredient('にんじん')] }),
        meal({ id: mealIdOf(idB), title: '生姜焼き', ingredients: [mainIngredient('豚肉')] }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).entries.map((entry) => entry.origin)).toEqual(['reused', 'reused']);
  });

  it('調理記録のある献立を提案しても、提案の1件に cooked を載せない', async () => {
    // B-53b 規則3 / ADR-070 決定1: 調理記録の有無は献立詳細の出力にだけ載り、提案の JSON は変わらない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [
        meal({
          id: mealIdOf(idA),
          ingredients: [mainIngredient('にんじん')],
          cookingRecords: [createCookingRecord({ cookedAt: dateTimeOf('2026-09-12T10:00:00Z') })],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect('cooked' in (suggestionOf(output).entries[0] ?? {})).toBe(false);
  });

  it('提案の識別子は、提案の識別子発行器が出した値になる', async () => {
    // ADR-026 / 規則12: 採番はポートの仕事で、本体は乱数を読まない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      suggestionIdsToIssue: ['suggestion-1'],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).id).toBe('suggestion-1');
  });

  it('提案の生成日時は、引数の基準日時を正規化した値になる', async () => {
    // 規則12 / `docs/testing.md` 5章: 現在時刻を読まず、渡された瞬間を UTC の正準形にする。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    const output = await suggest(ourHousehold, '2026-09-14T12:00:00+09:00');

    expect(suggestionOf(output).generatedAt).toBe('2026-09-14T03:00:00.000Z');
  });

  it('再利用だけで組めた提案も保存し、同じ識別子で取り出せる', async () => {
    // C-14 / 規則11: 保存の確認は取得を通して行う（`docs/testing.md` 3章）。
    const { suggest, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    const output = await suggest(ourHousehold, asOf);

    // 取り出した側を配列のまま比べる。1件も保存されなければ `[]` になり、
    // 提案が `null` でも `[undefined]` と食い違うので、どちらも緑にならない。
    const fetched = await suggestionRepository.findRecentByHousehold(ourHousehold, 3);
    expect(fetched.map((fetchedSuggestion) => fetchedSuggestion.id)).toEqual([
      suggestionOf(output).id,
    ]);
  });

  it('保存された提案の1件は、返した出力と同じ献立を同じ並びで持つ', async () => {
    // FR-35 / C-12 / 規則16: 返すのは保存した提案を写したものである。
    const { suggest, suggestionRepository } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん', expiryDate: '2026-09-20' }),
        stockItem({ name: '豚肉', expiryDate: '2026-09-15' }),
        stockItem({ name: 'たまねぎ', expiryDate: '2026-09-17' }),
      ],
      meals: [
        meal({ id: mealIdOf(idA), title: '肉じゃが', ingredients: [mainIngredient('にんじん')] }),
        meal({ id: mealIdOf(idB), title: '生姜焼き', ingredients: [mainIngredient('豚肉')] }),
        meal({ id: mealIdOf(idC), title: 'きんぴら', ingredients: [mainIngredient('たまねぎ')] }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    // 既定値を左右でずらす。両方とも「無い」ときに緑にならないようにするためである。
    const fetched = (await suggestionRepository.findRecentByHousehold(ourHousehold, 3))[0];
    expect(fetched?.entries.map((entry) => entry.mealId)).toEqual(mealIdsOf(output) ?? []);
  });

  it('在庫スナップショットの在庫品は、名称・分量・期限だけを持つ', async () => {
    // ADR-037 決定1 / ADR-033 決定3 / 規則2: 識別子も食材の指定も献立側へ持ち込まない。
    const { suggest, suggestionRepository } = setUp({
      stockItems: [
        stockItem({
          id: '00000000-0000-4000-8000-000000009999',
          name: 'にんじん',
          ingredientId: 'ingredient-1',
          amount: '1本',
          expiryDate: '2026-09-20',
        }),
      ],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    await suggest(ourHousehold, asOf);

    const fetched = (await suggestionRepository.findRecentByHousehold(ourHousehold, 3))[0];
    expect(fetched?.pantrySnapshot.stockItems).toEqual([
      createStockItem({
        name: 'にんじん',
        amount: amountOf('1本'),
        expiryDate: expiryDateOf('2026-09-20'),
      }),
    ]);
  });

  it('分量と期限が未設定の在庫品は、未設定のまま在庫スナップショットに入る', async () => {
    // ADR-010 / 規則3: 既定値の補完をしない。未設定の表し方は `null` の1つだけである。
    const { suggest, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん', amount: null, expiryDate: null })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    await suggest(ourHousehold, asOf);

    const fetched = (await suggestionRepository.findRecentByHousehold(ourHousehold, 3))[0];
    expect(fetched?.pantrySnapshot.stockItems).toEqual([
      createStockItem({ name: 'にんじん', amount: null, expiryDate: null }),
    ]);
  });

  it('在庫の名称の前後の空白は、在庫スナップショットでは落ちている', async () => {
    // C-6 / 規則3: 正規化はドメインが持つ。ユースケースでは trim しない。
    const { suggest, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: '  にんじん  ' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    await suggest(ourHousehold, asOf);

    const fetched = (await suggestionRepository.findRecentByHousehold(ourHousehold, 3))[0];
    expect(fetched?.pantrySnapshot.stockItems.map((stockItem) => stockItem.name)).toEqual([
      'にんじん',
    ]);
  });

  it('献立の材料にない在庫品も、在庫スナップショットに入る', async () => {
    // C-7 / 規則4・13: スナップショットはその時点の在庫の複製であり、使った分だけではない。
    const { suggest, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    await suggest(ourHousehold, asOf);

    const fetched = (await suggestionRepository.findRecentByHousehold(ourHousehold, 3))[0];
    expect(fetched?.pantrySnapshot.stockItems.map((stockItem) => stockItem.name)).toEqual([
      'にんじん',
      'ヨーグルト',
    ]);
  });

  it('名称も分量も期限も同じ在庫品が2件あれば、在庫スナップショットにも2件入る', async () => {
    // C-7（多重集合）/ ADR-007 / 規則2: 同じ食材でも在庫品を統合しない。
    const { suggest, suggestionRepository } = setUp({
      stockItems: [
        stockItem({ name: 'たまご', amount: '6個', expiryDate: '2026-09-20' }),
        stockItem({ name: 'たまご', amount: '6個', expiryDate: '2026-09-20' }),
      ],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('たまご')] })],
    });

    await suggest(ourHousehold, asOf);

    const fetched = (await suggestionRepository.findRecentByHousehold(ourHousehold, 3))[0];
    expect(fetched?.pantrySnapshot.stockItems).toHaveLength(2);
  });

  it('在庫スナップショットは、在庫の一覧が返した並びのまま持つ', async () => {
    // 規則5 / B-05 規則7: このユースケースは在庫を並べ替えない。
    const { suggest, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: '豚肉' }), stockItem({ name: 'にんじん' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    await suggest(ourHousehold, asOf);

    const fetched = (await suggestionRepository.findRecentByHousehold(ourHousehold, 3))[0];
    expect(fetched?.pantrySnapshot.stockItems.map((stockItem) => stockItem.name)).toEqual([
      '豚肉',
      'にんじん',
    ]);
  });

  it('別の世帯の献立は再利用しない', async () => {
    // C-9 / 規則1: 献立の取得にも第1引数の世帯を渡す。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [
        meal({ id: mealIdOf(idA), title: '肉じゃが', ingredients: [mainIngredient('にんじん')] }),
        // 我が家の在庫で作れるが、持ち主が違う。除かれる理由は世帯だけである。
        meal({
          id: mealIdOf(idB),
          householdId: neighborHousehold,
          title: 'きんぴら',
          ingredients: [mainIngredient('にんじん')],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA]);
  });

  it('別の世帯の在庫は、作れるかどうかの判定に使わない', async () => {
    // C-9 / 規則1: 在庫の一覧にも第1引数の世帯を渡す。
    // 在庫の一覧の代役は決まった出力を返すので、隣の家の在庫を別に持たせられない。
    // **隣の家の豚肉がユースケースに届く経路が無いこと**を、豚肉でしか作れない献立B が
    // 提案に入らないことで見る。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [
        meal({ id: mealIdOf(idA), title: '肉じゃが', ingredients: [mainIngredient('にんじん')] }),
        meal({ id: mealIdOf(idB), title: '生姜焼き', ingredients: [mainIngredient('豚肉')] }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA]);
  });

  it('保存した提案は、別の世帯からは取り出せない', async () => {
    // C-9 / 規則1: 保存にも第1引数の世帯を渡す。
    const { suggest, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    await suggest(ourHousehold, asOf);

    expect(await suggestionRepository.findRecentByHousehold(neighborHousehold, 3)).toEqual([]);
  });

  it('提案を組んでも、献立リポジトリが保持している献立の並びは変わらない', async () => {
    // 規則17 / ADR-009: リポジトリが返した列をその場で並べ替えない。
    const { suggest, mealRepository } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん', expiryDate: '2026-09-20' }),
        stockItem({ name: '豚肉', expiryDate: '2026-09-15' }),
      ],
      meals: [
        meal({ id: mealIdOf(idA), title: '肉じゃが', ingredients: [mainIngredient('にんじん')] }),
        meal({ id: mealIdOf(idB), title: '生姜焼き', ingredients: [mainIngredient('豚肉')] }),
      ],
    });

    await suggest(ourHousehold, asOf);

    const storedMeals = await mealRepository.findByHousehold(ourHousehold);
    expect(storedMeals.map((storedMeal) => storedMeal.id)).toEqual([idA, idB]);
  });

  it('直近の提案に出した献立は、再利用の対象から外れる', async () => {
    // C-11 / FR-37 / 規則7: 在庫が動かない期間ずっと同じ献立が出続けないようにする。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: '豚肉' })],
      meals: [
        meal({ id: mealIdOf(idA), title: '肉じゃが', ingredients: [mainIngredient('にんじん')] }),
        meal({ id: mealIdOf(idB), title: '生姜焼き', ingredients: [mainIngredient('豚肉')] }),
      ],
      recentSuggestions: [storedSuggestion({ mealIds: [idA], origin: 'reused' })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idB]);
  });

  it('除外は由来を問わず、生成で出した献立も再利用の対象から外れる', async () => {
    // C-4c / 規則7: `origin` は経路の印であって、除外の可否を決めるものではない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: '豚肉' })],
      meals: [
        meal({ id: mealIdOf(idA), title: '肉じゃが', ingredients: [mainIngredient('にんじん')] }),
        meal({ id: mealIdOf(idB), title: '生姜焼き', ingredients: [mainIngredient('豚肉')] }),
      ],
      recentSuggestions: [storedSuggestion({ mealIds: [idA], origin: 'generated' })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idB]);
  });

  it('1回の提案が並べた献立は、その全件が除外の対象になる', async () => {
    // 規則7: 落とすのは `entries` に現れる献立すべてであり、先頭の1件だけではない。
    const { suggest } = setUp({
      stockItems: staggeredExpiryStockItems(),
      meals: cookableMealsForStaggeredExpiryStockItems(),
      recentSuggestions: [storedSuggestion({ mealIds: [idA, idB, idC] })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idD]);
  });

  it('除外してから上位3件を採るので、除外がなければ3件に入らなかった献立が繰り上がる', async () => {
    // ADR-036 決定4・結果7 / 規則6: 順は「並べる → 除外する → 切る」。先に切ると D を取り戻せない。
    const { suggest } = setUp({
      stockItems: staggeredExpiryStockItems(),
      meals: cookableMealsForStaggeredExpiryStockItems(),
      recentSuggestions: [storedSuggestion({ mealIds: [idA] })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idB, idC, idD]);
  });

  it('直近3回より前の提案に出した献立は、除外されない', async () => {
    // C-11 / 規則8: 見るのは直近3回だけ。4回前に出た D は再び再利用できる。
    // 生成日時を互いにずらすのは、直近3回の選び取りが同時刻の決着（`SuggestionId` の
    // 降順）に寄りかからないようにするためである（B-27 10章）。
    const { suggest } = setUp({
      stockItems: staggeredExpiryStockItems(),
      meals: cookableMealsForStaggeredExpiryStockItems(),
      recentSuggestions: [
        storedSuggestion({ mealIds: [idD], generatedAt: '2026-09-10T12:00:00Z' }),
        storedSuggestion({ mealIds: [idC], generatedAt: '2026-09-11T12:00:00Z' }),
        storedSuggestion({ mealIds: [idB], generatedAt: '2026-09-12T12:00:00Z' }),
        storedSuggestion({ mealIds: [idA], generatedAt: '2026-09-13T12:00:00Z' }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idD]);
  });

  it('別の世帯の提案は、除外に使わない', async () => {
    // C-9 / 規則1: 直近の提案の取得にも第1引数の世帯を渡す。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      recentSuggestions: [storedSuggestion({ householdId: neighborHousehold, mealIds: [idA] })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA]);
  });

  // ここから生成の経路（B-28 1周目）。**再利用で採れたものが0件のときに通る道**であり、
  // 以前この位置にあった「null を返す」5件は、生成へ回る経路として意味が変わったものである
  // （B-28 設計書 10章。テストが壊れたのではなく仕様が変わった）。

  it('生成の経路で組んだ回の結末も、提案を返したことを名乗る', async () => {
    // B-31b 規則1・2 / FR-16 / C-2 / screen-design S-2: 名乗りは経路で変わらない。
    // 再利用で採れたものが0件でも、生成で組み上がれば提案を返した回である。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(output.outcome).toBe('suggested');
  });

  it('在庫で作れる献立が1件も無いときは、生成した献立を並べた提案を返す', async () => {
    // B-28 規則2・16 / C-15 / NFR-C1b: 作れるものが0件でも提案を返す。組めない回を作らない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        meal({ id: mealIdOf(idB), title: '生姜焼き', ingredients: [mainIngredient('豚肉')] }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('直近の提案による除外の結果0件になったときも、生成した献立を並べた提案を返す', async () => {
    // B-28 規則2・16 / C-11 / C-15: 除外で空になった回も生成へ回る。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      recentSuggestions: [storedSuggestion({ mealIds: [idA] })],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('保持している献立が0件のときも、生成した献立を並べた提案を返す', async () => {
    // B-28 規則2・16 / C-15: 再利用できる献立がまだ1件も無い世帯は、生成だけで始まる。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('生成が1件しか返せなくても、その1件で提案を組む', async () => {
    // B-28 規則14 / C-15 / ADR-089 決定4: 求めるのは3件だが、足りない分の作り直しは1回だけで、
    // それでも満たなければ通った件数でそのまま組む。ここでは作り直しも同じ1件を返すので、
    // 1回目と同じ名称として落ちる（B-78 規則11）。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('生成が3件返したときは、3件すべてが提案に並ぶ', async () => {
    // FR-16 / C-2 / B-28 規則9: 採用した全件を並べる。採らずに捨てるものを作らない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [
        generatedMeal({ title: '肉じゃが' }),
        generatedMeal({ title: '生姜焼き' }),
        generatedMeal({ title: 'きんぴら' }),
      ],
      mealIdsToIssue: [idA, idB, idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA, idB, idC]);
  });

  it('生成が返した並びのまま提案に並び、C-12 の順に並べ替えない', async () => {
    // C-2 / B-28 規則9: 並びを決めるのは生成の側である。C-12 は再利用の並びの規則であり、
    // これに当てはめると期限の近い豚肉を使う 生姜焼き が先に来て、逆順になる。
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: '豚肉', expiryDate: '2026-09-15' }),
        stockItem({ name: 'にんじん', expiryDate: '2026-09-20' }),
      ],
      meals: [],
      generatedMeals: [
        generatedMeal({ title: 'きんぴら', ingredients: [mainIngredient('にんじん')] }),
        generatedMeal({ title: '生姜焼き', ingredients: [mainIngredient('豚肉')] }),
      ],
      mealIdsToIssue: [idA, idB],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA, idB]);
  });

  it('生成の経路で組んだ提案の1件は、すべて由来が生成になる', async () => {
    // C-4c / C-15 / FR-35 / B-28 規則13 の前半: 生成の経路の1件に再利用の印を混ぜない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal({ title: '肉じゃが' }), generatedMeal({ title: '生姜焼き' })],
      mealIdsToIssue: [idA, idB],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).entries.map((entry) => entry.origin)).toEqual([
      'generated',
      'generated',
    ]);
  });

  it('生成した献立は献立リポジトリに保存され、次の取得で見える', async () => {
    // C-1 / B-28 規則12: 変換した時点で保存する。保存の確認は取得を通して行う
    // （`docs/testing.md` 3章）。
    const { suggest, mealRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal({ title: 'ごま和え' })],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    const storedMeals = await mealRepository.findByHousehold(ourHousehold);
    expect(storedMeals.map((storedMeal) => storedMeal.title)).toEqual(['ごま和え']);
  });

  it('保存された献立の識別子は、献立の識別子発行器が出した値になる', async () => {
    // ADR-026 / B-28 規則12: 採番はポートの仕事で、本体は乱数を読まない。
    const { suggest, mealRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    const storedMeals = await mealRepository.findByHousehold(ourHousehold);
    expect(storedMeals.map((storedMeal) => storedMeal.id)).toEqual([idC]);
  });

  it('献立の識別子は、生成結果の並び順に発行される', async () => {
    // B-28 規則12 / C-12 の決定性: 発行の順が生成の並びからずれると、同じ入力でも
    // 名称と識別子の対応が回ごとに変わる。
    // **取り出した列の並びには依らず、名称と識別子の対応だけを見る** — `findByHousehold` は
    // 全件を返す口であり並び順を約束しないので、並びを断定すると振る舞いが同じまま
    // 実装の差し替えで赤くなる（CLAUDE.md の依存の規則 / `docs/testing.md` 3章）。
    const { suggest, mealRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal({ title: '肉じゃが' }), generatedMeal({ title: '生姜焼き' })],
      mealIdsToIssue: [idA, idB],
    });

    await suggest(ourHousehold, asOf);

    const storedMeals = await mealRepository.findByHousehold(ourHousehold);
    expect(
      Object.fromEntries(storedMeals.map((storedMeal) => [storedMeal.title, storedMeal.id])),
    ).toEqual({ 肉じゃが: idA, 生姜焼き: idB });
  });

  it('保存された献立は、生成結果の材料と手順をそのまま持つ', async () => {
    // C-5 / B-28 規則12: 材料は在庫品を指さず文字列として複製し、手順は並びのまま持つ。
    const { suggest, mealRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [
        generatedMeal({
          title: 'ごま和え',
          ingredients: [
            mainIngredient('にんじん'),
            mainIngredient('ほうれん草'),
            seasoning('ごま', '大さじ1'),
          ],
          steps: [cookingStepOf('ゆでる'), cookingStepOf('和える')],
        }),
      ],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    const fetched = (await mealRepository.findByHousehold(ourHousehold))[0];
    expect(fetched?.ingredients).toEqual([
      createMealIngredient({ name: 'にんじん', kind: 'main', amount: null }),
      createMealIngredient({ name: 'ほうれん草', kind: 'main', amount: null }),
      createMealIngredient({ name: 'ごま', kind: 'seasoning', amount: amountOf('大さじ1') }),
    ]);
    expect(fetched?.steps).toEqual(['ゆでる', '和える']);
  });

  it('生成の経路で保存した献立は、別の世帯からは取り出せない', async () => {
    // C-9 / B-28 規則12: 保存にも第1引数の世帯を渡し、献立にも同じ世帯を持たせる。
    const { suggest, mealRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    expect(await mealRepository.findByHousehold(neighborHousehold)).toEqual([]);
  });

  it('生成の経路で組んだ提案も保存し、同じ識別子で取り出せる', async () => {
    // C-14 / B-28 規則15: 生成でも記録に残す。残さないと C-7 と C-11 が次の回で効かない。
    const priorSuggestion = storedSuggestion({ mealIds: [idA] });
    const { suggest, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      recentSuggestions: [priorSuggestion],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    // 新しい提案のほうが生成日時が新しいので先に並ぶ。1件も保存されなければ `[]` になり、
    // どちらの側とも食い違う。
    const fetched = await suggestionRepository.findRecentByHousehold(ourHousehold, 3);
    expect(fetched.map((fetchedSuggestion) => fetchedSuggestion.id)).toEqual([
      suggestionOf(output).id,
      priorSuggestion.id,
    ]);
  });

  // ここから C-7 の短絡（B-28 2周目 / 規則1）。**在庫が最新の提案のときから変わっていなければ、
  // 直近3回の提案は引かず、献立は世帯で引く（B-48a 規則4）。提案を組まず、保存もしない。**
  // **指す献立を前提として置いておく** — 引けなければ断るため（B-48a 規則11）。比べる相手は
  // `storedSuggestion` の `pantrySnapshot` で渡す — 既定は空なので、上の it たちは
  // 在庫が1件でもあれば短絡を通らない。

  it('在庫が最新の提案のときから変わっていない回の結末も、提案を返したことを名乗る', async () => {
    // B-31b 規則1・2 / C-7 / FR-21 / screen-design S-3: 短絡して保存済みの提案を返した回も、
    // 組み直した回と同じ名乗りである。返す中身が保存済みのものであることは既存の it が持つ。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      recentSuggestions: [
        storedSuggestion({
          mealIds: [idA],
          pantrySnapshot: [
            mealStockItem({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' }),
          ],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(output.outcome).toBe('suggested');
  });

  it('在庫が最新の提案のときから変わっていなければ、保存済みの提案の識別子をそのまま返す', async () => {
    // C-7 / FR-21 / B-28 規則1: 在庫が動いていない日は作り直さない（NFR-C1）。
    const priorSuggestion = storedSuggestion({
      mealIds: [idA],
      pantrySnapshot: [
        mealStockItem({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' }),
      ],
    });
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      recentSuggestions: [priorSuggestion],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).id).toBe(priorSuggestion.id);
  });

  it('在庫が変わっていなければ、作れる献立があっても保存済みの提案が並べた献立を返す', async () => {
    // FR-21 / C-7 / B-28 規則1: 短絡は再利用より先である。組み直すと、同じ在庫の日に
    // 違う献立（識別子A）が出て、画面の見え方が日によって変わる（screen-design S-3）。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [
        meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] }),
        uncookableMeal({ id: idD, title: 'きんぴら' }),
      ],
      recentSuggestions: [
        storedSuggestion({
          mealIds: [idD],
          pantrySnapshot: [mealStockItem({ name: 'にんじん' })],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idD]);
  });

  it('在庫が変わっていなければ、返す生成日時は保存済みの提案のもので、引数の基準日時ではない', async () => {
    // FR-21 / C-7: 返すのは新しく組んだ提案ではないので、生成日時も保存済みのままである。
    // 基準日時を正準化すると '2026-09-14T03:00:00.000Z' になり、取り違えれば食い違う。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      recentSuggestions: [
        storedSuggestion({
          mealIds: [idA],
          generatedAt: '2026-09-13T12:00:00Z',
          pantrySnapshot: [
            mealStockItem({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' }),
          ],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).generatedAt).toBe('2026-09-13T12:00:00.000Z');
  });

  it('在庫が変わっていなければ、保存済みの提案の由来をそのまま返す', async () => {
    // FR-35 / C-4c / screen-design S-3: 印は保存済みの提案が持つものであり、短絡した回に
    // 生成の印（`'generated'`）を被せない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      recentSuggestions: [
        storedSuggestion({
          mealIds: [idA],
          origin: 'reused',
          pantrySnapshot: [
            mealStockItem({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' }),
          ],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).entries.map((entry) => entry.origin)).toEqual(['reused']);
  });

  it('在庫が変わっていなければ、献立生成器を呼ばない', async () => {
    // C-7 / NFR-C1 / `docs/testing.md` 2章: 呼ばれないこと自体が要件なので、記憶上の実装の
    // **状態**として見る（`vi.fn()` を使わない）。**生成結果と発行する献立の識別子をわざと
    // 用意してある** — 既定の0件のままだと、誤って呼ばれた回が `mealGenerator.empty` で
    // 落ち、回数ではない理由で赤くなる。
    // **在庫と在庫スナップショットを2件ずつにしてあるのは、短絡が生成の門（B-31b 規則7）より
    // 上にあることを見るためである** — 1件に戻すと、短絡しなくても下限で引き返して呼ばれず、
    // C-7 の番人が務まらない。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      recentSuggestions: [
        storedSuggestion({
          mealIds: [idA],
          pantrySnapshot: [
            mealStockItem({ name: 'にんじん' }),
            mealStockItem({ name: 'ヨーグルト' }),
          ],
        }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.callCount).toBe(0);
  });

  it('在庫が変わっていなければ、新しい提案を保存しない', async () => {
    // C-7 / C-11: 短絡した回を記録に残すと、次の回の除外が1回ぶん狂う。
    // **在庫と在庫スナップショットを2件ずつにしてあるのは、1つ上の it と同じ理由である**
    // （B-31b 規則7）— 1件に戻すと、短絡しなくても下限で引き返して保存されない。
    const priorSuggestion = storedSuggestion({
      mealIds: [idA],
      pantrySnapshot: [mealStockItem({ name: 'にんじん' }), mealStockItem({ name: 'ヨーグルト' })],
    });
    const { suggest, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      recentSuggestions: [priorSuggestion],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    const fetched = await suggestionRepository.findRecentByHousehold(ourHousehold, 3);
    expect(fetched.map((fetchedSuggestion) => fetchedSuggestion.id)).toEqual([priorSuggestion.id]);
  });

  it('在庫が1件増えていれば短絡せず、新しく組んだ提案を返す', async () => {
    // C-7 / B-28 規則1: 一致しないときは再利用の経路へ進む。返る識別子は発行器が出した値で、
    // 保存済みの提案のものではない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: '豚肉' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      recentSuggestions: [
        storedSuggestion({
          mealIds: [idD],
          pantrySnapshot: [mealStockItem({ name: 'にんじん' })],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).id).toBe(suggestionId);
  });

  it('名称も分量も期限も同じ在庫品が1件から2件に増えた日は、短絡しない', async () => {
    // C-7（多重集合）/ ADR-037 決定2: 一致は3つ組の多重集合で見る。集合に畳むと、
    // 同じたまごをもう1パック足した日に「在庫は変わっていない」と判定してしまう。
    const egg = { name: 'たまご', amount: '6個', expiryDate: '2026-09-20' };
    const { suggest } = setUp({
      stockItems: [stockItem(egg), stockItem(egg)],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('たまご')] })],
      recentSuggestions: [
        storedSuggestion({
          mealIds: [idD],
          pantrySnapshot: [mealStockItem(egg)],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).id).toBe(suggestionId);
  });

  it('2件前の提案の在庫と一致しても、短絡しない', async () => {
    // C-7: 見るのは最新の1件だけである。生成日時をずらして「最新」を一意にしてある。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      recentSuggestions: [
        storedSuggestion({
          mealIds: [idD],
          generatedAt: '2026-09-12T12:00:00Z',
          pantrySnapshot: [mealStockItem({ name: 'にんじん' })],
        }),
        storedSuggestion({
          mealIds: [idD],
          generatedAt: '2026-09-13T12:00:00Z',
          pantrySnapshot: [mealStockItem({ name: '豚肉' })],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).id).toBe(suggestionId);
  });

  it('別の世帯の最新の提案は、在庫が変わったかどうかの判定に使わない', async () => {
    // C-9: 最新の提案の取得にも第1引数の世帯を渡す。我が家の提案は1件も無いので、
    // 比べる相手が無く、再利用の経路へ進む。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      recentSuggestions: [
        storedSuggestion({
          householdId: neighborHousehold,
          mealIds: [idD],
          pantrySnapshot: [mealStockItem({ name: 'にんじん' })],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA]);
  });

  it('在庫も最新の提案の在庫スナップショットも0件なら、保存済みの提案をそのまま返す', async () => {
    // C-7 / 境界: 0件どうしも「変わっていない」である。件数が0の回だけ別扱いにしない。
    const priorSuggestion = storedSuggestion({ mealIds: [idA], pantrySnapshot: [] });
    const { suggest } = setUp({
      stockItems: [],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      recentSuggestions: [priorSuggestion],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).id).toBe(priorSuggestion.id);
  });

  // C-15（B-28 2周目 / 規則2）。**再利用が成立した回に生成を呼ばない**こと自体が要件である。

  it('在庫で作れる献立が1件でもあれば、献立生成器を呼ばない', async () => {
    // C-15 / FR-34 / NFR-C1b / `docs/testing.md` 2章: 足りない分を生成で埋めない。
    // **生成結果と発行する献立の識別子をわざと用意してある** — 既定の0件のままだと、
    // 誤って呼ばれた回が `mealGenerator.empty` で落ち、回数ではない理由で赤くなる。
    // **在庫を2件置いてあるのは、生成の門（B-31b 規則7）を通すためである** — 1件に戻すと、
    // 再利用が成立しなくても下限で引き返して呼ばれず、C-15 の番人が務まらない。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.callCount).toBe(0);
  });

  it('生成が1件も返せないときは、規則違反がそのまま呼び出し側へ伝わる', async () => {
    // B-28 7章1行目 / NFR-07: ポートが投げた違反を写さずそのまま伝える。
    // 既定の生成器は用意した生成結果が0件なので `mealGenerator.empty` を投げる。
    // **在庫を2件置いてあるのは、生成の門（B-31b 規則7）を通すためである** — 1件に戻すと
    // 生成へ回らず、投げるところまで届かない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
    });

    const execution = suggest(ourHousehold, asOf);

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'mealGenerator.empty' });
  });

  it('生成が1件も返せなかったときは、提案を保存しない', async () => {
    // C-14 の裏 / B-28 7章1行目: 組めなかった回を記録に残すと C-11 の除外が1回ぶん狂う。
    // **在庫を2件置いてあるのは、生成の門（B-31b 規則7）を通すためである** — 1件に戻すと
    // 生成へ回らず、「生成が返せなかったから保存しない」を確かめたことにならない。
    const { suggest, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
    });

    // 投げること自体は1つ上の it が見る。ここで受けるのは、未処理の拒否にしないためである。
    await suggest(ourHousehold, asOf).catch(() => undefined);

    expect(await suggestionRepository.findRecentByHousehold(ourHousehold, 3)).toEqual([]);
  });

  it('献立の保存が途中で失敗したときは、提案を保存しない', async () => {
    // C-1 / C-14 の裏 / B-28 7章4行目: 保存に失敗した献立は提示しない。提案を先に保存すると、
    // 取り出せない献立を指す記録が残り、次の回の除外（C-11）も比較（C-7）もそれを引きずる。
    // **在庫を2件置いてあるのは、生成の門（B-31b 規則7）を通すためである** — 1件に戻すと
    // 生成へ回らず、献立の保存が1度も起きないまま緑になる。
    const { suggest, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal({ title: '肉じゃが' }), generatedMeal({ title: '生姜焼き' })],
      mealIdsToIssue: [idA, idB],
      mealSaveFailure: {
        onSaveNumber: 2,
        throws: new Error('献立の保存が落ちた'),
      },
    });

    // 呼び出しが失敗すること自体は前提である。ここで受けるのは、未処理の拒否にしないためである。
    await suggest(ourHousehold, asOf).catch(() => undefined);

    expect(await suggestionRepository.findRecentByHousehold(ourHousehold, 3)).toEqual([]);
  });

  it('在庫の一覧が投げた例外は、写さずそのまま呼び出し側へ伝える', async () => {
    // 7章2行目 / ADR-033: 握りつぶさない。HTTP への写像は api の周の仕事である。
    const preparedError = new Error('在庫の一覧が落ちた');
    const { suggest } = setUp({ listStockItemsThrows: preparedError });

    const execution = suggest(ourHousehold, asOf);

    await expect(execution).rejects.toBe(preparedError);
  });

  it('直近の提案の取得が投げた例外は、握りつぶさず呼び出し側へ伝える', async () => {
    // 7章2行目 / C-11: 除外に使う記録が引けないとき、除外なしの提案で埋め合わせない。
    const preparedError = new Error('直近の提案の取得が落ちた');
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      findRecentThrows: preparedError,
    });

    const execution = suggest(ourHousehold, asOf);

    await expect(execution).rejects.toBe(preparedError);
  });

  it('最新の提案の取得が投げた例外は、握りつぶさず呼び出し側へ伝える', async () => {
    // B-28 7章2行目 / C-7: 比べる相手が引けないとき、比較なしの提案で埋め合わせない。
    // **投げる口を `findRecentThrows` と分けてある** — 1つにまとめると、上の it が
    // 短絡の手前で投げた例外を見ることになり、`findRecentByHousehold`（C-11 の除外の材料）の
    // 伝播を確かめなくなる（記憶上の提案リポジトリの注）。
    const preparedError = new Error('最新の提案の取得が落ちた');
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      findLatestThrows: preparedError,
    });

    const execution = suggest(ourHousehold, asOf);

    await expect(execution).rejects.toBe(preparedError);
  });

  it('名称が空白だけの在庫品があれば、ドメインの規則違反がそのまま出る', async () => {
    // 7章3行目 / 規則3: 正規化も判定もドメインが持つ。写す側で握って黙って落とさない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: '   ' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    const execution = suggest(ourHousehold, asOf);

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'stockItem.name.empty' });
  });

  it('期限の書式が YYYY-MM-DD でない在庫品があれば、ドメインの規則違反がそのまま出る', async () => {
    // 7章3行目 / 規則3: 書式の判定もドメインが持つ。写す側で直さない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん', expiryDate: '2026/09/20' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    const execution = suggest(ourHousehold, asOf);

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'expiryDate.format' });
  });

  // ここから生成に渡す入力（B-28 3周目 / 規則3〜8）。**観察するのは記憶上の献立生成器が
  // 状態として持つ `receivedInput` である** — 渡したものは出口の向こうへ行ってしまい、
  // 呼び出しの返り値からは見えない。`vi.fn()` は使わない（`docs/testing.md` 2章）。
  //
  // どの回も**在庫を1件以上**置き、**保持している献立はその在庫では作れない**ものにしてある。
  // 前者は C-7 の短絡を通らないため、後者は再利用が0件のまま生成へ回るためである
  // （B-28 設計書 11章）。生成結果の名称は保持している献立と重ねない — 名称の完全一致で
  // 既存を参照する規則10 は次の周のものであり、重ねるとその未実装に寄りかかる。

  it('保持している献立の名称を、避けるべき名称として生成に渡す', async () => {
    // FR-42 / ADR-021 / B-28 規則6: 同じ献立をもう一度作らせないための材料を渡す。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.avoidTitles).toEqual(['肉じゃが']);
  });

  it('生成に求める件数は3件である', async () => {
    // B-28 規則3 / ADR-022 / prompt-design 2.1: 1回の提案で並べる上限とは別の定数である。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.requiredCount).toBe(3);
  });

  it('生成に渡す在庫スナップショットは、献立に使う在庫品の全件を持つ', async () => {
    // B-28 規則4 / ADR-037 決定1: 渡すのはその時点の在庫の複製であり、使う分だけではない。
    const { suggest, mealGenerator } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' }),
        stockItem({ name: 'ヨーグルト' }),
      ],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.pantrySnapshot.stockItems).toEqual([
      mealStockItem({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' }),
      mealStockItem({ name: 'ヨーグルト' }),
    ]);
  });

  it('生成に渡した在庫スナップショットは、保存された提案が抱えるものと同じ内容である', async () => {
    // B-28 規則4 / ADR-037 決定1: 同じ在庫から2種類を組まない。組むと、生成の材料にした在庫と
    // 記録に残る在庫がずれ、次の回の C-7 の比較が別のものを見る。
    const { suggest, mealGenerator, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    // 件数も併せて断る。どちらも「無い」ときに緑にならないようにするためである。
    const fetched = (await suggestionRepository.findRecentByHousehold(ourHousehold, 3))[0];
    expect(mealGenerator.receivedInput?.pantrySnapshot.stockItems).toEqual(
      fetched?.pantrySnapshot.stockItems,
    );
    expect(mealGenerator.receivedInput?.pantrySnapshot.stockItems).toHaveLength(2);
  });

  it('生成に渡す基準日時は、引数を UTC の正準形にした値になる', async () => {
    // B-28 規則5 / `docs/testing.md` 5章: 現在時刻を読まず、渡された瞬間を正準化して渡す。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, '2026-09-14T12:00:00+09:00');

    expect(mealGenerator.receivedInput?.asOf).toBe('2026-09-14T03:00:00.000Z');
  });

  it('生成した献立の生成日時は、生成に渡した基準日時と同じ値になる', async () => {
    // B-28 規則5 / C-1: 正準化は1度きりで、生成の入力にも新しい献立にも同じ値を使う。
    const { suggest, mealRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, '2026-09-14T12:00:00+09:00');

    const fetched = (await mealRepository.findByHousehold(ourHousehold))[0];
    expect(fetched?.generatedAt).toBe('2026-09-14T03:00:00.000Z');
  });

  it('生成の経路で組んだ提案の生成日時も、同じ値になる', async () => {
    // B-28 規則5・15: 提案の生成日時も同じ1本から取る。経路で作り分けない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    const output = await suggest(ourHousehold, '2026-09-14T12:00:00+09:00');

    expect(suggestionOf(output).generatedAt).toBe('2026-09-14T03:00:00.000Z');
  });

  it('避けるべき名称の先頭は、直前の提案に並んだ献立の名称である', async () => {
    // B-28 規則6 / FR-42 / prompt-design D-6: 直前に見たものを最も強く避ける。先頭に来るのは
    // 最新の提案が並べた きんぴら で、その後ろに保持している献立が新しい順で続く。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        uncookableMeal({ id: idA, title: '肉じゃが', generatedAt: '2026-09-13T12:00:00Z' }),
        uncookableMeal({ id: idB, title: '生姜焼き', generatedAt: '2026-09-12T12:00:00Z' }),
        uncookableMeal({ id: idC, title: 'きんぴら', generatedAt: '2026-09-11T12:00:00Z' }),
      ],
      recentSuggestions: [
        storedSuggestion({ mealIds: [idC], generatedAt: '2026-09-13T12:00:00Z' }),
        storedSuggestion({ mealIds: [idB], generatedAt: '2026-09-12T12:00:00Z' }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.avoidTitles).toEqual(['きんぴら', '肉じゃが', '生姜焼き']);
  });

  it('直前の提案が2件並べていたときは、その提案の並びのまま先頭に来る', async () => {
    // B-28 規則6 / C-12: 先頭の並びは提案の1件の並びそのままで、名称順に並べ替えない。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        uncookableMeal({ id: idA, title: '肉じゃが', generatedAt: '2026-09-13T12:00:00Z' }),
        uncookableMeal({ id: idB, title: '生姜焼き', generatedAt: '2026-09-12T12:00:00Z' }),
        uncookableMeal({ id: idC, title: 'きんぴら', generatedAt: '2026-09-11T12:00:00Z' }),
      ],
      recentSuggestions: [storedSuggestion({ mealIds: [idC, idB] })],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.avoidTitles).toEqual(['きんぴら', '生姜焼き', '肉じゃが']);
  });

  it('直前の提案が無いときは、保持している献立の名称が生成日時の新しい順に並ぶ', async () => {
    // B-28 規則6 / ADR-038 決定1: 蓄積の側の並びは生成日時の新しい順である。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        uncookableMeal({ id: idA, title: '肉じゃが', generatedAt: '2026-09-13T12:00:00Z' }),
        uncookableMeal({ id: idB, title: '生姜焼き', generatedAt: '2026-09-12T12:00:00Z' }),
        uncookableMeal({ id: idC, title: 'きんぴら', generatedAt: '2026-09-11T12:00:00Z' }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.avoidTitles).toEqual(['肉じゃが', '生姜焼き', 'きんぴら']);
  });

  it('生成日時が同じ献立は、献立の識別子の降順で並ぶ', async () => {
    // B-28 規則6 / ADR-038 決定2 / C-12: 同時刻の決着をつけないと、同じ入力で並びが変わる。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        uncookableMeal({ id: idA, title: '肉じゃが', generatedAt: '2026-09-13T12:00:00Z' }),
        uncookableMeal({ id: idB, title: '生姜焼き', generatedAt: '2026-09-13T12:00:00Z' }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.avoidTitles).toEqual(['生姜焼き', '肉じゃが']);
  });

  it('保持している献立が1件も無ければ、避けるべき名称は空のまま渡す', async () => {
    // B-28 規則6 の境界 / ADR-021: 避ける対象が無い回に、空でない何かを作らない。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.avoidTitles).toEqual([]);
  });

  it('別の世帯の献立の名称は、生成に渡す避けるべき名称に入らない', async () => {
    // C-9 / NFR-11: 外へ出すものに他の世帯のものを混ぜない。献立の取得に渡す世帯は
    // 第1引数のものである。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        uncookableMeal({ id: idA, title: '肉じゃが' }),
        uncookableMeal({ id: idB, title: '生姜焼き', householdId: neighborHousehold }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.avoidTitles).toEqual(['肉じゃが']);
  });

  it('避けるべき名称を組んでも、献立リポジトリが保持している献立の並びは変わらない', async () => {
    // B-28 規則17 / ADR-009: 生成日時の新しい順に並べるために、受け取った列をその場で
    // 並べ替えない。積んだのは旧→新の順なので、並べ替えれば取り出す順が入れ替わる。
    const { suggest, mealRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        uncookableMeal({ id: idA, title: '肉じゃが', generatedAt: '2026-09-11T12:00:00Z' }),
        uncookableMeal({ id: idB, title: '生姜焼き', generatedAt: '2026-09-13T12:00:00Z' }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    const storedMeals = await mealRepository.findByHousehold(ourHousehold);
    expect(storedMeals.map((storedMeal) => storedMeal.id)).toEqual([idA, idB, idC]);
  });

  it('直前の提案が指す献立を保持していないときは、その1件を落として残りを渡す', async () => {
    // B-28 規則7 / ADR-021 結果1 / ADR-008: 提案は識別子しか持たないので、名称は保持している
    // 献立から引く。引けないものは避けようがないので黙って落とす。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      recentSuggestions: [storedSuggestion({ mealIds: [idD, idA] })],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    // 空文字も `undefined` も混ざらない。落ちるのは引けなかった1件だけである。
    expect(mealGenerator.receivedInput?.avoidTitles).toEqual(['肉じゃが']);
  });

  it('直前の提案が指す献立を1件も引けなくても、投げずに提案を返す', async () => {
    // B-28 規則7 / ADR-008: 避ける対象が引けないのは失敗ではない。避ける対象は努力目標であり、
    // 1件も組めなくても生成は成り立つ。**投げないことは、その先の断定が通ることで見る。**
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      recentSuggestions: [storedSuggestion({ mealIds: [idD] })],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('同じ名称の献立が2件保持されていても、避けるべき名称は1件になる', async () => {
    // B-28 規則8 / ADR-021 結果2: 同じ名称を2度送っても避ける効果は増えず、費用だけが増える。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        uncookableMeal({ id: idA, title: '肉じゃが', generatedAt: '2026-09-13T12:00:00Z' }),
        uncookableMeal({ id: idB, title: '肉じゃが', generatedAt: '2026-09-12T12:00:00Z' }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.avoidTitles).toEqual(['肉じゃが']);
  });

  it('避けるべき名称が上限を超えるときは、生成日時の古いほうから落ちる', async () => {
    // B-28 規則8 / prompt-design D-6・論点4: 上限は費用の上限である。落ちるのは古いほうで、
    // 51件目の `献立51` が落ちて50件目の `献立50` は残る。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: mealsWithDistinctTitlesAndGeneratedAt(51),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    const avoidTitles = mealGenerator.receivedInput?.avoidTitles ?? [];
    expect(avoidTitles).not.toContain('献立51');
    expect(avoidTitles).toContain('献立50');
  });

  it('直前の提案の献立名が保持している献立と重なっても、畳んでから切るので50件を渡す', async () => {
    // B-28 規則8: **畳んでから切る。** 先に切ると、重なった1件ぶん少ない49件になる。
    // 指すのは最も新しい `献立01` である — 重なりが上限の内側に来る置き方でないと、
    // 切る前でも後でも50件になり、順序の違いが見えない。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: mealsWithDistinctTitlesAndGeneratedAt(51),
      recentSuggestions: [storedSuggestion({ mealIds: [numberedMealId(1)] })],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.avoidTitles).toHaveLength(50);
  });

  it('蓄積が上限を超えても、直前の提案に並んだ献立の名称は残る', async () => {
    // FR-42 / prompt-design D-6 / B-28 規則8: 先頭が直前の提案なので、直前に見た献立は
    // 必ず残る。指すのは最も古い `献立51` で、蓄積の側だけなら上限で落ちる1件である。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: mealsWithDistinctTitlesAndGeneratedAt(51),
      recentSuggestions: [storedSuggestion({ mealIds: [numberedMealId(51)] })],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.avoidTitles[0]).toBe('献立51');
  });

  // ここから名称の完全一致（B-28 4周目 / 規則10・11 と規則13 の後半）。**生成結果の名称が
  // 保持している献立の名称と完全一致したら、新しい献立を作らずその既存の献立を参照する。
  // それでも由来は生成のままである**（C-4 / C-4c）。
  //
  // **#8 を除くどの回も**、在庫を1件以上置き、保持している献立はその在庫では作れないものに
  // してある。前者は C-7 の短絡を通らないため、後者は再利用が0件のまま生成へ回るためである
  // （B-28 設計書 11章）。#8 だけは作れる献立を C-11 で除いて0件にする。

  it('生成結果の名称が保持している献立と完全一致したら、その既存の献立の識別子が提案に並ぶ', async () => {
    // C-4 / B-28 規則10: 同じ名称の献立を二重に持たない。提案が指すのは既存の識別子である。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      generatedMeals: [generatedMeal({ title: '肉じゃが' })],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA]);
  });

  it('既存と一致した生成結果は、献立リポジトリに新しく保存されない', async () => {
    // C-4 / C-1 の裏 / B-28 規則10: 参照するだけなので、保持している献立は1件のままである。
    // 保存されていないことは取得を通して見る（`docs/testing.md` 3章）。
    const { suggest, mealRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      generatedMeals: [generatedMeal({ title: '肉じゃが' })],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    const storedMeals = await mealRepository.findByHousehold(ourHousehold);
    expect(storedMeals.map((storedMeal) => storedMeal.id)).toEqual([idA]);
  });

  it('生成結果がすべて既存の献立と一致した回も、提案の1件の由来は全件が生成になる', async () => {
    // C-4c / B-28 規則13 の後半: 既存を参照しても印は生成のままで、再利用に変えない。
    // **発行する献立の識別子を1件も用意しない** — 参照で済む1件にも識別子を発行する実装なら、
    // 発行器が尽きてその場で投げる（`docs/testing.md` 2章 と同じ、用意しないことで守る形）。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        uncookableMeal({ id: idA, title: '肉じゃが' }),
        uncookableMeal({ id: idB, title: '生姜焼き' }),
      ],
      generatedMeals: [generatedMeal({ title: '肉じゃが' }), generatedMeal({ title: '生姜焼き' })],
      mealIdsToIssue: [],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).entries.map((entry) => entry.origin)).toEqual([
      'generated',
      'generated',
    ]);
  });

  it('名称の前後に空白のある生成結果も、空白を落とした既存の献立と一致する', async () => {
    // C-6 / ADR-037 理由(3) / B-28 規則10: 前後の空白が落ちているのは `createGeneratedMeal` と
    // `createMeal` が同じ trim を1度ずつ通しているからで、突き合わせる側は再正規化しない。
    // **下の「名称の途中に空白がある生成結果」と対である** — 片側の trim が消えるとここが赤くなる。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      generatedMeals: [generatedMeal({ title: '  肉じゃが  ' })],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA]);
  });

  it('名称の途中に空白がある生成結果は、空白の無い既存の献立とは別のものとして保存される', async () => {
    // C-6 / C-4 / B-28 規則10: 突き合わせは**完全一致**であり、表記ゆれは吸収しない
    // （既知の割り切り）。**上の「名称の前後に空白のある生成結果」と対である** — 比べる前に
    // 内部の空白を詰める・小文字にする・NFKC にするといった余計な正規化を足すと、ここが赤くなる。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      generatedMeals: [generatedMeal({ title: '肉 じゃが' })],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('同じ名称の献立を2件保持しているときは、献立の識別子の昇順で先頭のものを参照する', async () => {
    // B-28 規則11 / ADR-036 決定2 / C-12: `findByHousehold` は並び順を約束しないので、
    // 識別子で閉じないと参照先が実装ごとにぶれる。**積む順は識別子の昇順と逆**にし、かつ
    // 先に積んだ 識別子B のほうを新しい生成日時にしてある — 「返った列の先頭を採る」実装も
    // 「避けるべき名称と同じ `byNewestFirst` を流用する」実装も 識別子B を指し、どちらも赤くなる。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        uncookableMeal({ id: idB, title: '肉じゃが', generatedAt: '2026-09-13T12:00:00Z' }),
        uncookableMeal({ id: idA, title: '肉じゃが', generatedAt: '2026-09-11T12:00:00Z' }),
      ],
      generatedMeals: [generatedMeal({ title: '肉じゃが' })],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA]);
  });

  it('生成3件のうち1件だけが既存と一致したときは、既存の識別子と新しい識別子が生成の並びのまま並ぶ', async () => {
    // C-2 / B-28 規則9・10・12: 並びを決めるのは生成の側であり、参照した1件もその位置に残る。
    // **用意する献立の識別子はちょうど2件**である — 新しく保存するぶんだけ発行するので、
    // 参照で済む 肉じゃが にも発行する実装なら、3件目で発行器が尽きて投げる。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      generatedMeals: [
        generatedMeal({ title: 'ごま和え' }),
        generatedMeal({ title: '肉じゃが' }),
        generatedMeal({ title: 'きんぴら' }),
      ],
      mealIdsToIssue: [idC, idD],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC, idA, idD]);
  });

  it('直近の提案で除外した献立と同じ名称を生成が返したら、その既存の献立が生成の印のまま提案に戻る', async () => {
    // **C-4b（既知の穴。塞がない）** / C-4c / B-28 規則10・13 の後半。C-11 で再利用の対象から
    // 外した献立でも、生成が同じ名称を返せば C-4 により既存が参照され、除外したはずのものが
    // 提案に戻る。`docs/domain-model.md` 7章 が「稀なので許容する」と明記した割り切りである。
    //
    // **この1件は不具合を固定しているのではなく、穴が空いたままであることの番人である。**
    // 塞ぐには生成結果を捨ててもう一度生成するほかなく、費用と待ち時間がそれに見合わない。
    // **善意で塞ぐ変更を入れるとここが赤くなる** — 赤くなったら直す前に C-4b を読み、
    // 穴を塞ぐという判断そのものを先に決めること（`docs/workflow.md` の「黙って進めない」）。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        meal({ id: mealIdOf(idA), title: '肉じゃが', ingredients: [mainIngredient('にんじん')] }),
      ],
      recentSuggestions: [storedSuggestion({ mealIds: [idA] })],
      generatedMeals: [generatedMeal({ title: '肉じゃが' })],
      mealIdsToIssue: [idD],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(
      suggestionOf(output).entries.map((entry) => ({ mealId: entry.mealId, origin: entry.origin })),
    ).toEqual([{ mealId: idA, origin: 'generated' }]);
  });

  it('別の世帯に同じ名称の献立があっても参照せず、新しい献立として保存する', async () => {
    // C-9 / B-28 規則10: 突き合わせる相手は第1引数の世帯の献立だけである。隣の家の献立を
    // 参照すると、提案が他の世帯の献立を指すことになる。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが', householdId: neighborHousehold })],
      generatedMeals: [generatedMeal({ title: '肉じゃが' })],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  // ここから在庫の下限（B-31b 2周目 / 規則3〜10）。**射影後の在庫が0〜1件のときは生成を呼ばず、
  // 在庫が足りないことを名乗る結末を返す**（prompt-design 8章 / screen-design S-4）。数えるのは
  // 期限切れを落としたあとの件数であり（ADR-040 決定2）、C-7 の短絡（規則4）と再利用（規則5）は
  // この門より先に決まる。**下限を見るのは生成を呼ぶ直前の1か所であって、経路の入口ではない**（規則3）。
  //
  // **どの回も生成結果と発行する献立の識別子をわざと用意してある** — 既定の0件のままだと、
  // 誤って生成へ回った回が `mealGenerator.empty` で落ち、「結末が違う」でも「呼ばれた」でもない
  // 理由で赤くなる（`docs/testing.md` 2章）。
  //
  // **境界の2件は暫定である**（prompt-design 9.1 P-3 の試行を待つ。8章 は「P-4」と書くが誤記）。**動かすときは、この境界を
  // 固定している5件が同時に動く** — 「在庫が1件だけの日も…」「在庫が2件あれば生成へ回り…」
  // 「在庫が2件あっても全件が期限切れの日は…」「在庫が2件あっても、期限切れを落とすと1件しか
  // 残らない日は…」「期限が基準日の当日の在庫品が2件あれば…」。
  // **そこが赤くなったら、壊れたのではなく数字が変わったのである**（`MAX_AVOID_TITLES` と同じ）。

  it('在庫が0件の日は、在庫が足りないことを名乗る結末を返す', async () => {
    // B-31b 規則1・7・10 / prompt-design 8章 / screen-design S-4: 在庫が空の日は生成の材料が
    // 足りない。失敗（S-6）でも規則違反でもないので投げず、判別できる結末として名乗る。
    // **前提の提案は置かない** — 在庫も在庫スナップショットも0件だと C-7 の短絡を通ってしまう。
    const { suggest } = setUp({
      stockItems: [],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(output.outcome).toBe('insufficientStockItems');
  });

  it('在庫が0件の日は、献立生成器を呼ばない', async () => {
    // B-31b 規則3・8 / prompt-design 8章 / `docs/testing.md` 2章: 呼ばないこと自体が要件なので、記憶上の
    // 実装の**状態**として見る（`vi.fn()` を使わない）。材料の足りない回に外へ問い合わせても、
    // 提案にならないまま費用と待ち時間だけが増える。
    const { suggest, mealGenerator } = setUp({
      stockItems: [],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.callCount).toBe(0);
  });

  it('在庫が1件だけの日も、在庫が足りないことを名乗る結末を返す', async () => {
    // B-31b 規則7（境界の下側）/ prompt-design 8章: 1件では献立を組む材料にならない。
    // 0件の回と同じ結末であり、件数で名乗りを変えない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(output.outcome).toBe('insufficientStockItems');
  });

  it('在庫が2件あれば生成へ回り、生成した献立を並べた提案を返す', async () => {
    // B-31b 規則7（境界の上側）/ prompt-design 8章: 2件からは生成へ回る。門を通ったあとの
    // 振る舞いは既存の生成の経路と同じである。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('在庫が2件あっても全件が期限切れの日は、在庫が足りないことを名乗る結末を返す', async () => {
    // B-31b 規則6・10 / ADR-040 決定2: 数えるのは期限切れを落としたあとの件数である。基準日時の
    // 暦日は 2026-09-14 なので、2026-09-13 の2件はどちらも落ちて0件になる。在庫が0件の日と
    // 同じ結末であり、「載る在庫が0件」を件数の由来で分けない。
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん', expiryDate: '2026-09-13' }),
        stockItem({ name: 'ヨーグルト', expiryDate: '2026-09-13' }),
      ],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(output.outcome).toBe('insufficientStockItems');
  });

  it('在庫が2件あっても、期限切れを落とすと1件しか残らない日は、在庫が足りないことを名乗る結末を返す', async () => {
    // B-31b 規則6・7 / ADR-040 決定1・決定2 / prompt-design 8章: 数えるのは
    // `unexpiredStockItemsOf` が返した件数であって、在庫の一覧が返した生の件数ではない。
    // **上の「全件が期限切れ」と下の「当日の2件」だけでは、生の件数が2件以上かつ期限内が
    // 1件以上で通す実装が緑のまま残る** — 射影後がちょうど1件になるこの回だけが、
    // 数えている列が射影後のものであることを断つ。
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん', expiryDate: '2026-09-13' }),
        stockItem({ name: 'ヨーグルト' }),
      ],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(output.outcome).toBe('insufficientStockItems');
  });

  it('期限が基準日の当日の在庫品が2件あれば、生成した献立を並べた提案を返す', async () => {
    // B-31b 規則6 / ADR-040 決定2 / D-2: 落とすのは基準の暦日より**前**のものだけで、当日は
    // 落とさない。期限が今日の在庫こそ使い切りたいものであり、数からも外さない。
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん', expiryDate: '2026-09-14' }),
        stockItem({ name: 'ヨーグルト', expiryDate: '2026-09-14' }),
      ],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('在庫が足りない結末の回は、提案を保存しない', async () => {
    // B-31b 規則8 / C-14 / C-11: 組まなかった回を記録に残すと、次の回の比較（C-7）も除外
    // （C-11）もその記録を引きずる。保存していないことは取得を通して見る
    // （`docs/testing.md` 3章）。`Suggestion` は1件以上しか持てないので、組めない提案は無い。
    const { suggest, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    expect(await suggestionRepository.findLatestByHousehold(ourHousehold)).toBeNull();
  });

  it('在庫が全件期限切れでも、最新の提案の在庫スナップショットと一致していれば保存済みの提案を返す', async () => {
    // B-31b 規則4 / C-7 / FR-21: C-7 の短絡は下限より先である。短絡は生成を呼ばないので下限の
    // 出番が無く、出せる提案があるのに「在庫が足りない」と告げるほうが利用者を損なう。
    const expiredCarrot = { name: 'にんじん', expiryDate: '2026-09-13' };
    const expiredYogurt = { name: 'ヨーグルト', expiryDate: '2026-09-13' };
    const priorSuggestion = storedSuggestion({
      mealIds: [idA],
      pantrySnapshot: [mealStockItem(expiredCarrot), mealStockItem(expiredYogurt)],
    });
    const { suggest } = setUp({
      stockItems: [stockItem(expiredCarrot), stockItem(expiredYogurt)],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      recentSuggestions: [priorSuggestion],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).id).toBe(priorSuggestion.id);
  });

  it('在庫が全件期限切れでも、作れる既存の献立が1件あればその献立を並べた提案を返す', async () => {
    // B-31b 規則5 / C-15 / NFR-C1b / FR-34: 再利用は下限より先である。充足の判定は期限切れの
    // 在庫品も見るので（B-31b 10章の前提）、射影後が0件でも作れる献立は残り、そちらが出る。
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん', expiryDate: '2026-09-13' }),
        stockItem({ name: 'ヨーグルト', expiryDate: '2026-09-13' }),
      ],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA]);
  });

  it('在庫が0件でも、直近の提案の取得が投げた例外はそのまま伝わる', async () => {
    // B-31b 規則3・9 / B-28 7章2行目: 下限を見るのは生成を呼ぶ直前であって経路の入口ではない
    // ので、在庫・最新の提案・献立・直近3回の提案の取得はどの回も通る。
    // **これは番人であって駆動役ではない** — 下限を取得より前に置く実装にすると、例外が
    // 出ないまま結末が返り、ここが赤くなる。
    const preparedError = new Error('直近の提案の取得が落ちた');
    const { suggest } = setUp({
      stockItems: [],
      meals: [],
      findRecentThrows: preparedError,
    });

    const execution = suggest(ourHousehold, asOf);

    await expect(execution).rejects.toBe(preparedError);
  });

  // ここから1日の生成回数の上限（B-31c / NFR-C2 / screen-design S-7 / ADR-049）。**直近24時間の
  // 生成が上限に達していたら生成を呼ばず、上限に達したことを名乗る結末を返す。** 数えるのは
  // **生成の由来を持つ保存済みの提案**であり（決定1 / C-15 / C-4c）、「1日」は**基準日時から
  // 遡る24時間の窓**である（決定2）。**門は在庫の下限の次、生成を呼ぶ直前にある**（結果6）—
  // 前に置くと、C-7 で短絡できる回も作れる既存の献立が残っている回も、出せる提案があるのに
  // 上限を告げることになる。
  //
  // **どの回も生成結果と発行する献立の識別子をわざと用意してある** — 在庫の下限の回と同じ
  // 理由である（既定の0件のままだと、誤って生成へ回った回が `mealGenerator.empty` で落ちる）。
  //
  // **上限の10回と窓の24時間は暫定ではない**（NFR-C2 の初期値と ADR-049 決定2）が、**動かすときは
  // この境界を固定している4件が同時に動く** — 「上限に達している日は…」「上限にあと1回ぶん
  // 残っていれば…」「ちょうど24時間前の生成も…」「窓より前の生成は…」。

  it('直近24時間の生成が上限に達している日は、上限に達したことを名乗る結末を返す', async () => {
    // ADR-049 決定1・決定2 / NFR-C2 / screen-design S-7: 呼ばないと決めた結果であって
    // 失敗（S-6）でも規則違反でもないので、投げずに判別できる結末として名乗る（ADR-041 決定1）。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: storedGeneratedSuggestions(10),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(output.outcome).toBe('generationLimitReached');
  });

  it('上限に達している日は、献立生成器を呼ばない', async () => {
    // NFR-C2 / `docs/testing.md` 2章: **上限の目的は呼ばないことそのものである。**
    // 呼ばないこと自体が要件なので、記憶上の実装の**状態**として見る（`vi.fn()` を使わない）。
    const { suggest, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: storedGeneratedSuggestions(10),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.callCount).toBe(0);
  });

  it('上限に達した結末の回は、提案を保存しない', async () => {
    // ADR-049 決定1 / C-14 / C-11 / C-7: 組まなかった回を記録に残すと、次の回の比較も除外も
    // その記録を引きずる。**しかも数えるのは保存された提案なので、保存すると上限そのものが
    // 自分で増えていく。** 保存していないことは取得を通して見る（`docs/testing.md` 3章）。
    const priorSuggestions = storedGeneratedSuggestions(10);
    const { suggest, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: priorSuggestions,
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    expect(
      await suggestionRepository.countGeneratedByHouseholdSince(
        ourHousehold,
        dateTimeOf('2026-09-13T03:00:00Z'),
      ),
    ).toBe(priorSuggestions.length);
  });

  it('上限にあと1回ぶん残っていれば生成へ回り、生成した献立を並べた提案を返す', async () => {
    // ADR-049 決定1（境界の下側）/ NFR-C2: 上限は「達したら呼ばない」であって
    // 「近づいたら呼ばない」ではない。門を通ったあとの振る舞いは既存の生成の経路と同じである。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: storedGeneratedSuggestions(9),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('ちょうど24時間前の生成も、上限の数に入る', async () => {
    // ADR-049 決定2（窓の下端の境界）: 下端は含む。**9件を窓の内側に、1件を下端ちょうどに
    // 置いてある** — 下端を含まない実装なら9件と数え、生成へ回って赤くなる。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: [
        ...storedGeneratedSuggestions(9),
        ...storedGeneratedSuggestions(1, '2026-09-13T03:00:00Z'),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(output.outcome).toBe('generationLimitReached');
  });

  it('窓より前の生成は上限の数に入らず、生成へ回る', async () => {
    // ADR-049 決定2 / 比較した案 (b) A: 窓が動くので、最も古い1回が24時間を過ぎれば1回ぶん
    // 戻る。**10件すべてを下端の1分前に置いてある** — 窓を見ない実装なら上限として断る。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: storedGeneratedSuggestions(10, '2026-09-13T02:59:00Z'),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('再利用だけで組んだ提案は上限の数に入らず、生成へ回る', async () => {
    // ADR-049 決定1 / C-14 / NFR-C2: **数えたいのは生成を呼んだ回数であって提案の件数では
    // ない。** 再利用だけで組めた提案も保存されるので、保存された提案をそのまま数えると
    // 呼んでいない回まで上限を食う。**由来だけを既定の再利用に戻してある。**
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: Array.from({ length: 10 }, () =>
        storedSuggestion({ mealIds: [idA], generatedAt: '2026-09-14T02:00:00Z' }),
      ),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('別の世帯の生成は上限の数に入らず、生成へ回る', async () => {
    // C-9 / ADR-049 決定1: 数える単位は世帯である。隣の世帯が使い切った日に
    // こちらが締め出されない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: Array.from({ length: 10 }, () =>
        storedSuggestion({
          mealIds: [idA],
          householdId: neighborHousehold,
          origin: 'generated',
          generatedAt: '2026-09-14T02:00:00Z',
        }),
      ),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('上限に達していても、最新の提案の在庫スナップショットと一致していれば保存済みの提案を返す', async () => {
    // ADR-049 結果6 / C-7 / FR-21: C-7 の短絡は上限の門より先である。短絡は生成を呼ばないので
    // 門の出番が無く、出せる提案があるのに「上限に達した」と告げるほうが利用者を損なう。
    const carrot = { name: 'にんじん' };
    const yogurt = { name: 'ヨーグルト' };
    const latestSuggestion = storedSuggestion({
      mealIds: [idA],
      origin: 'generated',
      generatedAt: '2026-09-14T02:30:00Z',
      pantrySnapshot: [mealStockItem(carrot), mealStockItem(yogurt)],
    });
    const { suggest } = setUp({
      stockItems: [stockItem(carrot), stockItem(yogurt)],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      recentSuggestions: [...storedGeneratedSuggestions(10), latestSuggestion],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).id).toBe(latestSuggestion.id);
  });

  it('上限に達していても、作れる既存の献立が1件あればその献立を並べた提案を返す', async () => {
    // ADR-049 結果6 / C-15 / NFR-C1b / FR-34: 再利用も上限の門より先である。上限が抑えるのは
    // 生成の回数であって、提案そのものではない。**その回の提案は保存されるが、再利用の由来
    // なので数には入らない**（決定1 / C-14）。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [meal({ id: mealIdOf(idB), ingredients: [mainIngredient('にんじん')] })],
      recentSuggestions: storedGeneratedSuggestions(10),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idB]);
  });

  it('在庫が下限を割り、かつ上限にも達している日は、在庫が足りないことを名乗る結末を返す', async () => {
    // ADR-049 結果6（門の順）: 在庫の下限が先で上限が後である。**在庫を登録すれば解ける
    // S-4 と違い、S-7 は待つしかない** — 先に解ける側を告げる。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [],
      recentSuggestions: storedGeneratedSuggestions(10),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(output.outcome).toBe('insufficientStockItems');
  });

  it('生成に失敗した回は、上限の数に入らない', async () => {
    // ADR-049 決定3 / 結果3 / NFR-07: 失敗した回は提案が保存されず、数にも入らない。
    // **上限まで1回ぶん残した状態で2度続けて失敗させる** — 失敗が枠を食う実装なら、
    // 2度目は投げずに上限の結末を返してここが赤くなる。
    // 失うものは結果3 が引き受けた — 実際に外へ出る回数は上限＋失敗した回数になる。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: storedGeneratedSuggestions(9),
      generatedMeals: [],
      mealIdsToIssue: [idC],
    });

    await expect(suggest(ourHousehold, asOf)).rejects.toThrow(MealRuleViolation);

    await expect(suggest(ourHousehold, asOf)).rejects.toThrow(MealRuleViolation);
  });
});

/** 返した提案が並べる献立の名称。並びが本題なので集合にしない。 */
const titlesOf = (output: SuggestMealsOutput) =>
  suggestionOf(output).entries.map((entry) => entry.title);

/**
 * 生成の経路を通る前提（B-78 2周目）。在庫は2件で生成の門（B-31b 規則7）を通り、保持している
 * 献立は既定で0件なので再利用が0件のまま生成へ回る（C-15）。本題の生成結果・落とす名称・
 * 保持している献立だけを `overrides` に渡す（`docs/testing.md` 6章）。
 */
function generationSetUp(overrides: Parameters<typeof setUp>[0] = {}) {
  return setUp({
    stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
    meals: [],
    ...overrides,
  });
}

/** 1回の生成で返す生成結果。名称だけが本題なので、名称から作る。 */
function returnsTitles(...titles: readonly string[]): MealGenerationOutcome {
  return { returns: titles.map((title) => generatedMeal({ title })) };
}

/** 生成結果の列の名称。確かめに渡したものを見るときに使う。 */
function generatedTitlesOf(generatedMeals: readonly GeneratedMeal[] | undefined) {
  return (generatedMeals ?? []).map((generated) => generated.title);
}

describe('生成結果の確かめと作り直し SuggestMeals', () => {
  // ここから B-78 2周目（ADR-089 決定4 / 設計書 6章 規則9〜15・7章）。**生成のあとに確かめ、
  // 残りが3件に満たなければ足りない件数だけ1回作り直し、作り直しの結果も確かめて後ろに足す。**
  //
  // 確かめの代役は落とす名称を指定でき、その名称は**どの回でも**落とす。生成の代役は回ごとに
  // 返すものを変え、全回の入力を `receivedInputs` に持つ。どちらも状態として観察し、`vi.fn()` は
  // 使わない（`docs/testing.md` 2章）。
  //
  // **どの回も、在庫は2件・作れる既存の献立なし**で生成の経路を通る（`generationSetUp`）。

  it('確かめで落とした生成結果は、提案に並ばない', async () => {
    // ADR-089 決定1・4 / B-78 規則9: 確かめが落としたものは保存の前に外れ、提案に載らない。
    const { suggest } = generationSetUp({
      generatedMealsByCall: [
        returnsTitles('肉じゃが', '生姜焼き', 'きんぴら'),
        returnsTitles('生姜焼き'),
      ],
      droppedTitles: ['生姜焼き'],
      mealIdsToIssue: [idA, idB, idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(titlesOf(output)).toEqual(['肉じゃが', 'きんぴら']);
  });

  it('作り直しで残った献立は、1回目に残した献立の後ろに並ぶ', async () => {
    // ADR-089 決定4 / B-78 規則9: 作り直しの結果は1回目の残りの後ろに足す。並べ替えない（C-2）。
    const { suggest } = generationSetUp({
      generatedMealsByCall: [
        returnsTitles('肉じゃが', '生姜焼き', 'きんぴら'),
        returnsTitles('ポトフ'),
      ],
      droppedTitles: ['生姜焼き'],
      mealIdsToIssue: [idA, idB, idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(titlesOf(output)).toEqual(['肉じゃが', 'きんぴら', 'ポトフ']);
  });

  it('確かめのあとに3件残れば、作り直さない', async () => {
    // ADR-089 決定4 / B-78 規則9 / C-15: 作り直すのは足りないときだけである。満ちているのに
    // 呼べば、その分だけ費用がかかる。**2回目に返すものもわざと用意してある** — 誤って作り直した
    // 回も最後まで通り、落ちるのは回数の断定だけになる（`docs/testing.md` 2章）。
    const { suggest, mealGenerator } = generationSetUp({
      generatedMealsByCall: [
        returnsTitles('肉じゃが', '生姜焼き', 'きんぴら'),
        returnsTitles('ポトフ'),
      ],
      mealIdsToIssue: [idA, idB, idC, idD],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInputs).toHaveLength(1);
  });

  it('確かめで1件落ちたときは、作り直しに1件を求める', async () => {
    // ADR-089 決定4 / B-78 規則9: 求めるのは足りない件数である。3件を求め直すと余計な分まで作る。
    const { suggest, mealGenerator } = generationSetUp({
      generatedMealsByCall: [
        returnsTitles('肉じゃが', '生姜焼き', 'きんぴら'),
        returnsTitles('ポトフ'),
      ],
      droppedTitles: ['生姜焼き'],
      mealIdsToIssue: [idA, idB, idC],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInputs[1]?.requiredCount).toBe(1);
  });

  it('生成が1件しか返さなかったときは、作り直しに2件を求める', async () => {
    // ADR-089 決定4 / B-78 規則9: 足りないのは確かめで落ちた分に限らない。生成が返した件数が
    // 少なかった分も同じく足りない件数に入る。
    const { suggest, mealGenerator } = generationSetUp({
      generatedMealsByCall: [returnsTitles('肉じゃが'), returnsTitles('ポトフ', 'グラタン')],
      mealIdsToIssue: [idA, idB, idC],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInputs[1]?.requiredCount).toBe(2);
  });

  it('作り直しの結果も確かめにかけ、落ちたものは提案に並ばない', async () => {
    // ADR-089 決定4 / B-78 規則9: 作り直しの結果も同じ確かめを通す。素通しにすると、
    // 作り直しの回だけ避けたい献立や似た献立が並ぶ。
    const { suggest } = generationSetUp({
      generatedMealsByCall: [returnsTitles('肉じゃが'), returnsTitles('グラタン', 'ポトフ')],
      droppedTitles: ['グラタン'],
      mealIdsToIssue: [idA, idB, idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(titlesOf(output)).toEqual(['肉じゃが', 'ポトフ']);
  });

  it('作り直しても足りなくても、生成を3回目は呼ばない', async () => {
    // ADR-089 決定4 / B-78 2章「作り直しの2回目以降」は作らない / C-15: 作り直しは1回だけ。
    // **3回目に返すものもわざと用意してある** — 誤って呼んだ回も最後まで通り、落ちるのは
    // 回数の断定だけになる（`docs/testing.md` 2章）。
    const { suggest, mealGenerator } = generationSetUp({
      generatedMealsByCall: [
        returnsTitles('肉じゃが'),
        returnsTitles('ポトフ'),
        returnsTitles('グラタン'),
      ],
      mealIdsToIssue: [idA, idB, idC],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInputs).toHaveLength(2);
  });

  it('1回目の確かめには、生成結果を生成の並びのまま、生成に渡したのと同じ避けるべき名称と一緒に渡す', async () => {
    // ADR-089 決定1・2 / FR-42 / B-78 規則9: 確かめが避けたい献立と比べるには、生成に渡したのと
    // 同じ列が要る。並びは同じ提案の中の前後の比較（決定2(c)）が読む。
    const preparedGeneratedMeals = [
      generatedMeal({ title: '肉じゃが' }),
      generatedMeal({ title: '生姜焼き' }),
      generatedMeal({ title: 'きんぴら' }),
    ];
    const { suggest, generatedMealChecker } = generationSetUp({
      meals: [uncookableMeal({ id: idD, title: '豚汁' })],
      generatedMealsByCall: [{ returns: preparedGeneratedMeals }],
      mealIdsToIssue: [idA, idB, idC],
    });

    await suggest(ourHousehold, asOf);

    expect(generatedMealChecker.receivedInputs[0]).toEqual({
      generatedMeals: preparedGeneratedMeals,
      avoidTitles: ['豚汁'],
    });
  });

  it('作り直しの避けるべき名称は、1回目に残した名称を先頭に置き、元の避けるべき名称をその後ろに続ける（落とした名称は入らない）', async () => {
    // ADR-089 決定4 / FR-42 / B-78 規則10・10章 前提1: 1回目に残したものと同じ献立を作り直しで
    // 返させない。落とした名称は残していないので、避ける理由が無い。元の列は生成日時の新しい順
    // （豚汁 が新しい）のまま後ろに続く。
    const { suggest, mealGenerator } = generationSetUp({
      meals: [
        uncookableMeal({ id: idD, title: '豚汁', generatedAt: '2026-09-13T12:00:00Z' }),
        uncookableMeal({ id: idC, title: '筑前煮', generatedAt: '2026-09-12T12:00:00Z' }),
      ],
      generatedMealsByCall: [
        returnsTitles('肉じゃが', '生姜焼き', 'きんぴら'),
        returnsTitles('ポトフ'),
      ],
      droppedTitles: ['生姜焼き'],
      mealIdsToIssue: [idA, idB, numberedMealId(1)],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInputs[1]?.avoidTitles).toEqual([
      '肉じゃが',
      'きんぴら',
      '豚汁',
      '筑前煮',
    ]);
  });

  it('作り直しの避けるべき名称では、1回目に残した名称と同じ名称を元の列から畳む', async () => {
    // B-78 規則10 / B-28 規則8: 同じ名称は先に出たほうを残して1件に畳む。2度送っても避ける
    // 効果は増えず、プロンプトが伸びるだけである。1回目の 肉じゃが は保持している献立を
    // 参照する（C-4）が、名称として残したことに変わりはない。
    const { suggest, mealGenerator } = generationSetUp({
      meals: [
        uncookableMeal({ id: idD, title: '豚汁', generatedAt: '2026-09-13T12:00:00Z' }),
        uncookableMeal({ id: idC, title: '肉じゃが', generatedAt: '2026-09-12T12:00:00Z' }),
      ],
      generatedMealsByCall: [
        returnsTitles('肉じゃが', '生姜焼き', 'きんぴら'),
        returnsTitles('ポトフ'),
      ],
      droppedTitles: ['生姜焼き'],
      mealIdsToIssue: [idA, idB],
    });

    await suggest(ourHousehold, asOf);

    expect(mealGenerator.receivedInputs[1]?.avoidTitles).toEqual(['肉じゃが', 'きんぴら', '豚汁']);
  });

  it('作り直しの避けるべき名称は、1回目に残した名称を足しても50件で切る', async () => {
    // B-78 規則10・10章 前提1 / ADR-021 結果2 / B-28 規則8: 上限は費用の上限である。元の列が
    // ちょうど50件のところへ2件を先頭に足すので、末尾の `献立49` と `献立50` が落ちる。
    const { suggest, mealGenerator } = generationSetUp({
      meals: mealsWithDistinctTitlesAndGeneratedAt(50),
      generatedMealsByCall: [
        returnsTitles('肉じゃが', '生姜焼き', 'きんぴら'),
        returnsTitles('ポトフ'),
      ],
      droppedTitles: ['生姜焼き'],
      mealIdsToIssue: [idA, idB, idC],
    });

    await suggest(ourHousehold, asOf);

    const avoidTitles = mealGenerator.receivedInputs[1]?.avoidTitles ?? [];
    expect(avoidTitles).toHaveLength(50);
  });

  it('作り直しの確かめにも、作り直しの生成に渡したのと同じ避けるべき名称を渡す', async () => {
    // B-78 規則10 / ADR-089 決定2(b): 作り直しの結果が1回目に残した献立と同じ献立かどうかも、
    // 確かめが見る。元の列だけを渡すと、名称を書き換えただけの同じ献立が後ろに並ぶ。
    const { suggest, generatedMealChecker } = generationSetUp({
      meals: [uncookableMeal({ id: idD, title: '豚汁' })],
      generatedMealsByCall: [
        returnsTitles('肉じゃが', '生姜焼き', 'きんぴら'),
        returnsTitles('ポトフ'),
      ],
      droppedTitles: ['生姜焼き'],
      mealIdsToIssue: [idA, idB, idC],
    });

    await suggest(ourHousehold, asOf);

    expect(generatedMealChecker.receivedInputs[1]?.avoidTitles).toEqual([
      '肉じゃが',
      'きんぴら',
      '豚汁',
    ]);
  });

  it('作り直しが1回目に残した献立と同じ名称を返しても、提案に同じ献立は2度並ばない', async () => {
    // C-13 / B-78 規則11 / `Suggestion` の不変条件: 確かめが外へ問えない回でも、同じ献立を
    // 2度並べない。名称の突き合わせは完全一致である（C-6）。
    const { suggest } = generationSetUp({
      generatedMealsByCall: [returnsTitles('肉じゃが'), returnsTitles('肉じゃが', '生姜焼き')],
      mealIdsToIssue: [idA, idB, idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(titlesOf(output)).toEqual(['肉じゃが', '生姜焼き']);
  });

  it('作り直しで1回目と同じ名称になった生成結果は、確かめに渡さない', async () => {
    // B-78 規則11: 同じ名称を落とすのは確かめに渡す前である。渡すと、外へ問う分の費用を
    // 落とすと決まっているものに使う。
    const { suggest, generatedMealChecker } = generationSetUp({
      generatedMealsByCall: [returnsTitles('肉じゃが'), returnsTitles('肉じゃが', '生姜焼き')],
      mealIdsToIssue: [idA, idB, idC],
    });

    await suggest(ourHousehold, asOf);

    expect(generatedTitlesOf(generatedMealChecker.receivedInputs[1]?.generatedMeals)).toEqual([
      '生姜焼き',
    ]);
  });

  it('1回目の生成が投げた例外は、作り直さずにそのまま伝わる', async () => {
    // ADR-089 決定4 / B-78 規則12・7章2行目 / NFR-07: 1回目の失敗は今と同じく写さず伝える。
    // **2回目に返すものを用意してある** — 作り直して組んでしまう実装なら、拒否されずに解決する。
    const preparedError = new Error('生成が落ちた');
    const { suggest } = generationSetUp({
      generatedMealsByCall: [{ throws: preparedError }, returnsTitles('ポトフ')],
      mealIdsToIssue: [idA, idB, idC],
    });

    const execution = suggest(ourHousehold, asOf);

    await expect(execution).rejects.toBe(preparedError);
  });

  it('作り直しの生成が投げたときは、1回目に残した献立だけで提案を組む', async () => {
    // ADR-089 決定4 / B-78 規則12: 作り直しは足りない分を埋める試みであり、失敗しても
    // 1回目に残したものは提案にできる。
    const { suggest } = generationSetUp({
      generatedMealsByCall: [returnsTitles('肉じゃが'), { throws: new Error('作り直しが落ちた') }],
      mealIdsToIssue: [idA, idB, idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(titlesOf(output)).toEqual(['肉じゃが']);
  });

  it('1回目が確かめで全部落ちても、作り直しで残った献立で提案を組む', async () => {
    // ADR-089 決定4 / B-78 規則13: 0件で失敗にするのは2回を経たあとである。
    const { suggest } = generationSetUp({
      generatedMealsByCall: [returnsTitles('肉じゃが', '生姜焼き'), returnsTitles('ポトフ')],
      droppedTitles: ['肉じゃが', '生姜焼き'],
      mealIdsToIssue: [idA, idB, idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(titlesOf(output)).toEqual(['ポトフ']);
  });

  it('1回目も作り直しも確かめで全部落ちたら、mealGenerator.empty の規則違反を投げる', async () => {
    // ADR-089 決定4 / B-78 規則13・7章3行目: 生成が1件も返せなかったときと同じ失敗にする
    // （api 層の既存の写像で 502）。空の提案を組まない。
    const { suggest } = generationSetUp({
      generatedMealsByCall: [returnsTitles('肉じゃが'), returnsTitles('生姜焼き')],
      droppedTitles: ['肉じゃが', '生姜焼き'],
      mealIdsToIssue: [idA, idB, idC],
    });

    const execution = suggest(ourHousehold, asOf);

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'mealGenerator.empty' });
  });

  it('1回目が全部落ちて作り直しが投げたときは、作り直しの例外ではなく mealGenerator.empty の規則違反を投げる', async () => {
    // ADR-089 決定4 / B-78 規則13: 利用者に見えるのは「生成できなかった」であり、作り直しの
    // 失敗の中身ではない。
    const { suggest } = generationSetUp({
      generatedMealsByCall: [returnsTitles('肉じゃが'), { throws: new Error('作り直しが落ちた') }],
      droppedTitles: ['肉じゃが'],
      mealIdsToIssue: [idA, idB, idC],
    });

    const execution = suggest(ourHousehold, asOf);

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'mealGenerator.empty' });
  });

  it('確かめで1件も残らなかった回は、提案を保存しない', async () => {
    // C-14 の裏 / B-78 規則13: 組めなかった回を記録に残すと C-11 の除外が1回ぶん狂う。
    const { suggest, suggestionRepository } = generationSetUp({
      generatedMealsByCall: [returnsTitles('肉じゃが'), returnsTitles('生姜焼き')],
      droppedTitles: ['肉じゃが', '生姜焼き'],
      mealIdsToIssue: [idA, idB, idC],
    });

    // 投げること自体は1つ上の it が見る。ここで受けるのは、未処理の拒否にしないためである。
    await suggest(ourHousehold, asOf).catch(() => undefined);

    expect(await suggestionRepository.findRecentByHousehold(ourHousehold, 3)).toEqual([]);
  });

  it('確かめで落とした生成結果は、献立リポジトリに保存されない', async () => {
    // C-1 / B-78 規則14: 確かめは保存より前である。落としたものを保存すると、提示しない献立が
    // 次の回の避けるべき名称や再利用に混ざる。`findByHousehold` は並びを約束しないので、
    // 名称を並べ直して比べる（ADR-038）。
    const { suggest, mealRepository } = generationSetUp({
      generatedMealsByCall: [
        returnsTitles('肉じゃが', '生姜焼き', 'きんぴら'),
        returnsTitles('生姜焼き'),
      ],
      droppedTitles: ['生姜焼き'],
      mealIdsToIssue: [idA, idB, idC],
    });

    await suggest(ourHousehold, asOf);

    const storedMeals = await mealRepository.findByHousehold(ourHousehold);
    expect(storedMeals.map((storedMeal) => storedMeal.title).sort()).toEqual([
      'きんぴら',
      '肉じゃが',
    ]);
  });

  it('確かめで落とした生成結果には、献立の識別子を発行しない', async () => {
    // B-78 規則14 / B-28 規則12: 発行するのは保存するぶんだけである。落とした 生姜焼き に
    // 発行すると、ポトフ が idC を求めて発行器が尽きる。
    const { suggest, mealRepository } = generationSetUp({
      generatedMealsByCall: [returnsTitles('肉じゃが', '生姜焼き'), returnsTitles('ポトフ')],
      droppedTitles: ['生姜焼き'],
      mealIdsToIssue: [idA, idB],
    });

    await suggest(ourHousehold, asOf);

    const storedMeals = await mealRepository.findByHousehold(ourHousehold);
    expect(
      Object.fromEntries(storedMeals.map((storedMeal) => [storedMeal.title, storedMeal.id])),
    ).toEqual({ 肉じゃが: idA, ポトフ: idB });
  });

  it('確かめで落とした生成結果は、同じ名称の既存の献立があってもその献立を参照しない', async () => {
    // B-78 規則14 / C-4: 確かめは既存の参照より前である。落とした名称で既存を参照すると、
    // 避けたはずの献立が提案に戻る。
    const { suggest } = generationSetUp({
      meals: [uncookableMeal({ id: idD, title: '生姜焼き' })],
      generatedMealsByCall: [
        returnsTitles('肉じゃが', '生姜焼き', 'きんぴら'),
        returnsTitles('ポトフ'),
      ],
      droppedTitles: ['生姜焼き'],
      mealIdsToIssue: [idA, idB, idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA, idB, idC]);
  });

  it('作り直しで残った生成結果も、保持している献立と名称が完全一致すればその献立を参照する', async () => {
    // C-4 / B-78 規則14: 残したものの扱いは1回目と同じである。参照せずに新しく保存する実装なら、
    // ポトフ は idC で並ぶ。
    const { suggest } = generationSetUp({
      meals: [uncookableMeal({ id: idD, title: 'ポトフ' })],
      generatedMealsByCall: [
        returnsTitles('肉じゃが', '生姜焼き', 'きんぴら'),
        returnsTitles('ポトフ'),
      ],
      droppedTitles: ['生姜焼き'],
      mealIdsToIssue: [idA, idB, idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idA, idB, idD]);
  });
});

describe('新しい献立を求める明示操作 SuggestNewMeals', () => {
  // ここから FR-36 の明示操作（B-32）。**既定の提案とは別の入口**であり、C-15 が数える2つの
  // 生成の機会のうち「利用者が新しい献立を明示的に求めたとき」のほうである。
  //
  // **この入口が上書きするのは1つだけである**（prompt-design 8章 の表）— 「作れる既存の献立が
  // 1件以上ある」で短絡しないことである。**在庫の下限も NFR-C2 の1日の上限も、この入口に
  // そのまま当たる**（同 表 / ADR-049 結果7）。
  //
  // **C-7 の短絡も通らない。根拠は FR-21 である** — 「再生成は明示的な操作（FR-36）でのみ
  // 行う」と定めており、C-7 はその「明示的な操作でない回」の判定である（ADR-051）。通して
  // しまうと、利用者が押した直後（在庫が動いていない回）にこそ何も起きず、FR-36 の
  // 「常に3件を新規生成する」と screen-design D-2 の「押すと必ず LLM を呼ぶ」が死ぬ。
  //
  // **どの回も生成結果と発行する献立の識別子をわざと用意してある** — 在庫の下限・上限の回と
  // 同じ理由である（既定の0件のままだと、誤って生成へ回った回が `mealGenerator.empty` で落ちる）。

  it('在庫で作れる既存の献立があっても、生成した献立を並べた提案を返す', async () => {
    // FR-36 / C-15 / prompt-design 8章: この入口が上書きするのは「作れる既存の献立がある」
    // 条件である。**既定の提案なら にんじん で作れる idA を再利用して生成を呼ばない回**であり、
    // 上書きが効いていなければここが idA で赤くなる。
    const { suggestNew } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggestNew(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('作れる既存の献立があっても、提案の1件は由来が生成になる', async () => {
    // FR-35 / C-4c / C-15: 明示操作で得たものは生成の経路から来たものであり、再利用の印を
    // 付けない。1つの提案の中で由来が混ざらないのは既定の提案と同じである。
    const { suggestNew } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggestNew(ourHousehold, asOf);

    expect(suggestionOf(output).entries.map((entry) => entry.origin)).toEqual(['generated']);
  });

  it('生成に求める件数は3件である', async () => {
    // FR-36「常に3件を新規生成する」/ ADR-022: 求める件数は既定の提案と同じ3件であり、
    // 入口で変えない。**返るのが3件に満たなくても、通った件数でそのまま組む**（C-15）。
    const { suggestNew, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggestNew(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.requiredCount).toBe(3);
  });

  it('在庫が最新の提案のときから変わっていなくても、生成した献立を並べた提案を返す', async () => {
    // FR-21 / FR-36 / screen-design D-2 / ADR-051: C-7 の短絡は「明示的な操作でない回」の
    // 判定である。**既定の提案なら保存済みの提案（idA）をそのまま返す回**であり、短絡を通って
    // しまえばここが idA で赤くなる。押した直後に何も起きないことこそ、この入口の失敗である。
    const carrot = { name: 'にんじん' };
    const yogurt = { name: 'ヨーグルト' };
    const { suggestNew } = setUp({
      stockItems: [stockItem(carrot), stockItem(yogurt)],
      meals: [],
      recentSuggestions: [
        storedSuggestion({
          mealIds: [idA],
          pantrySnapshot: [mealStockItem(carrot), mealStockItem(yogurt)],
        }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggestNew(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('在庫が変わっていない回も、提案の識別子は新しく発行した値になる', async () => {
    // FR-21 / C-14 / ADR-051: 短絡した回は保存済みの提案の識別子をそのまま返すが、明示操作は
    // 短絡しない。**この回に組んだ提案は新しい1回ぶん**であり、識別子も生成日時も保存済みの
    // ものではない。
    const carrot = { name: 'にんじん' };
    const yogurt = { name: 'ヨーグルト' };
    const { suggestNew } = setUp({
      stockItems: [stockItem(carrot), stockItem(yogurt)],
      meals: [],
      recentSuggestions: [
        storedSuggestion({
          mealIds: [idA],
          pantrySnapshot: [mealStockItem(carrot), mealStockItem(yogurt)],
        }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggestNew(ourHousehold, asOf);

    expect(suggestionOf(output).id).toBe(suggestionId);
  });

  it('在庫が変わっていない回も、組んだ提案を保存して次の最新にする', async () => {
    // C-14 / C-7: 保存するのは既定の提案と同じである。**保存しないと、次の回の比較（C-7）も
    // 除外（C-11）もこの回を見なかったことになる。** 保存したことは取得を通して見る
    // （`docs/testing.md` 3章）。
    const carrot = { name: 'にんじん' };
    const yogurt = { name: 'ヨーグルト' };
    const { suggestNew, suggestionRepository } = setUp({
      stockItems: [stockItem(carrot), stockItem(yogurt)],
      meals: [],
      recentSuggestions: [
        storedSuggestion({
          mealIds: [idA],
          pantrySnapshot: [mealStockItem(carrot), mealStockItem(yogurt)],
        }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggestNew(ourHousehold, asOf);

    expect((await suggestionRepository.findLatestByHousehold(ourHousehold))?.id).toBe(suggestionId);
  });

  it('最新の提案の取得が投げても、明示操作は提案を返す', async () => {
    // FR-21 / C-7 / ADR-051: 明示操作は最新の提案を比べる必要がない。**既定の提案ならこの
    // 例外がそのまま伝わる回**であり、比較の相手を引きに行かないことがここで見える。
    const { suggestNew } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      findLatestThrows: new Error('最新の提案が引けない'),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggestNew(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('避けるべき名称の先頭は、直前の提案に並んだ献立の名称である', async () => {
    // ADR-021 / FR-42 / prompt-design D-6: **明示操作こそ直前に見た献立を避けたい回である** —
    // 利用者は今見ているものとは違うものを求めて押している。並びは既定の提案と同じ材料から
    // 組み、入口ごとに組み直さない。
    const { suggestNew, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        uncookableMeal({ id: idA, title: '肉じゃが', generatedAt: '2026-09-13T12:00:00Z' }),
        uncookableMeal({ id: idB, title: '生姜焼き', generatedAt: '2026-09-12T12:00:00Z' }),
        uncookableMeal({ id: idC, title: 'きんぴら', generatedAt: '2026-09-11T12:00:00Z' }),
      ],
      recentSuggestions: [
        storedSuggestion({ mealIds: [idC], generatedAt: '2026-09-13T12:00:00Z' }),
        storedSuggestion({ mealIds: [idB], generatedAt: '2026-09-12T12:00:00Z' }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggestNew(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.avoidTitles).toEqual(['きんぴら', '肉じゃが', '生姜焼き']);
  });

  it('直前の提案が無いときは、保持している献立の名称が生成日時の新しい順に並ぶ', async () => {
    // ADR-038 決定1 / B-28 規則6: 蓄積の側の並びも既定の提案と同じである。
    const { suggestNew, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        uncookableMeal({ id: idA, title: '肉じゃが', generatedAt: '2026-09-13T12:00:00Z' }),
        uncookableMeal({ id: idB, title: '生姜焼き', generatedAt: '2026-09-12T12:00:00Z' }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggestNew(ourHousehold, asOf);

    expect(mealGenerator.receivedInput?.avoidTitles).toEqual(['肉じゃが', '生姜焼き']);
  });

  it('生成結果の名称が保持している献立と完全一致したら、その既存の献立の識別子が提案に並ぶ', async () => {
    // C-4 / C-4c: 同じ名称の献立を二重に持たない規則も入口で変わらない。**識別子を1件も
    // 用意していない**ので、新しく保存しようとすればその場で落ちる。
    const { suggestNew } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [uncookableMeal({ id: idB, title: 'ごま和え' })],
      generatedMeals: [generatedMeal({ title: 'ごま和え' })],
      mealIdsToIssue: [],
    });

    const output = await suggestNew(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idB]);
  });

  it('生成した献立は献立リポジトリに保存され、次の取得で見える', async () => {
    // C-1: 提示するのは保存を終えた献立だけである。保存したことは取得を通して見る
    // （`docs/testing.md` 3章）。
    const { suggestNew, mealRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal({ title: 'ごま和え' })],
      mealIdsToIssue: [idC],
    });

    await suggestNew(ourHousehold, asOf);

    const storedMeals = await mealRepository.findByHousehold(ourHousehold);
    expect(storedMeals.map((storedMeal) => storedMeal.title)).toEqual(['ごま和え']);
  });

  it('生成が1件も返せないときは、規則違反がそのまま呼び出し側へ伝わる', async () => {
    // NFR-07 / B-28 7章: 出口が投げた規則違反をここで握って別の提案に埋め合わせない。
    const { suggestNew } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [],
      mealIdsToIssue: [idC],
    });

    await expect(suggestNew(ourHousehold, asOf)).rejects.toThrow(MealRuleViolation);
  });

  it('組んだ提案は、別の世帯からは取り出せない', async () => {
    // C-9: 保存する提案が抱える世帯も、入口で変わらない。
    const { suggestNew, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggestNew(ourHousehold, asOf);

    expect(await suggestionRepository.findLatestByHousehold(neighborHousehold)).toBeNull();
  });

  it('在庫が1件だけの日は、在庫が足りないことを名乗る結末を返す', async () => {
    // prompt-design 8章（FR-36 の行）/ ADR-041 決定1: **明示操作が上書きするのは「作れる既存の
    // 献立がある」条件だけである。** 在庫の条件は明示操作にもそのまま当たる — 1件では
    // 主菜が組めないことは、誰が求めても変わらない。
    const { suggestNew } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggestNew(ourHousehold, asOf);

    expect(output.outcome).toBe('insufficientStockItems');
  });

  it('在庫が1件だけの日は、献立生成器を呼ばない', async () => {
    // prompt-design 8章 / `docs/testing.md` 2章: 下限の目的は呼ばないことそのものである。
    // 呼ばないこと自体が要件なので、記憶上の実装の**状態**として見る（`vi.fn()` を使わない）。
    const { suggestNew, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggestNew(ourHousehold, asOf);

    expect(mealGenerator.callCount).toBe(0);
  });

  it('在庫が2件あっても全件が期限切れの日は、在庫が足りないことを名乗る結末を返す', async () => {
    // ADR-040 決定2 / B-31b 規則6: 数えるのは期限切れを落としたあとの件数である。
    // **期限の規則も入口で変わらない。**
    const { suggestNew } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん', expiryDate: '2026-09-13' }),
        stockItem({ name: 'ヨーグルト', expiryDate: '2026-09-13' }),
      ],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggestNew(ourHousehold, asOf);

    expect(output.outcome).toBe('insufficientStockItems');
  });

  it('在庫が2件あれば生成へ回り、生成した献立を並べた提案を返す', async () => {
    // prompt-design 8章（境界の上側）: 門を通ったあとの振る舞いは既定の生成の経路と同じである。
    const { suggestNew } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggestNew(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('直近24時間の生成が上限に達している日は、上限に達したことを名乗る結末を返す', async () => {
    // ADR-049 結果7 / NFR-C2 / prompt-design 8章（FR-36 の行）: **上限は明示操作にも当たる。**
    // 抑えたいのは呼んだ回数そのものであり、押せば必ず呼ぶ入口を上限の外に置けば、
    // 上限は上限として働かない。
    const { suggestNew } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: storedGeneratedSuggestions(10),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggestNew(ourHousehold, asOf);

    expect(output.outcome).toBe('generationLimitReached');
  });

  it('上限に達している日は、献立生成器を呼ばない', async () => {
    // ADR-049 結果7 / `docs/testing.md` 2章: 呼ばないこと自体が要件なので、記憶上の実装の
    // **状態**として見る（`vi.fn()` を使わない）。
    const { suggestNew, mealGenerator } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: storedGeneratedSuggestions(10),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggestNew(ourHousehold, asOf);

    expect(mealGenerator.callCount).toBe(0);
  });

  it('上限に達した結末の回は、提案を保存しない', async () => {
    // ADR-049 決定1 / C-14: 組まなかった回を記録に残すと、数えている当のものが自分で増えていく。
    const priorSuggestions = storedGeneratedSuggestions(10);
    const { suggestNew, suggestionRepository } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: priorSuggestions,
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggestNew(ourHousehold, asOf);

    expect(
      await suggestionRepository.countGeneratedByHouseholdSince(
        ourHousehold,
        dateTimeOf('2026-09-13T03:00:00Z'),
      ),
    ).toBe(priorSuggestions.length);
  });

  it('上限にあと1回ぶん残っていれば生成へ回り、生成した献立を並べた提案を返す', async () => {
    // ADR-049 決定1（境界の下側）: 上限は「達したら呼ばない」であって「近づいたら呼ばない」
    // ではない。**入口が増えても境界は同じ1本である。**
    const { suggestNew } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: storedGeneratedSuggestions(9),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggestNew(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idC]);
  });

  it('明示操作で組んだ提案も、次の回の上限の数に入る', async () => {
    // ADR-049 結果7: **数えるのは `origin` が `'generated'` の提案であり、どの入口から呼んだかを
    // 区別しない。** 上限まで1回ぶん残した状態で明示操作を2度続けると、1度目が枠を使い切り、
    // 2度目は上限の結末になる。入口ごとに数えている実装なら、2度目も生成へ回って赤くなる。
    const { suggestNew } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: storedGeneratedSuggestions(9),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggestNew(ourHousehold, asOf);

    expect((await suggestNew(ourHousehold, asOf)).outcome).toBe('generationLimitReached');
  });

  it('在庫が下限を割り、かつ上限にも達している日は、在庫が足りないことを名乗る結末を返す', async () => {
    // ADR-049 結果6（門の順）: 在庫の下限が先で上限が後である。**門の順も入口で変わらない** —
    // 在庫を登録すれば解ける S-4 を先に告げる。
    const { suggestNew } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [],
      recentSuggestions: storedGeneratedSuggestions(10),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggestNew(ourHousehold, asOf);

    expect(output.outcome).toBe('insufficientStockItems');
  });

  it('明示操作でも、確かめで落とした分を作り直して後ろに足す', async () => {
    // FR-36 / ADR-089 決定4 / B-78 規則9: 確かめと作り直しは生成の経路に入っており、入口で
    // 変わらない（B-32 / ADR-051 決定2）。作れる既存の 豚汁 があっても再利用せず生成へ回る。
    const { suggestNew } = generationSetUp({
      meals: [
        meal({ id: mealIdOf(idD), title: '豚汁', ingredients: [mainIngredient('にんじん')] }),
      ],
      generatedMealsByCall: [
        returnsTitles('肉じゃが', '生姜焼き', 'きんぴら'),
        returnsTitles('ポトフ'),
      ],
      droppedTitles: ['生姜焼き'],
      mealIdsToIssue: [idA, idB, idC],
    });

    const output = await suggestNew(ourHousehold, asOf);

    expect(titlesOf(output)).toEqual(['肉じゃが', 'きんぴら', 'ポトフ']);
  });
});

/** 保存済みの提案と同じ在庫にしておく在庫品。C-7 で短絡する回の前提に使う。 */
const unchangedCarrot = { name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' };

/**
 * 在庫が最新の提案のときから変わっていない回の前提（C-7）。在庫と在庫スナップショットを
 * 同じ3つ組にしてあるので、既定の提案はこの提案をそのまま返す経路を通る。
 */
function unchangedStockItemsSetUp(props: { mealIds: readonly string[]; meals: readonly Meal[] }) {
  return setUp({
    stockItems: [stockItem(unchangedCarrot)],
    meals: props.meals,
    recentSuggestions: [
      storedSuggestion({
        mealIds: props.mealIds,
        pantrySnapshot: [mealStockItem(unchangedCarrot)],
      }),
    ],
  });
}

/** 分量つきの主材料。`mainIngredient` は分量を持たないので、分量が本題の回に使う。 */
function mainIngredientWithAmount(name: string, amount: string) {
  return createMealIngredient({ name, kind: 'main', amount: amountOf(amount) });
}

/** 投げられた値を取り出す。解決したときは投げられた値が無いので `undefined` を返す。 */
async function rejectionOf(execution: Promise<unknown>): Promise<unknown> {
  try {
    await execution;
    return undefined;
  } catch (error) {
    return error;
  }
}

/** 返した提案の先頭の1件。無ければその場で落ちる。 */
function firstEntryOf(output: SuggestMealsOutput) {
  const entry = suggestionOf(output).entries[0];
  if (entry === undefined) throw new Error('提案の1件が無い');
  return entry;
}

describe('提案の結末が載せる献立の中身 SuggestMeals / SuggestNewMeals', () => {
  // ここから B-48a 1周目。**提案の1件に、指す献立の名称・材料・手順を載せる**（FR-19 / 規則2〜5）。
  // 充足（`coverage`）は下の describe「提案の1件が載せる充足」が見るので、ここでは検査しない。
  // 1件を丸ごと比べず、項目ごとに取り出して比べる。

  it('在庫が足りない結末は、結末の名乗りのほかに何も持たない', async () => {
    // B-48a 規則1 / ADR-041 決定1: 変種は変えない。在庫不足の変種には何も足さない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(output).toEqual({ outcome: 'insufficientStockItems' });
  });

  it('上限に達した結末は、結末の名乗りのほかに何も持たない', async () => {
    // B-48a 規則1 / ADR-041 決定1: 上限の変種にも何も足さない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      recentSuggestions: storedGeneratedSuggestions(10),
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(output).toEqual({ outcome: 'generationLimitReached' });
  });

  it('再利用した提案の1件は、指す献立の名称を載せる', async () => {
    // FR-19 / B-48a 規則2: 再利用の経路でも1件ごとに献立の名称を載せる。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [
        meal({ id: mealIdOf(idA), title: '肉じゃが', ingredients: [mainIngredient('にんじん')] }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(firstEntryOf(output).title).toBe('肉じゃが');
  });

  it('再利用した提案の1件は、献立の材料を調味料も含めて保存された並びのまま全件載せる', async () => {
    // B-48a 規則3 / C-5 / C-16: 材料は調味料も含めて全件、並べ替えない（主材料が先は画面が決める）。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'たまねぎ' }), stockItem({ name: 'にんじん' })],
      meals: [
        meal({
          id: mealIdOf(idA),
          ingredients: [
            mainIngredient('たまねぎ'),
            seasoning('醤油', '大さじ1'),
            mainIngredientWithAmount('にんじん', '1本'),
          ],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(firstEntryOf(output).ingredients).toEqual([
      { name: 'たまねぎ', kind: 'main', amount: null },
      { name: '醤油', kind: 'seasoning', amount: '大さじ1' },
      { name: 'にんじん', kind: 'main', amount: '1本' },
    ]);
  });

  it('再利用した提案の1件は、献立の手順を保存された並びのまま載せる', async () => {
    // FR-19 / B-48a 規則3: 手順は保存されている並びのまま写す。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [
        meal({
          id: mealIdOf(idA),
          ingredients: [mainIngredient('にんじん')],
          steps: [cookingStepOf('切る'), cookingStepOf('炒める'), cookingStepOf('煮る')],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(firstEntryOf(output).steps).toEqual(['切る', '炒める', '煮る']);
  });

  it('提案の1件は、それぞれが指す献立の名称を C-12 の並びのまま載せる', async () => {
    // B-48a 規則2 / C-12: 足すのは中身だけで、1件の並びは変えない。
    const { suggest } = setUp({
      stockItems: staggeredExpiryStockItems(),
      meals: cookableMealsForStaggeredExpiryStockItems(),
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).entries.map((entry) => entry.title)).toEqual([
      '生姜焼き',
      'きんぴら',
      '肉じゃが',
    ]);
  });

  it('生成して保存した献立の1件は、生成結果の名称を載せる', async () => {
    // FR-19 / B-48a 規則5: その回に保存した献立から引き当てる。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [generatedMeal({ title: 'ごま和え' })],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(firstEntryOf(output).title).toBe('ごま和え');
  });

  it('生成して保存した献立の1件は、生成結果の材料を並べ替えずに全件載せる', async () => {
    // B-48a 規則3 / C-5 / C-16: 調味料が先に来ても並べ替えない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [
        generatedMeal({
          ingredients: [seasoning('塩', '少々'), mainIngredientWithAmount('にんじん', '1本')],
        }),
      ],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(firstEntryOf(output).ingredients).toEqual([
      { name: '塩', kind: 'seasoning', amount: '少々' },
      { name: 'にんじん', kind: 'main', amount: '1本' },
    ]);
  });

  it('生成して保存した献立の1件は、生成結果の手順を並びのまま載せる', async () => {
    // FR-19 / B-48a 規則3: 手順は生成結果の並びのまま写す。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [
        generatedMeal({ steps: [cookingStepOf('ゆでる'), cookingStepOf('和える')] }),
      ],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(firstEntryOf(output).steps).toEqual(['ゆでる', '和える']);
  });

  it('生成結果が既存の献立と同じ名称なら、その1件は生成結果ではなく既存の献立の材料と手順を載せる', async () => {
    // B-48a 規則5 / C-4 / C-3: 既存を参照した1件は既存の献立の中身を返す。生成結果の中身で
    // 上書きすると、同じ識別子が回ごとに違う中身を名乗る。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        meal({
          id: mealIdOf(idA),
          title: '肉じゃが',
          ingredients: [mainIngredient('じゃがいも')],
          steps: [cookingStepOf('煮る')],
        }),
      ],
      generatedMeals: [
        generatedMeal({
          title: '肉じゃが',
          ingredients: [mainIngredient('にんじん')],
          steps: [cookingStepOf('和える')],
        }),
      ],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    const entry = firstEntryOf(output);
    expect({ ingredients: entry.ingredients, steps: entry.steps }).toEqual({
      ingredients: [{ name: 'じゃがいも', kind: 'main', amount: null }],
      steps: ['煮る'],
    });
  });

  it('在庫が変わっていない回も、提案の1件は指す献立の名称を載せる', async () => {
    // B-48a 規則4 / FR-21 / C-7: 短絡した回も同じ形で返す。
    const { suggest } = unchangedStockItemsSetUp({
      mealIds: [idA],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(firstEntryOf(output).title).toBe('肉じゃが');
  });

  it('在庫が変わっていない回も、提案の1件は献立の材料を調味料も含めて保存された並びのまま載せる', async () => {
    // B-48a 規則3・4 / C-7 / C-16: 短絡した回も材料を全件、並べ替えずに載せる。
    const { suggest } = unchangedStockItemsSetUp({
      mealIds: [idA],
      meals: [
        meal({
          id: mealIdOf(idA),
          ingredients: [mainIngredient('にんじん'), seasoning('醤油', '大さじ1')],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(firstEntryOf(output).ingredients).toEqual([
      { name: 'にんじん', kind: 'main', amount: null },
      { name: '醤油', kind: 'seasoning', amount: '大さじ1' },
    ]);
  });

  it('在庫が変わっていない回も、提案の1件は献立の手順を保存された並びのまま載せる', async () => {
    // B-48a 規則3・4 / C-7: 短絡した回も手順を並びのまま載せる。
    const { suggest } = unchangedStockItemsSetUp({
      mealIds: [idA],
      meals: [meal({ id: mealIdOf(idA), steps: [cookingStepOf('切る'), cookingStepOf('煮る')] })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(firstEntryOf(output).steps).toEqual(['切る', '煮る']);
  });

  it('在庫が変わっていない回に、保存済みの提案が指す献立が世帯の献立に無ければ、規則違反でない Error で断る', async () => {
    // B-48a 規則11（決定1）/ ADR-045 決定1 / ADR-058 結果2: 引けないのはデータの不整合であり、
    // 利用者が入力を直しても解消しない。`MealRuleViolation` に包むと api 層の写像が 4xx に化けさせる。
    const { suggest } = unchangedStockItemsSetUp({ mealIds: [idA], meals: [] });

    const error = await rejectionOf(suggest(ourHousehold, asOf));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).not.toBe('MealRuleViolation');
    expect(error).not.toHaveProperty('rule');
  });

  it('保存済みの提案が指す献立のうち1件だけが無くても、その1件を落として返さずに断る', async () => {
    // B-48a 規則11（決定1）/ FR-21 / C-15: 1件だけ落とすと「同じものが表示される」が黙って崩れる。
    const { suggest } = unchangedStockItemsSetUp({
      mealIds: [idA, idD],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
    });

    await expect(suggest(ourHousehold, asOf)).rejects.toThrow(Error);
  });

  it('保存済みの提案が別の世帯の献立の識別子を指していれば、見つからないものとして断る', async () => {
    // B-48a 規則11 / C-9: 引き当てる相手は第1引数の世帯の献立だけである。
    const { suggest } = unchangedStockItemsSetUp({
      mealIds: [idA],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが', householdId: neighborHousehold })],
    });

    const error = await rejectionOf(suggest(ourHousehold, asOf));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(MealRuleViolation);
  });

  it('献立が引けずに断るとき、例外の message に世帯の識別子を含めない', async () => {
    // ADR-045 決定3: 例外の message はログに出うる。世帯の識別子を載せない。
    const { suggest } = unchangedStockItemsSetUp({ mealIds: [idA], meals: [] });

    await expect(suggest(ourHousehold, asOf)).rejects.not.toThrow(ourHousehold);
  });

  it('提案の1件は、献立の世帯・調理記録・生成日時を載せない', async () => {
    // B-48a 規則12 / NFR-09: 出力に載せるのは名称・材料・手順・充足と、識別子・由来だけである。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [
        meal({
          id: mealIdOf(idA),
          ingredients: [mainIngredient('にんじん')],
          cookingRecords: [createCookingRecord({ cookedAt: dateTimeOf('2026-09-13T19:00:00Z') })],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    const entry = firstEntryOf(output);
    expect(entry).not.toHaveProperty('householdId');
    expect(entry).not.toHaveProperty('cookingRecords');
    expect(entry).not.toHaveProperty('generatedAt');
  });

  it('明示操作で組んだ提案の1件も、生成して保存した献立の名称を載せる', async () => {
    // FR-36 / FR-19 / B-48a 規則5: 明示操作も同じ本体を通り、同じ形で返す。作れる既存の献立が
    // あっても生成へ回るので、載るのは生成して保存した献立の名称である。
    const { suggestNew } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [
        meal({ id: mealIdOf(idA), title: '肉じゃが', ingredients: [mainIngredient('にんじん')] }),
      ],
      generatedMeals: [generatedMeal({ title: 'ごま和え' })],
      mealIdsToIssue: [idC],
    });

    const output = await suggestNew(ourHousehold, asOf);

    expect(firstEntryOf(output).title).toBe('ごま和え');
  });
});

/** 提案の先頭の1件が載せる、充足の賄える材料の名称の列。期限は見ない。 */
function coveredNamesOf(output: SuggestMealsOutput): string[] {
  return firstEntryOf(output).coverage.covered.map((ingredient) => ingredient.name);
}

/** 提案の先頭の1件が載せる、充足の不足する材料の名称の列。 */
function missingNamesOf(output: SuggestMealsOutput): string[] {
  return firstEntryOf(output).coverage.missing.map((ingredient) => ingredient.name);
}

/** 提案の先頭の1件が載せる、充足の賄える材料の期限の列。名称は見ない。 */
function coveredExpiryDatesOf(output: SuggestMealsOutput): (string | null)[] {
  return firstEntryOf(output).coverage.covered.map((ingredient) => ingredient.expiryDate);
}

describe('提案の1件が載せる充足 SuggestMeals', () => {
  // ここから B-48a 2周目。**提案の1件に、現在の在庫での充足を載せる**（規則6〜9）。
  // 充足の行は賄える材料・不足する材料の名称だけを見て期限を見ず、期限の行は期限だけを見る。

  it('再利用した提案の1件は、在庫で賄える主材料を充足の賄える材料に載せる', async () => {
    // B-48a 規則6 / FR-17 / C-6: 充足はその要求で読んだ在庫の名称で算出する。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(coveredNamesOf(output)).toEqual(['にんじん']);
  });

  it('再利用した提案の1件は、不足する材料を持たない', async () => {
    // B-48a 規則9 / C-10: 再利用の判定と同じ在庫・同じ関数で算出するので食い違わない。
    // 在庫に無い調味料があっても不足に数えない（C-16）。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'たまねぎ' })],
      meals: [
        meal({
          id: mealIdOf(idA),
          ingredients: [
            mainIngredient('にんじん'),
            mainIngredient('たまねぎ'),
            seasoning('醤油', '大さじ1'),
          ],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(firstEntryOf(output).coverage.missing).toEqual([]);
  });

  it('生成した献立の1件は、在庫に無い主材料を充足の不足する材料に載せる', async () => {
    // B-48a 規則6: 生成した献立も同じ在庫で充足を算出する。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [
        generatedMeal({
          title: 'ごま和え',
          ingredients: [mainIngredient('にんじん'), mainIngredient('豚肉')],
        }),
      ],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(missingNamesOf(output)).toEqual(['豚肉']);
  });

  it('在庫に同じ名称があっても、調味料は賄える材料に載らない', async () => {
    // C-16: 充足の突き合わせに載るのは主材料だけである。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: '醤油' })],
      meals: [
        meal({
          id: mealIdOf(idA),
          ingredients: [mainIngredient('にんじん'), seasoning('醤油', '大さじ1')],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(coveredNamesOf(output)).toEqual(['にんじん']);
  });

  it('在庫に無くても、調味料は不足する材料に載らない', async () => {
    // C-16: 調味料は不足にも数えない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [
        generatedMeal({ ingredients: [mainIngredient('豚肉'), seasoning('みりん', '大さじ1')] }),
      ],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(missingNamesOf(output)).toEqual(['豚肉']);
  });

  it('賄える材料は、在庫の並びではなく献立の材料の並びで載る', async () => {
    // B-48a 規則7 / C-12: 並びは mealCoverageOf が返したまま、つまり材料の並びである。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'たまねぎ' })],
      meals: [
        meal({
          id: mealIdOf(idA),
          ingredients: [mainIngredient('たまねぎ'), mainIngredient('にんじん')],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(coveredNamesOf(output)).toEqual(['たまねぎ', 'にんじん']);
  });

  it('期限切れの在庫品の名称も突き合わせに入り、その主材料は賄える材料に載る', async () => {
    // B-48a 規則6 / ADR-036 結果3: 期限は賄えるかに関わらない。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん', expiryDate: '2026-09-10' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(coveredNamesOf(output)).toEqual(['にんじん']);
  });

  it('献立に使わない在庫品の名称の主材料も、提案の1件の充足では賄える材料に載る', async () => {
    // FR-43 / 設計書 規則9: 充足は献立に使うかどうかで濾す前の在庫の全件で算出する。
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: 'たまねぎ' }),
        stockItem({ name: 'じゃがいも' }),
        stockItem({ name: 'にんじん', useForMeals: false }),
      ],
      meals: [],
      generatedMeals: [generatedMeal({ ingredients: [mainIngredient('にんじん')] })],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(coveredNamesOf(output)).toEqual(['にんじん']);
  });

  it('在庫が変わっていない回も、提案の1件に現在の在庫での充足を載せる', async () => {
    // B-48a 規則4・6 / FR-21 / C-7: 短絡した回も同じ形で、現在の在庫で算出した充足を載せる。
    const { suggest } = unchangedStockItemsSetUp({
      mealIds: [idA],
      meals: [
        meal({
          id: mealIdOf(idA),
          ingredients: [mainIngredient('にんじん'), mainIngredient('豚肉')],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(firstEntryOf(output).coverage).toEqual({
      covered: [{ name: 'にんじん', kind: 'main', amount: null, expiryDate: '2026-09-20' }],
      missing: [{ name: '豚肉', kind: 'main', amount: null }],
    });
  });

  it('賄える材料は、同じ名称の在庫品の期限を載せる', async () => {
    // B-48a 規則8 / FR-18: 画面の「使う:」が期限の近い在庫を示すための日付である。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん', expiryDate: '2026-09-20' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(coveredExpiryDatesOf(output)).toEqual(['2026-09-20']);
  });

  it('同じ名称の在庫品が複数あれば、賄える材料には最も早い期限を載せる', async () => {
    // B-48a 規則8 / ADR-036 決定1: 同じ名称の在庫品は最も早い期限の1件に畳む。
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん', expiryDate: '2026-09-20' }),
        stockItem({ name: 'にんじん', expiryDate: '2026-09-16' }),
        stockItem({ name: 'にんじん', expiryDate: '2026-09-18' }),
      ],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(coveredExpiryDatesOf(output)).toEqual(['2026-09-16']);
  });

  it('期限を持たない在庫品が同じ名称にあっても、期限を持つ在庫品の期限を載せる', async () => {
    // B-48a 規則8 / ADR-036 結果3: 期限なしは最も早い期限の座を奪わない。
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん', expiryDate: null }),
        stockItem({ name: 'にんじん', expiryDate: '2026-09-20' }),
      ],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(coveredExpiryDatesOf(output)).toEqual(['2026-09-20']);
  });

  it('同じ名称の在庫品がどれも期限を持たなければ、賄える材料の期限は null である', async () => {
    // B-48a 規則8: 期限を持つ在庫品が1件も無い名称は null で表す。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん', expiryDate: null })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(coveredExpiryDatesOf(output)).toEqual([null]);
  });

  it('期限切れの在庫品の期限も、過去の日付のまま載せる', async () => {
    // B-48a 規則8: 載せるのは日付であって、基準時刻で落としも読み替えもしない（見せ方は画面）。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん', expiryDate: '2026-09-10' })],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(coveredExpiryDatesOf(output)).toEqual(['2026-09-10']);
  });

  it('賄える材料の期限は材料ごとに、それぞれの名称の在庫品のものを載せる', async () => {
    // B-48a 規則8 / C-6: 期限は名称の完全一致で引いた在庫品のものである。
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん', expiryDate: '2026-09-20' }),
        stockItem({ name: 'たまねぎ', expiryDate: '2026-09-15' }),
      ],
      meals: [
        meal({
          id: mealIdOf(idA),
          ingredients: [mainIngredient('たまねぎ'), mainIngredient('にんじん')],
        }),
      ],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(
      firstEntryOf(output).coverage.covered.map((ingredient) => [
        ingredient.name,
        ingredient.expiryDate,
      ]),
    ).toEqual([
      ['たまねぎ', '2026-09-15'],
      ['にんじん', '2026-09-20'],
    ]);
  });

  it('不足する材料には期限を載せない', async () => {
    // B-48a 規則8: 期限を載せるのは賄える材料だけである。
    const { suggest } = setUp({
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'ヨーグルト' })],
      meals: [],
      generatedMeals: [
        generatedMeal({
          title: 'ごま和え',
          ingredients: [mainIngredient('にんじん'), mainIngredient('豚肉')],
        }),
      ],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    const missingIngredient = firstEntryOf(output).coverage.missing[0];
    if (missingIngredient === undefined) throw new Error('不足する材料が無い');
    expect(missingIngredient).not.toHaveProperty('expiryDate');
  });
});

describe('献立に使わない在庫品を提案から外す SuggestMeals / SuggestNewMeals', () => {
  // B-76。献立に使わない在庫品は、作れる献立の選定・在庫の下限・在庫スナップショット・
  // 生成の入力・C-7 の比較のすべてから外す（FR-43 / ADR-086 / 設計書 規則7・8）。
  // **どの回も生成結果と発行する献立の識別子をわざと用意してある** — 外し損ねた回が
  // `mealGenerator.empty` ではなく、値の食い違いで落ちるようにするためである。

  it('献立に使わない在庫品があって初めて作れる献立は、再利用されない', async () => {
    // FR-43 / C-10 / 設計書 規則7: 作れるかどうかは献立に使う在庫品だけで判定する。
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: 'たまねぎ' }),
        stockItem({ name: 'じゃがいも' }),
        stockItem({ name: 'にんじん', useForMeals: false }),
      ],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idD]);
  });

  it('同じ名称の献立に使わない在庫品の期限は、再利用の並びに効かない', async () => {
    // FR-43 / C-12 / 設計書 規則7: 並びの決め手になる期限も献立に使う在庫品だけから取る。
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん', expiryDate: '2026-10-10' }),
        stockItem({ name: 'たまねぎ', expiryDate: '2026-10-05' }),
        stockItem({ name: 'にんじん', expiryDate: '2026-10-01', useForMeals: false }),
      ],
      meals: [
        meal({ id: mealIdOf(idA), title: 'きんぴら', ingredients: [mainIngredient('にんじん')] }),
        meal({
          id: mealIdOf(idB),
          title: 'オニオンスープ',
          ingredients: [mainIngredient('たまねぎ')],
        }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(mealIdsOf(output)).toEqual([idB, idA]);
  });

  it('献立に使わない在庫品を除くと下限を割る日は、在庫が足りないことを名乗る結末を返す', async () => {
    // FR-43 / prompt-design 8章 / 設計書 7章: 下限は献立に使う在庫品だけで数える。
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん' }),
        stockItem({ name: 'ヨーグルト', useForMeals: false }),
      ],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(output).toEqual({ outcome: 'insufficientStockItems' });
  });

  it('生成に渡す在庫スナップショットに、献立に使わない在庫品は入らない', async () => {
    // FR-43 / ADR-037 決定1 / 設計書 規則7: 生成の入力は献立に使う在庫品だけで組む。
    const { suggest, mealGenerator } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん' }),
        stockItem({ name: 'ヨーグルト', useForMeals: false }),
        stockItem({ name: 'たまねぎ' }),
      ],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggest(ourHousehold, asOf);

    expect(
      mealGenerator.receivedInput?.pantrySnapshot.stockItems.map((stockItem) => stockItem.name),
    ).toEqual(['にんじん', 'たまねぎ']);
  });

  it('再利用だけで組んだ提案の在庫スナップショットにも、献立に使わない在庫品は入らない', async () => {
    // FR-43 / ADR-037 決定1 / 設計書 規則7: 写しは1つであり、保存する提案も同じものを抱える。
    const { suggest, suggestionRepository } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん' }),
        stockItem({ name: 'ヨーグルト', useForMeals: false }),
      ],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    await suggest(ourHousehold, asOf);

    const fetched = (await suggestionRepository.findRecentByHousehold(ourHousehold, 3))[0];
    expect(fetched?.pantrySnapshot.stockItems.map((stockItem) => stockItem.name)).toEqual([
      'にんじん',
    ]);
  });

  it('明示操作でも、生成に渡す在庫スナップショットに献立に使わない在庫品は入らない', async () => {
    // FR-36 / FR-43 / 設計書 規則7: 2つの入口は同じ本体を通り、同じように外す。
    const { suggestNew, mealGenerator } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん' }),
        stockItem({ name: 'ヨーグルト', useForMeals: false }),
        stockItem({ name: 'たまねぎ' }),
      ],
      meals: [],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    await suggestNew(ourHousehold, asOf);

    expect(
      mealGenerator.receivedInput?.pantrySnapshot.stockItems.map((stockItem) => stockItem.name),
    ).toEqual(['にんじん', 'たまねぎ']);
  });

  it('最新の提案の在庫と比べて献立に使わない在庫品が増えただけなら、保存済みの提案の識別子をそのまま返す', async () => {
    // C-7 / ADR-086 / 設計書 規則8: 比べる現在の在庫は献立に使う在庫品だけである。
    const priorSuggestion = storedSuggestion({
      mealIds: [idA],
      pantrySnapshot: [
        mealStockItem({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' }),
      ],
    });
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' }),
        stockItem({ name: 'ヨーグルト', useForMeals: false }),
      ],
      meals: [uncookableMeal({ id: idA, title: '肉じゃが' })],
      recentSuggestions: [priorSuggestion],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idD],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).id).toBe(priorSuggestion.id);
  });

  it('最新の提案のときに使っていた在庫品を献立に使わないに切り替えた日は、短絡せず新しい提案を返す', async () => {
    // C-7 / ADR-086 / 設計書 規則8: 切り替えれば献立に使う在庫品が変わるので一致しない。
    const { suggest } = setUp({
      stockItems: [
        stockItem({ name: 'にんじん' }),
        stockItem({ name: 'じゃがいも' }),
        stockItem({ name: 'たまねぎ', useForMeals: false }),
      ],
      meals: [meal({ id: mealIdOf(idA), ingredients: [mainIngredient('にんじん')] })],
      recentSuggestions: [
        storedSuggestion({
          mealIds: [idA],
          pantrySnapshot: [
            mealStockItem({ name: 'にんじん' }),
            mealStockItem({ name: 'じゃがいも' }),
            mealStockItem({ name: 'たまねぎ' }),
          ],
        }),
      ],
      generatedMeals: [generatedMeal()],
      mealIdsToIssue: [idC],
    });

    const output = await suggest(ourHousehold, asOf);

    expect(suggestionOf(output).id).toBe(suggestionId);
  });
});
