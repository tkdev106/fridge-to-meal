import { describe, expect, it } from 'vitest';
import type {
  MealCoverageDto,
  MealIngredientDto,
  MealOutput,
  SuggestionEntryOutput,
  SuggestMealsOutput,
} from '@fridge-to-meal/contract';

// 契約は型だけを持ち、実行時の分岐を持たない（B-48a 設計書 5章）。したがってここで確かめるのは
// 「契約に沿う値が組み立てられること」と「契約に反する値が型として通らないこと」である。
// 後者は @ts-expect-error で押さえ、pnpm typecheck が赤を出す。

const suggestionId = '55555555-5555-4555-8555-555555555555';
const mealId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** 提案の1件を作る。本題でない値をここに隠す。充足の中身はこの周の本題ではない。 */
function suggestionEntryOutput(): SuggestionEntryOutput {
  return {
    mealId,
    origin: 'reused',
    title: '肉じゃが',
    ingredients: [{ name: 'にんじん', kind: 'main', amount: '1本' }],
    steps: ['煮る'],
    coverage: { covered: [], missing: [] },
  };
}

describe('提案の結末 SuggestMealsOutput', () => {
  it('提案を返した結末は、提案の識別子・1件の列・生成日時を持つ', () => {
    // 規則1 / FR-19: 提案の1件に献立の名称・材料・手順と由来を載せる。
    const output: SuggestMealsOutput = {
      outcome: 'suggested',
      suggestion: {
        id: suggestionId,
        entries: [
          {
            mealId,
            origin: 'generated',
            title: '肉じゃが',
            ingredients: [
              { name: 'にんじん', kind: 'main', amount: '1本' },
              { name: '醤油', kind: 'seasoning', amount: '大さじ1' },
            ],
            steps: ['切る', '煮る'],
            coverage: { covered: [], missing: [] },
          },
        ],
        generatedAt: '2026-09-14T03:00:00.000Z',
      },
    };

    if (output.outcome !== 'suggested') throw new Error('提案を返した結末ではない');
    expect(output.suggestion.id).toBe(suggestionId);
    expect(output.suggestion.entries[0]?.title).toBe('肉じゃが');
    expect(output.suggestion.generatedAt).toBe('2026-09-14T03:00:00.000Z');
  });

  it('在庫が足りない結末に提案を持たせられない', () => {
    // ADR-041 決定1: 在庫が足りない回は提案を組まない。結末の名乗りのほかに何も持たない。
    const output: SuggestMealsOutput = {
      outcome: 'insufficientStockItems',
      // @ts-expect-error 在庫が足りない結末に提案は無い
      suggestion: { id: suggestionId, entries: [], generatedAt: '2026-09-14T03:00:00.000Z' },
    };

    expect(output).toBeDefined();
  });

  it('上限に達した結末に提案を持たせられない', () => {
    // ADR-041 決定1: 上限に達した回も提案を組まない。
    const output: SuggestMealsOutput = {
      outcome: 'generationLimitReached',
      // @ts-expect-error 上限に達した結末に提案は無い
      suggestion: { id: suggestionId, entries: [], generatedAt: '2026-09-14T03:00:00.000Z' },
    };

    expect(output).toBeDefined();
  });
});

describe('提案の1件 SuggestionEntryOutput', () => {
  it('提案の1件の由来に、生成と再利用のほかの値を渡せない', () => {
    // FR-35: 由来は生成か再利用の2つだけである。
    const entry: SuggestionEntryOutput = {
      ...suggestionEntryOutput(),
      // @ts-expect-error 由来は 'generated' か 'reused'
      origin: 'cached',
    };

    expect(entry).toBeDefined();
  });

  it('提案の1件に世帯を持たせられない', () => {
    // 規則12 / NFR-09: 世帯は認証された利用者から定まる。出力には載せない。
    const entry: SuggestionEntryOutput = {
      ...suggestionEntryOutput(),
      // @ts-expect-error 世帯は契約に無い
      householdId: '11111111-1111-4111-8111-111111111111',
    };

    expect(entry).toBeDefined();
  });

  it('提案の1件に調理記録を持たせられない', () => {
    // 規則12: 調理記録は提案の出力に載せない。
    const entry: SuggestionEntryOutput = {
      ...suggestionEntryOutput(),
      // @ts-expect-error 調理記録は契約に無い
      cookingRecords: [],
    };

    expect(entry).toBeDefined();
  });
});

describe('材料 MealIngredientDto', () => {
  it('材料の種別に、主材料と調味料のほかの値を渡せない', () => {
    // C-16: 材料の種別は主材料と調味料の2つだけである。
    const ingredient: MealIngredientDto = {
      name: 'パセリ',
      // @ts-expect-error 種別は 'main' か 'seasoning'
      kind: 'garnish',
      amount: null,
    };

    expect(ingredient).toBeDefined();
  });

  it('材料の分量を null で表せる', () => {
    // 規則3 / ADR-010: 分量は自由文字列で、未設定は null で表す。
    const ingredient: MealIngredientDto = { name: 'にんじん', kind: 'main', amount: null };

    expect(ingredient.amount).toBeNull();
  });

  it('材料では分量のキーを省略できない', () => {
    // 規則3: 返す側は必ず null を載せる。省略と null の2通りの表し方を作らない。
    // @ts-expect-error 分量のキーが無い値は材料の表現ではない
    const ingredient: MealIngredientDto = { name: 'にんじん', kind: 'main' };

    expect(ingredient).toBeDefined();
  });
});

