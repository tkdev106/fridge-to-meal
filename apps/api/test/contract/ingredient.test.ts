import { describe, expect, it } from 'vitest';
import type { ListIngredientNamesOutput } from '@fridge-to-meal/contract';

// 契約は型だけを持ち、実行時の分岐を持たない（B-50b 設計書 5章）。したがってここで確かめるのは
// 「契約に沿う値が組み立てられること」と「契約に反する値が型として通らないこと」である。
// 後者は @ts-expect-error で押さえ、pnpm typecheck が赤を出す。

describe('食材名の列 ListIngredientNamesOutput', () => {
  it('食材名の列を持つ出力を組み立てられる', () => {
    // FR-02 / ADR-063 決定4: 補完の元は名称の列だけである。
    const output: ListIngredientNamesOutput = { ingredientNames: ['たまねぎ', 'にんじん'] };

    expect(output.ingredientNames).toEqual(['たまねぎ', 'にんじん']);
  });

  it('食材名が0件の出力も組み立てられる', () => {
    // FR-02 / FR-03: 名称が1つも無い回も空の列で表す。空を失敗として扱わない。
    const output: ListIngredientNamesOutput = { ingredientNames: [] };

    expect(output.ingredientNames).toEqual([]);
  });

  it('食材名の列のキーを省略できない', () => {
    // B-50b 規則7: 返す側は必ず列を載せる。省略と空の2通りの表し方を作らない。
    // @ts-expect-error 食材名の列の無い値は出力の表現ではない
    const output: ListIngredientNamesOutput = {};

    expect(output).toBeDefined();
  });

  it('食材名を文字列以外で渡せない', () => {
    // ADR-063 決定4: 運ぶのは名称そのものである。
    const output: ListIngredientNamesOutput = {
      // @ts-expect-error 食材名は文字列の列である
      ingredientNames: [1, 2],
    };

    expect(output).toBeDefined();
  });

  it('食材名の列に世帯を持たせられない', () => {
    // C-9 / NFR-09: 世帯は認証された利用者から定まる。出力には載せない。
    const output: ListIngredientNamesOutput = {
      ingredientNames: ['にんじん'],
      // @ts-expect-error 世帯は契約に無い
      householdId: '11111111-1111-4111-8111-111111111111',
    };

    expect(output).toBeDefined();
  });

  it('食材名の列に材料の種別を持たせられない', () => {
    // ADR-063 決定3 / C-16: 調味料はユースケースが落としており、種別を外へ出さない。
    const output: ListIngredientNamesOutput = {
      ingredientNames: ['にんじん'],
      // @ts-expect-error 材料の種別は契約に無い
      kind: 'main',
    };

    expect(output).toBeDefined();
  });
});
