import { describe, expect, it } from 'vitest';
import type { StockItemDto } from '@fridge-to-meal/contract';
import { suggestMeals } from '../../../../src/contexts/meal/usecase/SuggestMeals.js';
import type { SuggestMealsOutput } from '../../../../src/contexts/meal/usecase/SuggestMeals.js';
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
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { 記憶上の在庫品の一覧 } from '../../../support/pantry/FixedStockItemUsecases.js';
import type { 保存の失敗 } from '../../../support/meal/InMemoryMealRepository.js';
import { 記憶上の献立リポジトリ } from '../../../support/meal/InMemoryMealRepository.js';
import { 記憶上の提案リポジトリ } from '../../../support/meal/InMemorySuggestionRepository.js';
import { 記憶上の献立生成器 } from '../../../support/meal/FixedMealGenerator.js';
import { 記憶上の献立識別子発行器 } from '../../../support/meal/FixedMealIdGenerator.js';
import { 記憶上の提案識別子発行器 } from '../../../support/meal/FixedSuggestionIdGenerator.js';

const 我が家 = householdIdOf('11111111-1111-4111-8111-111111111111');
const 隣の家 = householdIdOf('99999999-9999-4999-8999-999999999999');

/** 献立の識別子。C-12 の最後の段は `MealId` の昇順なので、a < b < c < d の順になっている。 */
const 識別子A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const 識別子B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const 識別子C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const 識別子D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** 提案の識別子。本題が識別子でないときに発行させる値（#6 だけが自分で literal を渡す）。 */
const 提案の識別子 = '55555555-5555-4555-8555-555555555555';

/** 基準日時。現在時刻を読まず引数で渡す（`docs/testing.md` 5章）。時差つきの表記である。 */
const 基準日時 = '2026-09-14T12:00:00+09:00';

/** 本題が在庫品の識別子でないときの採番。在庫品の識別子は提案には出てこない（ADR-037）。 */
let 連番 = 0;
function 次の在庫品の識別子() {
  連番 += 1;
  return `00000000-0000-4000-8000-${String(連番).padStart(12, '0')}`;
}

/** 在庫の一覧が返す在庫品1件。テストの本題でない項目を隠す（`docs/testing.md` 6章）。 */
function 在庫品(props: {
  id?: string;
  name: string;
  ingredientId?: string | null;
  amount?: string | null;
  expiryDate?: string | null;
}): StockItemDto {
  return {
    id: props.id ?? 次の在庫品の識別子(),
    name: props.name,
    ingredientId: props.ingredientId ?? null,
    amount: props.amount ?? null,
    expiryDate: props.expiryDate ?? null,
  };
}

/**
 * 在庫スナップショットに入れる献立側の在庫品1件。持つのは**名称・分量・期限の3項目**だけで
 * ある（ADR-037 決定1）。C-7 の一致はこの3つ組の多重集合で見るので、上の `在庫品` と同じ
 * 3項目を渡せば「在庫が変わっていない」回になる（ADR-037 決定2）。
 */
