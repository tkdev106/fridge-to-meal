import { describe, expect, it } from 'vitest';
import type { StockItemDto } from '@fridge-to-meal/contract';
import { suggestMeals } from '../../../../src/contexts/meal/usecase/SuggestMeals.js';
import type { SuggestMealsOutput } from '../../../../src/contexts/meal/usecase/SuggestMeals.js';
import type { Meal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { createMeal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import type { Suggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import { createSuggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { createPantrySnapshot } from '../../../../src/contexts/meal/domain/value/PantrySnapshot.js';
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
import { 記憶上の献立リポジトリ } from '../../../support/meal/InMemoryMealRepository.js';
import { 記憶上の提案リポジトリ } from '../../../support/meal/InMemorySuggestionRepository.js';
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

/** 主材料。突き合わせの対象になる側（C-16 / ADR-023）。 */
function 主材料(name: string) {
  return createMealIngredient({ name, kind: 'main', amount: null });
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
 * 在庫スナップショットは空で置く（C-11 / 規則7）。
 */
function 保存済みの提案(props: {
  献立の識別子たち: readonly string[];
  householdId?: HouseholdId;
  origin?: SuggestionEntryOrigin;
  generatedAt?: string;
}): Suggestion {
  return createSuggestion({
    id: suggestionIdOf(次の提案の識別子()),
    householdId: props.householdId ?? 我が家,
    entries: props.献立の識別子たち.map((献立の識別子) =>
      createSuggestionEntry({ mealId: mealIdOf(献立の識別子), origin: props.origin ?? 'reused' }),
    ),
    pantrySnapshot: createPantrySnapshot({ stockItems: [] }),
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
 * 記憶上の実装で結線し、ユースケースを1つ作る。テストの本題でない結線をここに隠す
 * （`docs/testing.md` 6章）。前提の献立も前提の提案も**登録や提案の経路を通さず
 * リポジトリへ直接置く。**
 *
 * **在庫は世帯で分けられない。** 在庫の一覧の代役は決まった出力を返すものなので、
 * 渡した在庫がそのまま我が家の在庫になる（#17 の注）。**前提の提案は世帯で分けられる** —
 * 提案自身が世帯を持つためである（C-9）。
 */
function 準備(
  props: {
    在庫?: readonly StockItemDto[];
    献立たち?: readonly Meal[];
    直近の提案?: readonly Suggestion[];
    発行する識別子?: readonly string[];
    在庫の一覧が投げる例外?: Error;
    直近の取得が投げる例外?: Error;
  } = {},
) {
  const 在庫の一覧 = new 記憶上の在庫品の一覧(
    props.在庫の一覧が投げる例外 === undefined
      ? { 返す出力: { stockItems: [...(props.在庫 ?? [])] } }
      : { 投げる例外: props.在庫の一覧が投げる例外 },
  );
  const mealRepository = new 記憶上の献立リポジトリ(...(props.献立たち ?? []));
  const suggestionRepository = new 記憶上の提案リポジトリ(
    props.直近の取得が投げる例外 === undefined
      ? {}
      : { 直近の取得が投げる例外: props.直近の取得が投げる例外 },
  );
  // 前提の提案は**`提案する` を通さずリポジトリへ直接積む。** 1回の呼び出しでは生成日時も
  // 提案の識別子も1つしか作れず、直近3回より前の提案を置けないためである（C-11）。
  // 記憶上の実装は配列へ積むだけなので、待たずとも積み終わっている。
  for (const 提案 of props.直近の提案 ?? []) {
    void suggestionRepository.save(提案.householdId, 提案);
  }
  const 提案する = suggestMeals({
    listStockItems: 在庫の一覧.一覧する,
    mealRepository,
    suggestionRepository,
    generateSuggestionId: 記憶上の提案識別子発行器(props.発行する識別子 ?? [提案の識別子]),
  });

  return { mealRepository, suggestionRepository, 提案する };
}

/** 返した提案が並べる献立の識別子。並びが本題なので集合にしない。 */
const 献立の識別子の並び = (提案: SuggestMealsOutput | null) =>
  提案?.entries.map((entry) => entry.mealId);

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

    expect(提案?.entries.map((entry) => entry.origin)).toEqual(['reused', 'reused']);
  });

  it('提案の識別子は、提案の識別子発行器が出した値になる', async () => {
    // ADR-026 / 規則12: 採番はポートの仕事で、本体は乱数を読まない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
      発行する識別子: ['suggestion-1'],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案?.id).toBe('suggestion-1');
  });

  it('提案の生成日時は、引数の基準日時を正規化した値になる', async () => {
    // 規則12 / `docs/testing.md` 5章: 現在時刻を読まず、渡された瞬間を UTC の正準形にする。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
    });

    const 提案 = await 提案する(我が家, '2026-09-14T12:00:00+09:00');

    expect(提案?.generatedAt).toBe('2026-09-14T03:00:00.000Z');
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
    expect(取り出したもの.map((保存された提案) => 保存された提案.id)).toEqual([提案?.id]);
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

  it('除外の結果、残った献立が0件になれば null を返す', async () => {
    // C-15 / 規則14 / NFR-C1b: 0件は例外ではなく、生成へ回る正常な経路である（生成は B-28）。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
      直近の提案: [保存済みの提案({ 献立の識別子たち: [識別子A] })],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案).toBeNull();
  });

  it('除外の結果0件になったときは、提案を保存しない', async () => {
    // C-14 の裏 / 規則14: 組めなかった回は記録に残さない。残すと C-11 の除外が1回ぶん狂う。
    const 事前の提案 = 保存済みの提案({ 献立の識別子たち: [識別子A] });
    const { 提案する, suggestionRepository } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
      直近の提案: [事前の提案],
    });

    await 提案する(我が家, 基準日時);

    const 取り出したもの = await suggestionRepository.findRecentByHousehold(我が家, 3);
    expect(取り出したもの.map((保存された提案) => 保存された提案.id)).toEqual([事前の提案.id]);
  });

  it('在庫で作れる献立が1件も無ければ null を返す', async () => {
    // C-15 / FR-34 / 規則14: 作れるものが0件なのは生成へ回る正常な経路である。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [献立({ id: mealIdOf(識別子B), title: '生姜焼き', ingredients: [主材料('豚肉')] })],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案).toBeNull();
  });

  it('在庫が0件なら null を返す', async () => {
    // 規則15 / NFR-C1b: 在庫が空でも例外にしない。
    const { 提案する } = 準備({
      在庫: [],
      献立たち: [献立({ id: mealIdOf(識別子A), ingredients: [主材料('にんじん')] })],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案).toBeNull();
  });

  it('保持している献立が0件なら null を返す', async () => {
    // 規則15 / NFR-C1b: 再利用できる献立がまだ1件も無い世帯でも例外にしない。
    const { 提案する } = 準備({
      在庫: [在庫品({ name: 'にんじん' })],
      献立たち: [],
    });

    const 提案 = await 提案する(我が家, 基準日時);

    expect(提案).toBeNull();
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
});