describe('充足 MealCoverageDto', () => {
  it('賄える材料の期限を null で表せる', () => {
    // B-48a 規則8: 同じ名称の在庫品がどれも期限を持たなければ null で表す。
    const coverage: MealCoverageDto = {
      covered: [{ name: 'にんじん', kind: 'main', amount: null, expiryDate: null }],
      missing: [],
    };

    expect(coverage.covered[0]?.expiryDate).toBeNull();
  });

  it('不足する材料に期限を持たせられない', () => {
    // B-48a 規則8: 期限を載せるのは賄える材料だけである。
    const coverage: MealCoverageDto = {
      covered: [],
      missing: [
        {
          name: '豚肉',
          kind: 'main',
          amount: null,
          // @ts-expect-error 不足する材料に期限は無い
          expiryDate: '2026-09-20',
        },
      ],
    };

    expect(coverage).toBeDefined();
  });

  it('賄える材料では期限のキーを省略できない', () => {
    // B-48a 規則8: 返す側は必ず null を載せる。省略と null の2通りの表し方を作らない。
    const coverage: MealCoverageDto = {
      // @ts-expect-error 期限のキーが無い値は賄える材料の表現ではない
      covered: [{ name: 'にんじん', kind: 'main', amount: null }],
      missing: [],
    };

    expect(coverage).toBeDefined();
  });
});

// ここから下は B-52 周A（`MealOutput` の切り出し。ADR-067 論点1）。
// 上の既存のケースはそのまま緑である — **切り出しで JSON の形を1バイトも変えない**ことを、
// 既存の全件が1行も変わらずに通ることで観察する（設計書 11章）。

/** 献立1件の出力を作る。本題でない値をここに隠す。 */
function mealOutput(): MealOutput {
  return {
    mealId,
    title: '肉じゃが',
    ingredients: [{ name: 'にんじん', kind: 'main', amount: '1本' }],
    steps: ['煮る'],
    coverage: { covered: [], missing: [] },
  };
}

describe('献立1件の出力 MealOutput', () => {
  it('献立1件の出力は識別子・名称・材料・手順・充足を持つ', () => {
    // 設計書5章 / FR-30: 献立詳細が要るのはこの5つである。
    const output: MealOutput = mealOutput();

    expect(output.mealId).toBe(mealId);
    expect(output.title).toBe('肉じゃが');
    expect(output.ingredients[0]?.name).toBe('にんじん');
    expect(output.steps).toEqual(['煮る']);
    expect(output.coverage).toEqual({ covered: [], missing: [] });
  });

  it('提案の1件は献立1件の出力として読める', () => {
    // 規則16 / ADR-067 論点1: `SuggestionEntryOutput = MealOutput & { origin }`。
    // 提案の1件は献立1件の中身をそのまま含み、由来だけを足したものである。
    const entry: SuggestionEntryOutput = suggestionEntryOutput();

    const output: MealOutput = entry;

    expect(output.title).toBe(entry.title);
  });

  it('献立1件の出力に由来を持たせられない', () => {
    // 規則8 / FR-35: 由来は提案の1件の性質であって献立の性質ではない。
    const output: MealOutput = {
      ...mealOutput(),
      // @ts-expect-error 由来は献立1件の出力に無い
      origin: 'reused',
    };

    expect(output).toBeDefined();
  });

  it('献立1件の出力に世帯を持たせられない', () => {
    // 規則9 / B-48a 規則12 / NFR-09: 世帯は認証された利用者から定まる。出力には載せない。
    const output: MealOutput = {
      ...mealOutput(),
      // @ts-expect-error 世帯は契約に無い
      householdId: '11111111-1111-4111-8111-111111111111',
    };

    expect(output).toBeDefined();
  });

  it('献立1件の出力に調理記録を持たせられない', () => {
    // 規則9 / B-48a 規則12: 調理記録はどの型にも載せない。
    const output: MealOutput = {
      ...mealOutput(),
      // @ts-expect-error 調理記録は契約に無い
      cookingRecords: [],
    };

    expect(output).toBeDefined();
  });

  it('献立1件の出力に生成日時を持たせられない', () => {
    // 規則9 / B-48a 規則12: 献立の生成日時は載せない（提案の側が持つ）。
    const output: MealOutput = {
      ...mealOutput(),
      // @ts-expect-error 生成日時は契約に無い
      generatedAt: '2026-09-14T03:00:00.000Z',
    };

    expect(output).toBeDefined();
  });

  it('賄える材料の期限が未設定のときは null を持てる', () => {
    // 規則6 / ADR-061 決定2: 期限を持つ在庫品が無ければ null である。
    const output: MealOutput = {
      ...mealOutput(),
      coverage: {
        covered: [{ name: 'にんじん', kind: 'main', amount: null, expiryDate: null }],
        missing: [],
      },
    };

    expect(output.coverage.covered[0]?.expiryDate).toBeNull();
  });

  it('材料の分量の未設定は null で表す', () => {
    // 規則7 / ADR-010: 分量は自由文字列で、未設定は null で表す。
    const output: MealOutput = {
      ...mealOutput(),
      ingredients: [{ name: 'にんじん', kind: 'main', amount: null }],
    };

    expect(output.ingredients[0]?.amount).toBeNull();
  });
});