function 献立側の在庫品(props: {
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
function 主材料(name: string) {
  return createMealIngredient({ name, kind: 'main', amount: null });
}

/** 調味料。充足の突き合わせには載らない側（C-16 / ADR-023）。 */
function 調味料(name: string, amount: string) {
  return createMealIngredient({ name, kind: 'seasoning', amount: amountOf(amount) });
}

/**
 * 生成器が返す生成結果1件。本題でない値を隠す（`docs/testing.md` 6章）。既定は
 * 主材料1件・手順1件で、識別子も世帯も生成日時も持たない（ADR-035 / C-1）。
 */
function 生成結果(
  overrides: Partial<Parameters<typeof createGeneratedMeal>[0]> = {},
): GeneratedMeal {
  return createGeneratedMeal({
    title: 'ごま和え',
    ingredients: [主材料('にんじん')],
    steps: [cookingStepOf('和える')],
    ...overrides,
  });
}

/**
 * 期限が1日ずつずれた在庫4件。下の `期限のずれた在庫で作れる献立たち` と組にすると、C-12 の順が
 * A→B→C→D に閉じる（既存の「作れる献立が4件あるとき」と同じ組み合わせ）。
 */
function 期限のずれた在庫(): StockItemDto[] {
  return [
    在庫品({ name: '豚肉', expiryDate: '2026-09-15' }),
    在庫品({ name: 'にんじん', expiryDate: '2026-09-16' }),
    在庫品({ name: 'たまねぎ', expiryDate: '2026-09-17' }),
    在庫品({ name: 'じゃがいも', expiryDate: '2026-09-18' }),
  ];
}

/** 上の在庫で作れる献立4件。並びは C-12 の順とわざと違えてある（先頭が C）。 */
function 期限のずれた在庫で作れる献立たち(): Meal[] {
  return [
    献立({ id: mealIdOf(識別子C), title: '肉じゃが', ingredients: [主材料('たまねぎ')] }),
    献立({ id: mealIdOf(識別子A), title: '生姜焼き', ingredients: [主材料('豚肉')] }),
    献立({ id: mealIdOf(識別子D), title: 'ポトフ', ingredients: [主材料('じゃがいも')] }),
    献立({ id: mealIdOf(識別子B), title: 'きんぴら', ingredients: [主材料('にんじん')] }),
  ];
}

/** 本題が提案の識別子でないときの採番。発行器が出す `提案の識別子` と別の値にしてある。 */
let 提案の連番 = 0;
function 次の提案の識別子() {
  提案の連番 += 1;
  return `66666666-6666-4666-8666-${String(提案の連番).padStart(12, '0')}`;
}

/**
 * 事前に置いておく提案1回ぶん。除外に効くのは `entries` の献立の識別子だけなので、
 * **在庫スナップショットの既定は空である**（C-11 / 規則7）。
 *
 * **C-7 の比較が本題の回だけ `在庫スナップショット` を渡す。** 既定を空のままにしてあるのは、
 * 在庫が1件以上あるテストが意図せず短絡を通らないようにするためである（B-28 設計書 11章）。
 */
function 保存済みの提案(props: {
  献立の識別子たち: readonly string[];
  householdId?: HouseholdId;
  origin?: SuggestionEntryOrigin;
  generatedAt?: string;
  在庫スナップショット?: readonly StockItem[];
}): Suggestion {
  return createSuggestion({
    id: suggestionIdOf(次の提案の識別子()),
    householdId: props.householdId ?? 我が家,
    entries: props.献立の識別子たち.map((献立の識別子) =>
      createSuggestionEntry({ mealId: mealIdOf(献立の識別子), origin: props.origin ?? 'reused' }),
    ),
    pantrySnapshot: createPantrySnapshot({ stockItems: props.在庫スナップショット ?? [] }),
    generatedAt: dateTimeOf(props.generatedAt ?? '2026-09-13T12:00:00Z'),
  });
}

/** 本題でない値を隠して献立を作る。既定は我が家の、主材料1件・手順1件・調理記録なし。 */
function 献立(overrides: Partial<Parameters<typeof createMeal>[0]> = {}): Meal {
  return createMeal({
    id: mealIdOf(識別子A),
    householdId: 我が家,
    title: '肉じゃが',
    ingredients: [主材料('にんじん')],
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
function 作れない献立(props: {
  id: string;
  title: string;
  generatedAt?: string;
  householdId?: HouseholdId;
}): Meal {
  return 献立({
    id: mealIdOf(props.id),
    householdId: props.householdId ?? 我が家,
    title: props.title,
    ingredients: [主材料('豚肉')],
    generatedAt: dateTimeOf(props.generatedAt ?? '2026-09-13T12:00:00Z'),
  });
}

/** 番号から作る献立の識別子。上の3つ（A〜D）とは別の並びに置いてある。 */
function 番号つきの献立の識別子(番号: number): string {
  return `77777777-7777-4777-8777-${String(番号).padStart(12, '0')}`;
}

/**
 * 名称も生成日時も異なる献立を `件数` 件つくる。**`maxAvoidTitles` の確認に使う**
 * （B-28 規則8 / prompt-design D-6・論点4）。
 *
 * `献立01` が最も新しく、番号が1つ増えるごとに生成日時が1分だけ古くなる。上限で落ちるのが
 * 古いほうであることを、名称の番号だけで読めるようにするためである。どれも `作れない献立`
 * なので、件数が増えても再利用の経路には載らない。
 */
function 名称も生成日時も異なる献立たち(件数: number): Meal[] {
  return Array.from({ length: 件数 }, (_, 添字) =>
    作れない献立({
      id: 番号つきの献立の識別子(添字 + 1),
      title: `献立${String(添字 + 1).padStart(2, '0')}`,
      generatedAt: `2026-09-13T12:${String(59 - 添字).padStart(2, '0')}:00Z`,
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
 */
function 準備(
  props: {
    在庫?: readonly StockItemDto[];
    献立たち?: readonly Meal[];
    直近の提案?: readonly Suggestion[];
    生成結果たち?: readonly GeneratedMeal[];
    発行する献立の識別子?: readonly string[];
    献立の保存が投げる?: 保存の失敗;
    発行する識別子?: readonly string[];
    在庫の一覧が投げる例外?: Error;
    直近の取得が投げる例外?: Error;
    最新の取得が投げる例外?: Error;
  } = {},
) {
  const 在庫の一覧 = new 記憶上の在庫品の一覧(
    props.在庫の一覧が投げる例外 === undefined
      ? { 返す出力: { stockItems: [...(props.在庫 ?? [])] } }
      : { 投げる例外: props.在庫の一覧が投げる例外 },
  );
  const mealRepository =
    props.献立の保存が投げる === undefined
      ? new 記憶上の献立リポジトリ(...(props.献立たち ?? []))
      : 記憶上の献立リポジトリ.保存が途中で投げるもの(
          props.献立の保存が投げる,
          ...(props.献立たち ?? []),
        );
  const suggestionRepository = new 記憶上の提案リポジトリ({
    ...(props.直近の取得が投げる例外 === undefined
      ? {}
      : { 直近の取得が投げる例外: props.直近の取得が投げる例外 }),
    ...(props.最新の取得が投げる例外 === undefined
      ? {}
      : { 最新の取得が投げる例外: props.最新の取得が投げる例外 }),
  });
  // 前提の提案は**`提案する` を通さずリポジトリへ直接積む。** 1回の呼び出しでは生成日時も
  // 提案の識別子も1つしか作れず、直近3回より前の提案を置けないためである（C-11）。
  // 記憶上の実装は配列へ積むだけなので、待たずとも積み終わっている。
  for (const 提案 of props.直近の提案 ?? []) {
    void suggestionRepository.save(提案.householdId, 提案);
  }
  const mealGenerator = new 記憶上の献立生成器(...(props.生成結果たち ?? []));
  const 提案する = suggestMeals({
    listStockItems: 在庫の一覧.一覧する,
    mealRepository,
    suggestionRepository,
    mealGenerator,
    generateMealId: 記憶上の献立識別子発行器(props.発行する献立の識別子 ?? []),
    generateSuggestionId: 記憶上の提案識別子発行器(props.発行する識別子 ?? [提案の識別子]),
  });

  return { mealRepository, suggestionRepository, mealGenerator, 提案する };
}

/** 返した提案が並べる献立の識別子。並びが本題なので集合にしない。 */
const 献立の識別子の並び = (提案: SuggestMealsOutput) => 提案.entries.map((entry) => entry.mealId);

describe('献立を提案する SuggestMeals', () => {
  it('在庫で作れる献立が1件あれば、その1件を再利用した提案を返す', async () => {
    // FR-34 / FR-16 / 規則9: 在庫で作れる既存の献立をそのまま並べる。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子A]);
  });

  it('在庫に無い主材料を含む献立は、提案に入らない', async () => {
    // C-10 / 規則2: 再利用の対象は不足0件のものだけ。「ほぼ作れる」は使わない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [
        献立({ id: mealIdOf(識別子A), title: '肉じゃが', ingredients: [主材料('にんじん')] }),
        献立({ id: mealIdOf(識別子B), title: '生姜焼き', ingredients: [主材料('豚肉')] }),
      ],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子A]);
  });

  it('提案の1件は、献立リポジトリが返した順ではなく C-12 の順に並ぶ', async () => {
    // C-12 / ADR-036 決定4 / 規則6(a): 期限の近い在庫を使う献立が上に来る。
    const { 提案する } = 準備({
      在庫: [
        在庫品({ name: 'にんじん', expiryDate: '2026-09-20' }),
        在庫品({ name: '豚肉', expiryDate: '2026-09-15' }),
      ],
      献立たち: [
        献立({ id: mealIdOf(識別子A), title: '肉じゃが', ingredients: [主材料('にんじん')] }),
        献立({ id: mealIdOf(識別子B), title: '生姜焼き', ingredients: [主材料('豚肉')] }),
      ],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子B, 識別子A]);
  });

  it('作れる献立が4件あるときは、C-12 の順で上位3件だけを採る', async () => {
    // FR-16 / C-15 / 規則6(c)・10: 上限は3件。切るのはこのユースケースである。
    const 作れる献立たち = [
      献立({ id: mealIdOf(識別子C), title: '肉じゃが', ingredients: [主材料('たまねぎ')] }),
      献立({ id: mealIdOf(識別子A), title: '生姜焼き', ingredients: [主材料('豚肉')] }),
      献立({ id: mealIdOf(識別子D), title: 'ポトフ', ingredients: [主材料('じゃがいも')] }),
      献立({ id: mealIdOf(識別子B), title: 'きんぴら', ingredients: [主材料('にんじん')] }),
    ];
    const { 提案する } = 準備({
      在庫: [
        在庫品({ name: '豚肉', expiryDate: '2026-09-15' }),
        在庫品({ name: 'にんじん', expiryDate: '2026-09-16' }),
        在庫品({ name: 'たまねぎ', expiryDate: '2026-09-17' }),
        在庫品({ name: 'じゃがいも', expiryDate: '2026-09-18' }),
      ],
      献立たち: 作れる献立たち,
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子A, 識別子B, 識別子C]);
  });

  it('提案の1件は、すべて由来が再利用になる', async () => {
    // FR-35 / C-15 / 規則9: 生成と混ぜない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' }), 在庫品({ name: '豚肉' })],
      献立たち: [
        献立({ id: mealIdOf(識別子A), title: '肉じゃが', ingredients: [主材料('にんじん')] }),
        献立({ id: mealIdOf(識別子B), title: '生姜焼き', ingredients: [主材料('豚肉')] }),
      ],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案.entries.map((entry) => entry.origin)).toEqual(['reused', 'reused']);
  });

  it('提案の識別子は、提案の識別子発行器が出した値になる', async () => {
    // ADR-026 / 規則12: 採番はポートの仕事で、本体は乱数を読まない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
      発行する識別子: ['suggestion-1'],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案.id).toBe('suggestion-1');
  });

  it('提案の生成日時は、引数の基準日時を正規化した値になる', async () => {
    // 規則12 / `docs/testing.md` 5章: 現在時刻を読まず、渡された瞬間を UTC の正準形にする。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
    });

    const 提案 = await 提案する(我が家, '2026-09-14T12:00:00+09:00');

    expect(提案.generatedAt).toBe('2026-09-14T03:00:00.000Z');
  });

  it('再利用だけで組めた提案も保存し、同じ識別子で取り出せる', async () => {
    // C-14 / 規則11: 保存の確認は取得を通して行う（`docs/testing.md` 3章）。
    const { 提案する, suggestionRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    // 取り出した側を配列のまま比べる。1件も保存されなければ `[]` になり、
    // 提案が `null` でも `[undefined]` と食い違うので、どちらも緑にならない。
    const 取り出したもの = await suggestionRepository.findRecentByHousehold(我が家, 3);
    expect(取り出したもの.map((保存された提案) => 保存された提案.id)).toEqual([提案.id]);
  });

  it('保存された提案の1件は、返した出力と同じ献立を同じ並びで持つ', async () => {
    // FR-35 / C-12 / 規則16: 返すのは保存した提案を写したものである。
    const { 提案する, suggestionRepository } = 準備({
      在庫: [
        在庫品({ name: 'にんじん', expiryDate: '2026-09-20' }),
        在庫品({ name: '豚肉', expiryDate: '2026-09-15' }),
        在庫品({ name: 'たまねぎ', expiryDate: '2026-09-17' }),
      ],
      献立たち: [
        献立({ id: mealIdOf(識別子A), title: '肉じゃが', ingredients: [主材料('にんじん')] }),
        献立({ id: mealIdOf(識別子B), title: '生姜焼き', ingredients: [主材料('豚肉')] }),
        献立({ id: mealIdOf(識別子C), title: 'きんぴら', ingredients: [主材料('たまねぎ')] }),
      ],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    // 既定値を左右でずらす。両方とも「無い」ときに緑にならないようにするためである。
    const 取り出したもの = (await suggestionRepository.findRecentByHousehold(我が家, 3))[0];
    expect(取り出したもの?.entries.map((entry) => entry.mealId)).toEqual(
      献立の識別子の並び(提案) ?? [],
    );
  });

  it('在庫スナップショットの在庫品は、名称・分量・期限だけを持つ', async () => {
    // ADR-037 決定1 / ADR-033 決定3 / 規則2: 識別子も食材の指定も献立側へ持ち込まない。
    const { 提案する, suggestionRepository } = 準備({
      在庫: [
        在庫品({
          id: '00000000-0000-4000-8000-000000009999',
          name: 'にんじん',
          ingredientId: 'ingredient-1',
          amount: '1本',
          expiryDate: '2026-09-20',
        }),
      ],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
    });

    await 提案する(我が家, 基準日時);

    const 取り出したもの = (await suggestionRepository.findRecentByHousehold(我が家, 3))[0];
    expect(取り出したもの?.pantrySnapshot.stockItems).toEqual([
      createStockItem({
        name: 'にんじん',
        amount: amountOf('1本'),
        expiryDate: expiryDateOf('2026-09-20'),
      }),
    ]);
  });

  it('分量と期限が未設定の在庫品は、未設定のまま在庫スナップショットに入る', async () => {
    // ADR-010 / 規則3: 既定値の補完をしない。未設定の表し方は `null` の1つだけである。
    const { 提案する, suggestionRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん', amount: null, expiryDate: null })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
    });

    await 提案する(我が家, 基準日時);

    const 取り出したもの = (await suggestionRepository.findRecentByHousehold(我が家, 3))[0];
    expect(取り出したもの?.pantrySnapshot.stockItems).toEqual([
      createStockItem({ name: 'にんじん', amount: null, expiryDate: null }),
    ]);
  });

  it('在庫の名称の前後の空白は、在庫スナップショットでは落ちている', async () => {
    // C-6 / 規則3: 正規化はドメインが持つ。ユースケースでは trim しない。
    const { 提案する, suggestionRepository } = 準備({
      在庫: [在庫品({ name: '  にんじん  ' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
    });

    await 提案する(我が家, 基準日時);

    const 取り出したもの = (await suggestionRepository.findRecentByHousehold(我が家, 3))[0];
    expect(取り出したもの?.pantrySnapshot.stockItems.map((品) => 品.name)).toEqual(['にんじん']);
  });

  it('献立が使わない在庫品も、在庫スナップショットに入る', async () => {
    // C-7 / 規則4・13: スナップショットはその時点の在庫の複製であり、使った分だけではない。
    const { 提案する, suggestionRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' }), 在庫品({ name: 'ヨーグルト' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
    });

    await 提案する(我が家, 基準日時);

    const 取り出したもの = (await suggestionRepository.findRecentByHousehold(我が家, 3))[0];
    expect(取り出したもの?.pantrySnapshot.stockItems.map((品) => 品.name)).toEqual([
      'にんじん',
      'ヨーグルト',
    ]);
  });

  it('名称も分量も期限も同じ在庫品が2件あれば、在庫スナップショットにも2件入る', async () => {
    // C-7（多重集合）/ ADR-007 / 規則2: 同じ食材でも在庫品を統合しない。
    const { 提案する, suggestionRepository } = 準備({
      在庫: [
        在庫品({ name: 'たまご', amount: '6個', expiryDate: '2026-09-20' }),
        在庫品({ name: 'たまご', amount: '6個', expiryDate: '2026-09-20' }),
      ],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('たまご')] })],
    });

    await 提案する(我が家, 基準日時);

    const 取り出したもの = (await suggestionRepository.findRecentByHousehold(我が家, 3))[0];
    expect(取り出したもの?.pantrySnapshot.stockItems).toHaveLength(2);
  });

  it('在庫スナップショットは、在庫の一覧が返した並びのまま持つ', async () => {
    // 規則5 / B-05 規則7: このユースケースは在庫を並べ替えない。
    const { 提案する, suggestionRepository } = 準備({
      在庫: [在庫品({ name: '豚肉' }), 在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
    });

    await 提案する(我が家, 基準日時);

    const 取り出したもの = (await suggestionRepository.findRecentByHousehold(我が家, 3))[0];
    expect(取り出したもの?.pantrySnapshot.stockItems.map((品) => 品.name)).toEqual([
      '豚肉',
      'にんじん',
    ]);
  });

  it('別の世帯の献立は再利用しない', async () => {
    // C-9 / 規則1: 献立の取得にも第1引数の世帯を渡す。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [
        献立({ id: mealIdOf(識別子A), title: '肉じゃが', ingredients: [主材料('にんじん')] }),
        // 我が家の在庫で作れるが、持ち主が違う。除かれる理由は世帯だけである。
        献立({
          id: mealIdOf(識別子B),
          householdId: 隣の家,
          title: 'きんぴら',
          ingredients: [主材料('にんじん')],
        }),
      ],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子A]);
  });

  it('別の世帯の在庫は、作れるかどうかの判定に使わない', async () => {
    // C-9 / 規則1: 在庫の一覧にも第1引数の世帯を渡す。
    // 在庫の一覧の代役は決まった出力を返すので、隣の家の在庫を別に持たせられない。
    // **隣の家の豚肉がユースケースに届く経路が無いこと**を、豚肉でしか作れない献立B が
    // 提案に入らないことで見る。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [
        献立({ id: mealIdOf(識別子A), title: '肉じゃが', ingredients: [主材料('にんじん')] }),
        献立({ id: mealIdOf(識別子B), title: '生姜焼き', ingredients: [主材料('豚肉')] }),
      ],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子A]);
  });

  it('保存した提案は、別の世帯からは取り出せない', async () => {
    // C-9 / 規則1: 保存にも第1引数の世帯を渡す。
    const { 提案する, suggestionRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
    });

    await 提案する(我が家, 基準日時);

    expect(await suggestionRepository.findRecentByHousehold(隣の家, 3)).toEqual([]);
  });

  it('提案を組んでも、献立リポジトリが保持している献立の並びは変わらない', async () => {
    // 規則17 / ADR-009: リポジトリが返した列をその場で並べ替えない。
    const { 提案する, mealRepository } = 準備({
      在庫: [
        在庫品({ name: 'にんじん', expiryDate: '2026-09-20' }),
        在庫品({ name: '豚肉', expiryDate: '2026-09-15' }),
      ],
      献立たち: [
        献立({ id: mealIdOf(識別子A), title: '肉じゃが', ingredients: [主材料('にんじん')] }),
        献立({ id: mealIdOf(識別子B), title: '生姜焼き', ingredients: [主材料('豚肉')] }),
      ],
    });

    await 提案する(我が家, 基準日時);

    const 保持されているもの = await mealRepository.findByHousehold(我が家);
    expect(保持されているもの.map((保持された献立) => 保持された献立.id)).toEqual([
      識別子A,
      識別子B,
    ]);
  });

  it('直近の提案に出した献立は、再利用の対象から外れる', async () => {
    // C-11 / FR-37 / 規則7: 在庫が動かない期間ずっと同じ献立が出続けないようにする。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' }), 在庫品({ name: '豚肉' })],
      献立たち: [
        献立({ id: mealIdOf(識別子A), title: '肉じゃが', ingredients: [主材料('にんじん')] }),
        献立({ id: mealIdOf(識別子B), title: '生姜焼き', ingredients: [主材料('豚肉')] }),
      ],
      直近の提案: [保存済みの提案({ 献立の識別子たち: [識別子A], origin: 'reused' })],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子B]);
  });

  it('除外は由来を問わず、生成で出した献立も再利用の対象から外れる', async () => {
    // C-4c / 規則7: `origin` は経路の印であって、除外の可否を決めるものではない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' }), 在庫品({ name: '豚肉' })],
      献立たち: [
        献立({ id: mealIdOf(識別子A), title: '肉じゃが', ingredients: [主材料('にんじん')] }),
        献立({ id: mealIdOf(識別子B), title: '生姜焼き', ingredients: [主材料('豚肉')] }),
      ],
      直近の提案: [保存済みの提案({ 献立の識別子たち: [識別子A], origin: 'generated' })],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子B]);
  });

  it('1回の提案が並べた献立は、その全件が除外の対象になる', async () => {
    // 規則7: 落とすのは `entries` に現れる献立すべてであり、先頭の1件だけではない。
    const { 提案する } = 準備({
      在庫: 期限のずれた在庫(),
      献立たち: 期限のずれた在庫で作れる献立たち(),
      直近の提案: [保存済みの提案({ 献立の識別子たち: [識別子A, 識別子B, 識別子C] })],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子D]);
  });

  it('除外してから上位3件を採るので、除外がなければ3件に入らなかった献立が繰り上がる', async () => {
    // ADR-036 決定4・結果7 / 規則6: 順は「並べる → 除外する → 切る」。先に切ると D を取り戻せない。
    const { 提案する } = 準備({
      在庫: 期限のずれた在庫(),
      献立たち: 期限のずれた在庫で作れる献立たち(),
      直近の提案: [保存済みの提案({ 献立の識別子たち: [識別子A] })],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子B, 識別子C, 識別子D]);
  });

  it('直近3回より前の提案に出した献立は、除外されない', async () => {
    // C-11 / 規則8: 見るのは直近3回だけ。4回前に出た D は再び再利用できる。
    // 生成日時を互いにずらすのは、直近3回の選び取りが同時刻の決着（`SuggestionId` の
    // 降順）に寄りかからないようにするためである（B-27 10章）。
    const { 提案する } = 準備({
      在庫: 期限のずれた在庫(),
      献立たち: 期限のずれた在庫で作れる献立たち(),
      直近の提案: [
        保存済みの提案({ 献立の識別子たち: [識別子D], generatedAt: '2026-09-10T12:00:00Z' }),
        保存済みの提案({ 献立の識別子たち: [識別子C], generatedAt: '2026-09-11T12:00:00Z' }),
        保存済みの提案({ 献立の識別子たち: [識別子B], generatedAt: '2026-09-12T12:00:00Z' }),
        保存済みの提案({ 献立の識別子たち: [識別子A], generatedAt: '2026-09-13T12:00:00Z' }),
      ],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子D]);
  });

  it('別の世帯の提案は、除外に使わない', async () => {
    // C-9 / 規則1: 直近の提案の取得にも第1引数の世帯を渡す。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
      直近の提案: [保存済みの提案({ householdId: 隣の家, 献立の識別子たち: [識別子A] })],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子A]);
  });

  // ここから生成の経路（B-28 1周目）。**再利用で採れたものが0件のときに通る道**であり、
  // 以前この位置にあった「null を返す」5件は、生成へ回る経路として意味が変わったものである
  // （B-28 設計書 10章。テストが壊れたのではなく仕様が変わった）。

  it('在庫で作れる献立が1件も無いときは、生成した献立を並べた提案を返す', async () => {
    // B-28 規則2・16 / C-15 / NFR-C1b: 作れるものが0件でも提案を返す。組めない回を作らない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子B), title: '生姜焼き', ingredients: [主材料('豚肉')] })],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子C],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子C]);
  });

  it('直近の提案による除外の結果0件になったときも、生成した献立を並べた提案を返す', async () => {
    // B-28 規則2・16 / C-11 / C-15: 除外で空になった回も生成へ回る。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
      直近の提案: [保存済みの提案({ 献立の識別子たち: [識別子A] })],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子C],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子C]);
  });

  it('在庫が0件のときも、生成した献立を並べた提案を返す', async () => {
    // B-28 規則2・16 / NFR-C1b: 在庫が空でも例外にしない。在庫の下限で生成を控える判断は
    // この周の外である（B-28 設計書 10章）。**前提の提案は置かない** — 在庫も前提の提案の
    // 在庫スナップショットも空だと、C-7 の短絡（2周目）を意図せず通ってしまう。
    const { 提案する } = 準備({
      在庫: [],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子C],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子C]);
  });

  it('保持している献立が0件のときも、生成した献立を並べた提案を返す', async () => {
    // B-28 規則2・16 / C-15: 再利用できる献立がまだ1件も無い世帯は、生成だけで始まる。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子C],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子C]);
  });

  it('生成が1件しか返せなくても、その1件で提案を組む', async () => {
    // B-28 規則14 / C-15: 求めるのは3件だが、通った件数でそのまま組む。再生成も再試行もしない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子C],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子C]);
  });

  it('生成が3件返したときは、3件すべてが提案に並ぶ', async () => {
    // FR-16 / C-2 / B-28 規則9: 採用した全件を並べる。採らずに捨てるものを作らない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [
        生成結果({ title: '肉じゃが' }),
        生成結果({ title: '生姜焼き' }),
        生成結果({ title: 'きんぴら' }),
      ],
      発行する献立の識別子: [識別子A, 識別子B, 識別子C],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子A, 識別子B, 識別子C]);
  });

  it('生成が返した並びのまま提案に並び、C-12 の順に並べ替えない', async () => {
    // C-2 / B-28 規則9: 並びを決めるのは生成の側である。C-12 は再利用の並びの規則であり、
    // これに当てはめると期限の近い豚肉を使う 生姜焼き が先に来て、逆順になる。
    const { 提案する } = 準備({
      在庫: [
        在庫品({ name: '豚肉', expiryDate: '2026-09-15' }),
        在庫品({ name: 'にんじん', expiryDate: '2026-09-20' }),
      ],
      献立たち: [],
      生成結果たち: [
        生成結果({ title: 'きんぴら', ingredients: [主材料('にんじん')] }),
        生成結果({ title: '生姜焼き', ingredients: [主材料('豚肉')] }),
      ],
      発行する献立の識別子: [識別子A, 識別子B],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子A, 識別子B]);
  });

  it('生成の経路で組んだ提案の1件は、すべて由来が生成になる', async () => {
    // C-4c / C-15 / FR-35 / B-28 規則13 の前半: 生成の経路の1件に再利用の印を混ぜない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [生成結果({ title: '肉じゃが' }), 生成結果({ title: '生姜焼き' })],
      発行する献立の識別子: [識別子A, 識別子B],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案.entries.map((entry) => entry.origin)).toEqual(['generated', 'generated']);
  });

  it('生成した献立は献立リポジトリに保存され、次の取得で見える', async () => {
    // C-1 / B-28 規則12: 変換した時点で保存する。保存の確認は取得を通して行う
    // （`docs/testing.md` 3章）。
    const { 提案する, mealRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [生成結果({ title: 'ごま和え' })],
      発行する献立の識別子: [識別子C],
    });

    await 提案する(我が家, 基準日時);

    const 保持されているもの = await mealRepository.findByHousehold(我が家);
    expect(保持されているもの.map((保存された献立) => 保存された献立.title)).toEqual(['ごま和え']);
  });

  it('保存された献立の識別子は、献立の識別子発行器が出した値になる', async () => {
    // ADR-026 / B-28 規則12: 採番はポートの仕事で、本体は乱数を読まない。
    const { 提案する, mealRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子C],
    });

    await 提案する(我が家, 基準日時);

    const 保持されているもの = await mealRepository.findByHousehold(我が家);
    expect(保持されているもの.map((保存された献立) => 保存された献立.id)).toEqual([識別子C]);
  });

  it('献立の識別子は、生成結果の並び順に発行される', async () => {
    // B-28 規則12 / C-12 の決定性: 発行の順が生成の並びからずれると、同じ入力でも
    // 名称と識別子の対応が回ごとに変わる。
    // **取り出した列の並びには依らず、名称と識別子の対応だけを見る** — `findByHousehold` は
    // 全件を返す口であり並び順を約束しないので、並びを断定すると振る舞いが同じまま
    // 実装の差し替えで赤くなる（CLAUDE.md の依存の規則 / `docs/testing.md` 3章）。
    const { 提案する, mealRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [生成結果({ title: '肉じゃが' }), 生成結果({ title: '生姜焼き' })],
      発行する献立の識別子: [識別子A, 識別子B],
    });

    await 提案する(我が家, 基準日時);

    const 保持されているもの = await mealRepository.findByHousehold(我が家);
    expect(
      Object.fromEntries(
        保持されているもの.map((保存された献立) => [保存された献立.title, 保存された献立.id]),
      ),
    ).toEqual({ 肉じゃが: 識別子A, 生姜焼き: 識別子B });
  });

  it('保存された献立は、生成結果の材料と手順をそのまま持つ', async () => {
    // C-5 / B-28 規則12: 材料は在庫品を指さず文字列として複製し、手順は並びのまま持つ。
    const { 提案する, mealRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [
        生成結果({
          title: 'ごま和え',
          ingredients: [主材料('にんじん'), 主材料('ほうれん草'), 調味料('ごま', '大さじ1')],
          steps: [cookingStepOf('ゆでる'), cookingStepOf('和える')],
        }),
      ],
      発行する献立の識別子: [識別子C],
    });

    await 提案する(我が家, 基準日時);

    const 取り出したもの = (await mealRepository.findByHousehold(我が家))[0];
    expect(取り出したもの?.ingredients).toEqual([
      createMealIngredient({ name: 'にんじん', kind: 'main', amount: null }),
      createMealIngredient({ name: 'ほうれん草', kind: 'main', amount: null }),
      createMealIngredient({ name: 'ごま', kind: 'seasoning', amount: amountOf('大さじ1') }),
    ]);
    expect(取り出したもの?.steps).toEqual(['ゆでる', '和える']);
  });

  it('生成の経路で保存した献立は、別の世帯からは取り出せない', async () => {
    // C-9 / B-28 規則12: 保存にも第1引数の世帯を渡し、献立にも同じ世帯を持たせる。
    const { 提案する, mealRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子C],
    });

    await 提案する(我が家, 基準日時);

    expect(await mealRepository.findByHousehold(隣の家)).toEqual([]);
  });

  it('生成の経路で組んだ提案も保存し、同じ識別子で取り出せる', async () => {
    // C-14 / B-28 規則15: 生成でも記録に残す。残さないと C-7 と C-11 が次の回で効かない。
    const 事前の提案 = 保存済みの提案({ 献立の識別子たち: [識別子A] });
    const { 提案する, suggestionRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
      直近の提案: [事前の提案],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子C],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    // 新しい提案のほうが生成日時が新しいので先に並ぶ。1件も保存されなければ `[]` になり、
    // どちらの側とも食い違う。
    const 取り出したもの = await suggestionRepository.findRecentByHousehold(我が家, 3);
    expect(取り出したもの.map((保存された提案) => 保存された提案.id)).toEqual([
      提案.id,
      事前の提案.id,
    ]);
  });

  // ここから C-7 の短絡（B-28 2周目 / 規則1）。**在庫が最新の提案のときから変わっていなければ、
  // 献立も直近3回の提案も引かず、提案を組まず、保存もしない。** 比べる相手は
  // `保存済みの提案` の `在庫スナップショット` で渡す — 既定は空なので、上の it たちは
  // 在庫が1件でもあれば短絡を通らない。

  it('在庫が最新の提案のときから変わっていなければ、保存済みの提案の識別子をそのまま返す', async () => {
    // C-7 / FR-21 / B-28 規則1: 在庫が動いていない日は作り直さない（NFR-C1）。
    const 事前の提案 = 保存済みの提案({
      献立の識別子たち: [識別子A],
      在庫スナップショット: [
        献立側の在庫品({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' }),
      ],
    });
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' })],
      献立たち: [],
      直近の提案: [事前の提案],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案.id).toBe(事前の提案.id);
  });

  it('在庫が変わっていなければ、作れる献立があっても保存済みの提案が並べた献立を返す', async () => {
    // FR-21 / C-7 / B-28 規則1: 短絡は再利用より先である。組み直すと、同じ在庫の日に
    // 違う献立（識別子A）が出て、画面の見え方が日によって変わる（screen-design S-3）。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
      直近の提案: [
        保存済みの提案({
          献立の識別子たち: [識別子D],
          在庫スナップショット: [献立側の在庫品({ name: 'にんじん' })],
        }),
      ],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子D]);
  });

  it('在庫が変わっていなければ、返す生成日時は保存済みの提案のもので、引数の基準日時ではない', async () => {
    // FR-21 / C-7: 返すのは新しく組んだ提案ではないので、生成日時も保存済みのままである。
    // 基準日時を正準化すると '2026-09-14T03:00:00.000Z' になり、取り違えれば食い違う。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' })],
      献立たち: [],
      直近の提案: [
        保存済みの提案({
          献立の識別子たち: [識別子A],
          generatedAt: '2026-09-13T12:00:00Z',
          在庫スナップショット: [
            献立側の在庫品({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' }),
          ],
        }),
      ],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案.generatedAt).toBe('2026-09-13T12:00:00.000Z');
  });

  it('在庫が変わっていなければ、保存済みの提案の由来をそのまま返す', async () => {
    // FR-35 / C-4c / screen-design S-3: 印は保存済みの提案が持つものであり、短絡した回に
    // 生成の印（`'generated'`）を被せない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' })],
      献立たち: [],
      直近の提案: [
        保存済みの提案({
          献立の識別子たち: [識別子A],
          origin: 'reused',
          在庫スナップショット: [
            献立側の在庫品({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' }),
          ],
        }),
      ],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案.entries.map((entry) => entry.origin)).toEqual(['reused']);
  });

  it('在庫が変わっていなければ、献立生成器を呼ばない', async () => {
    // C-7 / NFR-C1 / `docs/testing.md` 2章: 呼ばれないこと自体が要件なので、記憶上の実装の
    // **状態**として見る（`vi.fn()` を使わない）。**生成結果と発行する献立の識別子をわざと
    // 用意してある** — 既定の0件のままだと、誤って呼ばれた回が `mealGenerator.empty` で
    // 落ち、回数ではない理由で赤くなる。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      直近の提案: [
        保存済みの提案({
          献立の識別子たち: [識別子A],
          在庫スナップショット: [献立側の在庫品({ name: 'にんじん' })],
        }),
      ],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子C],
    });

    await 提案する(我が家, 基準日時);

    expect(mealGenerator.呼ばれた回数).toBe(0);
  });

  it('在庫が変わっていなければ、新しい提案を保存しない', async () => {
    // C-7 / C-11: 短絡した回を記録に残すと、次の回の除外が1回ぶん狂う。
    const 事前の提案 = 保存済みの提案({
      献立の識別子たち: [識別子A],
      在庫スナップショット: [献立側の在庫品({ name: 'にんじん' })],
    });
    const { 提案する, suggestionRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      直近の提案: [事前の提案],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子C],
    });

    await 提案する(我が家, 基準日時);

    const 取り出したもの = await suggestionRepository.findRecentByHousehold(我が家, 3);
    expect(取り出したもの.map((保存された提案) => 保存された提案.id)).toEqual([事前の提案.id]);
  });

  it('在庫が1件増えていれば短絡せず、新しく組んだ提案を返す', async () => {
    // C-7 / B-28 規則1: 一致しないときは再利用の経路へ進む。返る識別子は発行器が出した値で、
    // 保存済みの提案のものではない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' }), 在庫品({ name: '豚肉' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
      直近の提案: [
        保存済みの提案({
          献立の識別子たち: [識別子D],
          在庫スナップショット: [献立側の在庫品({ name: 'にんじん' })],
        }),
      ],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案.id).toBe(提案の識別子);
  });

  it('名称も分量も期限も同じ在庫品が1件から2件に増えた日は、短絡しない', async () => {
    // C-7（多重集合）/ ADR-037 決定2: 一致は3つ組の多重集合で見る。集合に畳むと、
    // 同じたまごをもう1パック足した日に「在庫は変わっていない」と判定してしまう。
    const たまご = { name: 'たまご', amount: '6個', expiryDate: '2026-09-20' };
    const { 提案する } = 準備({
      在庫: [在庫品(たまご), 在庫品(たまご)],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('たまご')] })],
      直近の提案: [
        保存済みの提案({
          献立の識別子たち: [識別子D],
          在庫スナップショット: [献立側の在庫品(たまご)],
        }),
      ],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案.id).toBe(提案の識別子);
  });

  it('2件前の提案の在庫と一致しても、短絡しない', async () => {
    // C-7: 見るのは最新の1件だけである。生成日時をずらして「最新」を一意にしてある。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
      直近の提案: [
        保存済みの提案({
          献立の識別子たち: [識別子D],
          generatedAt: '2026-09-12T12:00:00Z',
          在庫スナップショット: [献立側の在庫品({ name: 'にんじん' })],
        }),
        保存済みの提案({
          献立の識別子たち: [識別子D],
          generatedAt: '2026-09-13T12:00:00Z',
          在庫スナップショット: [献立側の在庫品({ name: '豚肉' })],
        }),
      ],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案.id).toBe(提案の識別子);
  });

  it('別の世帯の最新の提案は、在庫が変わったかどうかの判定に使わない', async () => {
    // C-9: 最新の提案の取得にも第1引数の世帯を渡す。我が家の提案は1件も無いので、
    // 比べる相手が無く、再利用の経路へ進む。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
      直近の提案: [
        保存済みの提案({
          householdId: 隣の家,
          献立の識別子たち: [識別子D],
          在庫スナップショット: [献立側の在庫品({ name: 'にんじん' })],
        }),
      ],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子A]);
  });

  it('在庫も最新の提案の在庫スナップショットも0件なら、保存済みの提案をそのまま返す', async () => {
    // C-7 / 境界: 0件どうしも「変わっていない」である。件数が0の回だけ別扱いにしない。
    const 事前の提案 = 保存済みの提案({ 献立の識別子たち: [識別子A], 在庫スナップショット: [] });
    const { 提案する } = 準備({ 在庫: [], 献立たち: [], 直近の提案: [事前の提案] });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案.id).toBe(事前の提案.id);
  });

  // C-15（B-28 2周目 / 規則2）。**再利用が成立した回に生成を呼ばない**こと自体が要件である。

  it('在庫で作れる献立が1件でもあれば、献立生成器を呼ばない', async () => {
    // C-15 / FR-34 / NFR-C1b / `docs/testing.md` 2章: 足りない分を生成で埋めない。
    // **生成結果と発行する献立の識別子をわざと用意してある** — 既定の0件のままだと、
    // 誤って呼ばれた回が `mealGenerator.empty` で落ち、回数ではない理由で赤くなる。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子C],
    });

    await 提案する(我が家, 基準日時);

    expect(mealGenerator.呼ばれた回数).toBe(0);
  });

  it('生成が1件も返せないときは、規則違反がそのまま呼び出し側へ伝わる', async () => {
    // B-28 7章1行目 / NFR-07: ポートが投げた違反を写さずそのまま伝える。
    // 既定の生成器は用意した生成結果が0件なので `mealGenerator.empty` を投げる。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
    });

    const 実行 = 提案する(我が家, 基準日時);

    await expect(実行).rejects.toThrow(MealRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'mealGenerator.empty' });
  });

  it('生成が1件も返せなかったときは、提案を保存しない', async () => {
    // C-14 の裏 / B-28 7章1行目: 組めなかった回を記録に残すと C-11 の除外が1回ぶん狂う。
    const { 提案する, suggestionRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
    });

    // 投げること自体は1つ上の it が見る。ここで受けるのは、未処理の拒否にしないためである。
    await 提案する(我が家, 基準日時).catch(() => undefined);

    expect(await suggestionRepository.findRecentByHousehold(我が家, 3)).toEqual([]);
  });

  it('献立の保存が途中で失敗したときは、提案を保存しない', async () => {
    // C-1 / C-14 の裏 / B-28 7章4行目: 保存に失敗した献立は提示しない。提案を先に保存すると、
    // 取り出せない献立を指す記録が残り、次の回の除外（C-11）も比較（C-7）もそれを引きずる。
    const { 提案する, suggestionRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [生成結果({ title: '肉じゃが' }), 生成結果({ title: '生姜焼き' })],
      発行する献立の識別子: [識別子A, 識別子B],
      献立の保存が投げる: {
        何件目の保存で投げるか: 2,
        投げる例外: new Error('献立の保存が落ちた'),
      },
    });

    // 呼び出しが失敗すること自体は前提である。ここで受けるのは、未処理の拒否にしないためである。
    await 提案する(我が家, 基準日時).catch(() => undefined);

    expect(await suggestionRepository.findRecentByHousehold(我が家, 3)).toEqual([]);
  });

  it('在庫の一覧が投げた例外は、写さずそのまま呼び出し側へ伝える', async () => {
    // 7章2行目 / ADR-033: 握りつぶさない。HTTP への写像は api の周の仕事である。
    const 用意した例外 = new Error('在庫の一覧が落ちた');
    const { 提案する } = 準備({ 在庫の一覧が投げる例外: 用意した例外 });

    const 実行 = 提案する(我が家, 基準日時);

    await expect(実行).rejects.toBe(用意した例外);
  });

  it('直近の提案の取得が投げた例外は、握りつぶさず呼び出し側へ伝える', async () => {
    // 7章2行目 / C-11: 除外に使う記録が引けないとき、除外なしの提案で埋め合わせない。
    const 用意した例外 = new Error('直近の提案の取得が落ちた');
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
      直近の取得が投げる例外: 用意した例外,
    });

    const 実行 = 提案する(我が家, 基準日時);

    await expect(実行).rejects.toBe(用意した例外);
  });

  it('最新の提案の取得が投げた例外は、握りつぶさず呼び出し側へ伝える', async () => {
    // B-28 7章2行目 / C-7: 比べる相手が引けないとき、比較なしの提案で埋め合わせない。
    // **投げる口を `直近の取得が投げる例外` と分けてある** — 1つにまとめると、上の it が
    // 短絡の手前で投げた例外を見ることになり、`findRecentByHousehold`（C-11 の除外の材料）の
    // 伝播を確かめなくなる（記憶上の提案リポジトリの注）。
    const 用意した例外 = new Error('最新の提案の取得が落ちた');
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      最新の取得が投げる例外: 用意した例外,
    });

    const 実行 = 提案する(我が家, 基準日時);

    await expect(実行).rejects.toBe(用意した例外);
  });

  it('名称が空白だけの在庫品があれば、ドメインの規則違反がそのまま出る', async () => {
    // 7章3行目 / 規則3: 正規化も判定もドメインが持つ。写す側で握って黙って落とさない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: '   ' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
    });

    const 実行 = 提案する(我が家, 基準日時);

    await expect(実行).rejects.toThrow(MealRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'stockItem.name.empty' });
  });

  it('期限の書式が YYYY-MM-DD でない在庫品があれば、ドメインの規則違反がそのまま出る', async () => {
    // 7章3行目 / 規則3: 書式の判定もドメインが持つ。写す側で直さない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん', expiryDate: '2026/09/20' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
    });

    const 実行 = 提案する(我が家, 基準日時);

    await expect(実行).rejects.toThrow(MealRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'expiryDate.format' });
  });

  // ここから生成に渡す入力（B-28 3周目 / 規則3〜8）。**観察するのは記憶上の献立生成器が
  // 状態として持つ `受け取った入力` である** — 渡したものは出口の向こうへ行ってしまい、
  // 呼び出しの返り値からは見えない。`vi.fn()` は使わない（`docs/testing.md` 2章）。
  //
  // どの回も**在庫を1件以上**置き、**保持している献立はその在庫では作れない**ものにしてある。
  // 前者は C-7 の短絡を通らないため、後者は再利用が0件のまま生成へ回るためである
  // （B-28 設計書 11章）。生成結果の名称は保持している献立と重ねない — 名称の完全一致で
  // 既存を参照する規則10 は次の周のものであり、重ねるとその未実装に寄りかかる。

  it('保持している献立の名称を、避けるべき名称として生成に渡す', async () => {
    // FR-42 / ADR-021 / B-28 規則6: 同じ献立をもう一度作らせないための材料を渡す。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [作れない献立({ id: 識別子A, title: '肉じゃが' })],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, 基準日時);

    expect(mealGenerator.受け取った入力?.avoidTitles).toEqual(['肉じゃが']);
  });

  it('生成に求める件数は3件である', async () => {
    // B-28 規則3 / ADR-022 / prompt-design 2.1: 1回の提案で並べる上限とは別の定数である。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, 基準日時);

    expect(mealGenerator.受け取った入力?.requiredCount).toBe(3);
  });

  it('生成に渡す在庫スナップショットは、献立が使わない在庫品も含めて在庫の全件を持つ', async () => {
    // B-28 規則4 / ADR-037 決定1: 渡すのはその時点の在庫の複製であり、使う分だけではない。
    const { 提案する, mealGenerator } = 準備({
      在庫: [
        在庫品({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' }),
        在庫品({ name: 'ヨーグルト' }),
      ],
      献立たち: [],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, 基準日時);

    expect(mealGenerator.受け取った入力?.pantrySnapshot.stockItems).toEqual([
      献立側の在庫品({ name: 'にんじん', amount: '1本', expiryDate: '2026-09-20' }),
      献立側の在庫品({ name: 'ヨーグルト' }),
    ]);
  });

  it('生成に渡した在庫スナップショットは、保存された提案が抱えるものと同じ内容である', async () => {
    // B-28 規則4 / ADR-037 決定1: 同じ在庫から2種類を組まない。組むと、生成の材料にした在庫と
    // 記録に残る在庫がずれ、次の回の C-7 の比較が別のものを見る。
    const { 提案する, mealGenerator, suggestionRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' }), 在庫品({ name: 'ヨーグルト' })],
      献立たち: [],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, 基準日時);

    // 件数も併せて断る。どちらも「無い」ときに緑にならないようにするためである。
    const 取り出したもの = (await suggestionRepository.findRecentByHousehold(我が家, 3))[0];
    expect(mealGenerator.受け取った入力?.pantrySnapshot.stockItems).toEqual(
      取り出したもの?.pantrySnapshot.stockItems,
    );
    expect(mealGenerator.受け取った入力?.pantrySnapshot.stockItems).toHaveLength(2);
  });

  it('生成に渡す基準日時は、引数を UTC の正準形にした値になる', async () => {
    // B-28 規則5 / `docs/testing.md` 5章: 現在時刻を読まず、渡された瞬間を正準化して渡す。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, '2026-09-14T12:00:00+09:00');

    expect(mealGenerator.受け取った入力?.asOf).toBe('2026-09-14T03:00:00.000Z');
  });

  it('生成した献立の生成日時は、生成に渡した基準日時と同じ値になる', async () => {
    // B-28 規則5 / C-1: 正準化は1度きりで、生成の入力にも新しい献立にも同じ値を使う。
    const { 提案する, mealRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, '2026-09-14T12:00:00+09:00');

    const 取り出したもの = (await mealRepository.findByHousehold(我が家))[0];
    expect(取り出したもの?.generatedAt).toBe('2026-09-14T03:00:00.000Z');
  });

  it('生成の経路で組んだ提案の生成日時も、同じ値になる', async () => {
    // B-28 規則5・15: 提案の生成日時も同じ1本から取る。経路で作り分けない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    const 提案 = await 提案する(我が家, '2026-09-14T12:00:00+09:00');

    expect(提案.generatedAt).toBe('2026-09-14T03:00:00.000Z');
  });

  it('避けるべき名称の先頭は、直前の提案に並んだ献立の名称である', async () => {
    // B-28 規則6 / FR-42 / prompt-design D-6: 直前に見たものを最も強く避ける。先頭に来るのは
    // 最新の提案が並べた きんぴら で、その後ろに保持している献立が新しい順で続く。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [
        作れない献立({ id: 識別子A, title: '肉じゃが', generatedAt: '2026-09-13T12:00:00Z' }),
        作れない献立({ id: 識別子B, title: '生姜焼き', generatedAt: '2026-09-12T12:00:00Z' }),
        作れない献立({ id: 識別子C, title: 'きんぴら', generatedAt: '2026-09-11T12:00:00Z' }),
      ],
      直近の提案: [
        保存済みの提案({ 献立の識別子たち: [識別子C], generatedAt: '2026-09-13T12:00:00Z' }),
        保存済みの提案({ 献立の識別子たち: [識別子B], generatedAt: '2026-09-12T12:00:00Z' }),
      ],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, 基準日時);

    expect(mealGenerator.受け取った入力?.avoidTitles).toEqual(['きんぴら', '肉じゃが', '生姜焼き']);
  });

  it('直前の提案が2件並べていたときは、その提案の並びのまま先頭に来る', async () => {
    // B-28 規則6 / C-12: 先頭の並びは提案の1件の並びそのままで、名称順に並べ替えない。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [
        作れない献立({ id: 識別子A, title: '肉じゃが', generatedAt: '2026-09-13T12:00:00Z' }),
        作れない献立({ id: 識別子B, title: '生姜焼き', generatedAt: '2026-09-12T12:00:00Z' }),
        作れない献立({ id: 識別子C, title: 'きんぴら', generatedAt: '2026-09-11T12:00:00Z' }),
      ],
      直近の提案: [保存済みの提案({ 献立の識別子たち: [識別子C, 識別子B] })],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, 基準日時);

    expect(mealGenerator.受け取った入力?.avoidTitles).toEqual(['きんぴら', '生姜焼き', '肉じゃが']);
  });

  it('直前の提案が無いときは、保持している献立の名称が生成日時の新しい順に並ぶ', async () => {
    // B-28 規則6 / ADR-038 決定1: 蓄積の側の並びは生成日時の新しい順である。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [
        作れない献立({ id: 識別子A, title: '肉じゃが', generatedAt: '2026-09-13T12:00:00Z' }),
        作れない献立({ id: 識別子B, title: '生姜焼き', generatedAt: '2026-09-12T12:00:00Z' }),
        作れない献立({ id: 識別子C, title: 'きんぴら', generatedAt: '2026-09-11T12:00:00Z' }),
      ],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, 基準日時);

    expect(mealGenerator.受け取った入力?.avoidTitles).toEqual(['肉じゃが', '生姜焼き', 'きんぴら']);
  });

  it('生成日時が同じ献立は、献立の識別子の降順で並ぶ', async () => {
    // B-28 規則6 / ADR-038 決定2 / C-12: 同時刻の決着をつけないと、同じ入力で並びが変わる。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [
        作れない献立({ id: 識別子A, title: '肉じゃが', generatedAt: '2026-09-13T12:00:00Z' }),
        作れない献立({ id: 識別子B, title: '生姜焼き', generatedAt: '2026-09-13T12:00:00Z' }),
      ],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, 基準日時);

    expect(mealGenerator.受け取った入力?.avoidTitles).toEqual(['生姜焼き', '肉じゃが']);
  });

  it('保持している献立が1件も無ければ、避けるべき名称は空のまま渡す', async () => {
    // B-28 規則6 の境界 / ADR-021: 避ける対象が無い回に、空でない何かを作らない。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, 基準日時);

    expect(mealGenerator.受け取った入力?.avoidTitles).toEqual([]);
  });

  it('別の世帯の献立の名称は、生成に渡す避けるべき名称に入らない', async () => {
    // C-9 / NFR-11: 外へ出すものに他の世帯のものを混ぜない。献立の取得に渡す世帯は
    // 第1引数のものである。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [
        作れない献立({ id: 識別子A, title: '肉じゃが' }),
        作れない献立({ id: 識別子B, title: '生姜焼き', householdId: 隣の家 }),
      ],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, 基準日時);

    expect(mealGenerator.受け取った入力?.avoidTitles).toEqual(['肉じゃが']);
  });

  it('避けるべき名称を組んでも、献立リポジトリが保持している献立の並びは変わらない', async () => {
    // B-28 規則17 / ADR-009: 生成日時の新しい順に並べるために、受け取った列をその場で
    // 並べ替えない。積んだのは旧→新の順なので、並べ替えれば取り出す順が入れ替わる。
    const { 提案する, mealRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [
        作れない献立({ id: 識別子A, title: '肉じゃが', generatedAt: '2026-09-11T12:00:00Z' }),
        作れない献立({ id: 識別子B, title: '生姜焼き', generatedAt: '2026-09-13T12:00:00Z' }),
      ],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子C],
    });

    await 提案する(我が家, 基準日時);

    const 保持されているもの = await mealRepository.findByHousehold(我が家);
    expect(保持されているもの.map((保持された献立) => 保持された献立.id)).toEqual([
      識別子A,
      識別子B,
      識別子C,
    ]);
  });

  it('直前の提案が指す献立を保持していないときは、その1件を落として残りを渡す', async () => {
    // B-28 規則7 / ADR-021 結果1 / ADR-008: 提案は識別子しか持たないので、名称は保持している
    // 献立から引く。引けないものは避けようがないので黙って落とす。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [作れない献立({ id: 識別子A, title: '肉じゃが' })],
      直近の提案: [保存済みの提案({ 献立の識別子たち: [識別子D, 識別子A] })],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子C],
    });

    await 提案する(我が家, 基準日時);

    // 空文字も `undefined` も混ざらない。落ちるのは引けなかった1件だけである。
    expect(mealGenerator.受け取った入力?.avoidTitles).toEqual(['肉じゃが']);
  });

  it('直前の提案が指す献立を1件も引けなくても、投げずに提案を返す', async () => {
    // B-28 規則7 / ADR-008: 避ける対象が引けないのは失敗ではない。避ける対象は努力目標であり、
    // 1件も組めなくても生成は成り立つ。**投げないことは、その先の断定が通ることで見る。**
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [作れない献立({ id: 識別子A, title: '肉じゃが' })],
      直近の提案: [保存済みの提案({ 献立の識別子たち: [識別子D] })],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子C],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子C]);
  });

  it('同じ名称の献立が2件保持されていても、避けるべき名称は1件になる', async () => {
    // B-28 規則8 / ADR-021 結果2: 同じ名称を2度送っても避ける効果は増えず、費用だけが増える。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [
        作れない献立({ id: 識別子A, title: '肉じゃが', generatedAt: '2026-09-13T12:00:00Z' }),
        作れない献立({ id: 識別子B, title: '肉じゃが', generatedAt: '2026-09-12T12:00:00Z' }),
      ],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, 基準日時);

    expect(mealGenerator.受け取った入力?.avoidTitles).toEqual(['肉じゃが']);
  });

  it('避けるべき名称が上限を超えるときは、生成日時の古いほうから落ちる', async () => {
    // B-28 規則8 / prompt-design D-6・論点4: 上限は費用の上限である。落ちるのは古いほうで、
    // 51件目の `献立51` が落ちて50件目の `献立50` は残る。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: 名称も生成日時も異なる献立たち(51),
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, 基準日時);

    const 避けるべき名称 = mealGenerator.受け取った入力?.avoidTitles ?? [];
    expect(避けるべき名称).not.toContain('献立51');
    expect(避けるべき名称).toContain('献立50');
  });

  it('直前の提案の献立名が保持している献立と重なっても、畳んでから切るので50件を渡す', async () => {
    // B-28 規則8: **畳んでから切る。** 先に切ると、重なった1件ぶん少ない49件になる。
    // 指すのは最も新しい `献立01` である — 重なりが上限の内側に来る置き方でないと、
    // 切る前でも後でも50件になり、順序の違いが見えない。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: 名称も生成日時も異なる献立たち(51),
      直近の提案: [保存済みの提案({ 献立の識別子たち: [番号つきの献立の識別子(1)] })],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, 基準日時);

    expect(mealGenerator.受け取った入力?.avoidTitles).toHaveLength(50);
  });

  it('蓄積が上限を超えても、直前の提案に並んだ献立の名称は残る', async () => {
    // FR-42 / prompt-design D-6 / B-28 規則8: 先頭が直前の提案なので、直前に見た献立は
    // 必ず残る。指すのは最も古い `献立51` で、蓄積の側だけなら上限で落ちる1件である。
    const { 提案する, mealGenerator } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: 名称も生成日時も異なる献立たち(51),
      直近の提案: [保存済みの提案({ 献立の識別子たち: [番号つきの献立の識別子(51)] })],
      生成結果たち: [生成結果()],
      発行する献立の識別子: [識別子D],
    });

    await 提案する(我が家, 基準日時);

    expect(mealGenerator.受け取った入力?.avoidTitles[0]).toBe('献立51');
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
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [作れない献立({ id: 識別子A, title: '肉じゃが' })],
      生成結果たち: [生成結果({ title: '肉じゃが' })],
      発行する献立の識別子: [識別子C],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子A]);
  });

  it('既存と一致した生成結果は、献立リポジトリに新しく保存されない', async () => {
    // C-4 / C-1 の裏 / B-28 規則10: 参照するだけなので、保持している献立は1件のままである。
    // 保存されていないことは取得を通して見る（`docs/testing.md` 3章）。
    const { 提案する, mealRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [作れない献立({ id: 識別子A, title: '肉じゃが' })],
      生成結果たち: [生成結果({ title: '肉じゃが' })],
      発行する献立の識別子: [識別子C],
    });

    await 提案する(我が家, 基準日時);

    const 保持されているもの = await mealRepository.findByHousehold(我が家);
    expect(保持されているもの.map((保存された献立) => 保存された献立.id)).toEqual([識別子A]);
  });

  it('生成結果がすべて既存の献立と一致した回も、提案の1件の由来は全件が生成になる', async () => {
    // C-4c / B-28 規則13 の後半: 既存を参照しても印は生成のままで、再利用に変えない。
    // **発行する献立の識別子を1件も用意しない** — 参照で済む1件にも識別子を発行する実装なら、
    // 発行器が尽きてその場で投げる（`docs/testing.md` 2章 と同じ、用意しないことで守る形）。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [
        作れない献立({ id: 識別子A, title: '肉じゃが' }),
        作れない献立({ id: 識別子B, title: '生姜焼き' }),
      ],
      生成結果たち: [生成結果({ title: '肉じゃが' }), 生成結果({ title: '生姜焼き' })],
      発行する献立の識別子: [],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案.entries.map((entry) => entry.origin)).toEqual(['generated', 'generated']);
  });

  it('名称の前後に空白のある生成結果も、空白を落とした既存の献立と一致する', async () => {
    // C-6 / ADR-037 理由(3) / B-28 規則10: 前後の空白が落ちているのは `createGeneratedMeal` と
    // `createMeal` が同じ trim を1度ずつ通しているからで、突き合わせる側は再正規化しない。
    // **下の「名称の途中に空白がある生成結果」と対である** — 片側の trim が消えるとここが赤くなる。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [作れない献立({ id: 識別子A, title: '肉じゃが' })],
      生成結果たち: [生成結果({ title: '  肉じゃが  ' })],
      発行する献立の識別子: [識別子C],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子A]);
  });

  it('名称の途中に空白がある生成結果は、空白の無い既存の献立とは別のものとして保存される', async () => {
    // C-6 / C-4 / B-28 規則10: 突き合わせは**完全一致**であり、表記ゆれは吸収しない
    // （既知の割り切り）。**上の「名称の前後に空白のある生成結果」と対である** — 比べる前に
    // 内部の空白を詰める・小文字にする・NFKC にするといった余計な正規化を足すと、ここが赤くなる。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [作れない献立({ id: 識別子A, title: '肉じゃが' })],
      生成結果たち: [生成結果({ title: '肉 じゃが' })],
      発行する献立の識別子: [識別子C],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子C]);
  });

  it('同じ名称の献立を2件保持しているときは、献立の識別子の昇順で先頭のものを参照する', async () => {
    // B-28 規則11 / ADR-036 決定2 / C-12: `findByHousehold` は並び順を約束しないので、
    // 識別子で閉じないと参照先が実装ごとにぶれる。**積む順は識別子の昇順と逆**にし、かつ
    // 先に積んだ 識別子B のほうを新しい生成日時にしてある — 「返った列の先頭を採る」実装も
    // 「避けるべき名称と同じ `byNewestFirst` を流用する」実装も 識別子B を指し、どちらも赤くなる。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [
        作れない献立({ id: 識別子B, title: '肉じゃが', generatedAt: '2026-09-13T12:00:00Z' }),
        作れない献立({ id: 識別子A, title: '肉じゃが', generatedAt: '2026-09-11T12:00:00Z' }),
      ],
      生成結果たち: [生成結果({ title: '肉じゃが' })],
      発行する献立の識別子: [識別子C],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子A]);
  });

  it('生成3件のうち1件だけが既存と一致したときは、既存の識別子と新しい識別子が生成の並びのまま並ぶ', async () => {
    // C-2 / B-28 規則9・10・12: 並びを決めるのは生成の側であり、参照した1件もその位置に残る。
    // **用意する献立の識別子はちょうど2件**である — 新しく保存するぶんだけ発行するので、
    // 参照で済む 肉じゃが にも発行する実装なら、3件目で発行器が尽きて投げる。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [作れない献立({ id: 識別子A, title: '肉じゃが' })],
      生成結果たち: [
        生成結果({ title: 'ごま和え' }),
        生成結果({ title: '肉じゃが' }),
        生成結果({ title: 'きんぴら' }),
      ],
      発行する献立の識別子: [識別子C, 識別子D],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子C, 識別子A, 識別子D]);
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
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [
        献立({ id: mealIdOf(識別子A), title: '肉じゃが', ingredients: [主材料('にんじん')] }),
      ],
      直近の提案: [保存済みの提案({ 献立の識別子たち: [識別子A] })],
      生成結果たち: [生成結果({ title: '肉じゃが' })],
      発行する献立の識別子: [識別子D],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案.entries).toEqual([{ mealId: 識別子A, origin: 'generated' }]);
  });

  it('別の世帯に同じ名称の献立があっても参照せず、新しい献立として保存する', async () => {
    // C-9 / B-28 規則10: 突き合わせる相手は第1引数の世帯の献立だけである。隣の家の献立を
    // 参照すると、提案が他の世帯の献立を指すことになる。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [作れない献立({ id: 識別子A, title: '肉じゃが', householdId: 隣の家 })],
      生成結果たち: [生成結果({ title: '肉じゃが' })],
      発行する献立の識別子: [識別子C],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(献立の識別子の並び(提案)).toEqual([識別子C]);
  });
});
