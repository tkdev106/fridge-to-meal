import { describe, expect, it } from 'vitest';
import type { RegisterStockItemInput, StockItemDto } from '@fridge-to-meal/contract';
import type {
  StockItemEditValues,
  StockItemFormValues,
} from '../../../src/features/pantry/StockItemFormValues.js';
import type { AmountFieldValues } from '../../../src/features/pantry/AmountFieldValues.js';
import { EMPTY_AMOUNT_FIELD } from '../../../src/features/pantry/AmountFieldValues.js';
import {
  EMPTY_STOCK_ITEM_FORM,
  registerStockItemInputOf,
  stockItemEditValuesOf,
  updateStockItemInputOf,
} from '../../../src/features/pantry/StockItemFormValues.js';

/**
 * テストの本題でない欄を隠す（`docs/testing.md` 6章）。本題だけが引数に現れる。
 *
 * 既定を `EMPTY_STOCK_ITEM_FORM` から取らない — それだと規則6 のテストが落ちたときに、
 * 関係のない12件も一緒に落ちて理由が読めなくなる。
 */
/** `その他` の自由入力に打った分量。打った文字がそのまま分量になる。 */
function otherAmount(text: string): AmountFieldValues {
  return { number: text, unit: 'その他' };
}

function formValuesOf(props: Partial<StockItemFormValues> = {}): StockItemFormValues {
  return {
    name: 'にんじん',
    amount: EMPTY_AMOUNT_FIELD,
    expiryDate: '',
    useForMeals: true,
    ...props,
  };
}

function registerInputOf(props: Partial<StockItemFormValues> = {}) {
  return registerStockItemInputOf(formValuesOf(props));
}

// 以下4つは**戻り値の1欄だけ**を見る。戻り値全体を toEqual しないのは、contract が
// 「省略と null は同義」と定めているため（キーが在るか無いかを握らない）。
function nameOf(input: RegisterStockItemInput | null) {
  return input?.name ?? null;
}

function ingredientIdOf(input: RegisterStockItemInput | null) {
  return input?.ingredientId ?? null;
}

function amountOf(input: RegisterStockItemInput | null) {
  return input?.amount ?? null;
}

function expiryDateOf(input: RegisterStockItemInput | null) {
  return input?.expiryDate ?? null;
}

/** 3欄をまとめて見るときの形。上と同じ理由でキーの有無は握らない。 */
function threeFields(input: RegisterStockItemInput | null) {
  return { name: nameOf(input), amount: amountOf(input), expiryDate: expiryDateOf(input) };
}

describe('登録の入力 registerStockItemInputOf', () => {
  it('3欄すべてに値があるときその値をそのまま持つ登録の入力を返す', () => {
    // FR-01 / ADR-010 / B-12 設計 規則1・3: 分量は自由文字列のまま運ぶ。
    const input = registerInputOf({
      name: 'にんじん',
      amount: { number: '200', unit: 'g' },
      expiryDate: '2026-09-30',
    });

    expect(threeFields(input)).toEqual({
      name: 'にんじん',
      amount: '200g',
      expiryDate: '2026-09-30',
    });
  });

  it('カタログに無い食材名でも登録の入力を作り食材の指定を伴わない', () => {
    // FR-03 / B-12 設計 規則1: 自由入力だけで登録が通る。ingredientId は項目ごと持たせない。
    const input = registerInputOf({ name: 'いただきものの謎の葉' });

    expect([nameOf(input), ingredientIdOf(input)]).toEqual(['いただきものの謎の葉', null]);
  });

  it('食材名が空なら登録の入力を作らない', () => {
    // FR-01 / B-12 設計 規則2: 食材名は必須。在庫品の不変条件の手前で止める。
    expect(
      registerInputOf({ name: '', amount: { number: '200', unit: 'g' }, expiryDate: '2026-09-30' }),
    ).toBe(null);
  });

  it('食材名が空白だけなら登録の入力を作らない', () => {
    // NFR-15 / B-12 設計 規則2・7章1行目: 往復してから断られると10秒に収まらない。
    expect(registerInputOf({ name: '   ' })).toBe(null);
  });

  it('食材名が全角空白だけでも登録の入力を作らない', () => {
    // B-12 設計 規則2: サーバの createStockItem が trim() で断る条件と揃える。
    expect(registerInputOf({ name: '　' })).toBe(null);
  });

  it('食材名の前後の空白は落とさずそのまま登録の入力に置く', () => {
    // C-6 / B-12 設計 規則4・4b: 正規化はドメインの1か所に残す。画面は写すだけ。
    expect(nameOf(registerInputOf({ name: '  にんじん  ' }))).toBe('  にんじん  ');
  });

  it('分量が空欄なら分量なしの登録の入力を返す', () => {
    // FR-13 / B-12 設計 規則3: 空文字は null（未設定）。
    expect(amountOf(registerInputOf({ name: 'にんじん', amount: EMPTY_AMOUNT_FIELD }))).toBe(null);
  });

  it('分量が空白だけならその空白をそのまま分量に置く', () => {
    // B-12 設計 規則3 と規則4: 空にするのは空文字だけで、空白は落とさない。
    expect(amountOf(registerInputOf({ name: 'にんじん', amount: otherAmount('   ') }))).toBe('   ');
  });

  it('期限が空欄なら期限なしの登録の入力を返す', () => {
    // FR-13 / B-12 設計 規則3。
    expect(expiryDateOf(registerInputOf({ name: 'にんじん', expiryDate: '' }))).toBe(null);
  });

  it('期限が空白だけならその空白をそのまま期限に置く', () => {
    // B-12 設計 規則3 と規則4（期限側）。
    expect(expiryDateOf(registerInputOf({ name: 'にんじん', expiryDate: '   ' }))).toBe('   ');
  });

  it('書式が YYYY-MM-DD でない期限もそのまま登録の入力に置く', () => {
    // B-12 設計 規則4 / 7章3行目: 書式は画面で確かめず、サーバが expiryDate.format で断る。
    expect(expiryDateOf(registerInputOf({ name: 'にんじん', expiryDate: 'abc' }))).toBe('abc');
  });

  it('暦に無い日付の期限もそのまま登録の入力に置く', () => {
    // B-12 設計 規則4 / 7章3行目: 実在はサーバが expiryDate.notACalendarDate で断る。
    expect(expiryDateOf(registerInputOf({ name: 'にんじん', expiryDate: '2026-02-30' }))).toBe(
      '2026-02-30',
    );
  });
});

describe('空のフォーム EMPTY_STOCK_ITEM_FORM', () => {
  it('開いた直後のフォームは3欄とも空である', () => {
    // FR-13 / NFR-15 / B-12 設計 規則6: 期限に「今日」のような既定値を入れない。
    // 献立に使うかどうかは文字の欄ではないので、下の B-76 の it が別に見る。
    const { name, amount, expiryDate } = EMPTY_STOCK_ITEM_FORM;
    expect({ name, amount: amount.number, expiryDate }).toEqual({
      name: '',
      amount: '',
      expiryDate: '',
    });
  });

  it('開いた直後のフォームからは登録の入力を作らない', () => {
    // B-12 設計 規則2・6: 開いた直後に保存できる状態にしない。
    expect(registerStockItemInputOf(EMPTY_STOCK_ITEM_FORM)).toBe(null);
  });
});

// ---- 編集（B-55）----

/**
 * 編集する在庫品の標本。本題でない欄（識別子・名称・食材の指定）を隠す
 * （`docs/testing.md` 6章）— **編集できるのは分量と期限だけである**（B-55 規則1）。
 */
function stockItemOf(props: Partial<StockItemDto> = {}): StockItemDto {
  return {
    id: 'stock-item-carrot',
    name: 'にんじん',
    ingredientId: 'ingredient-carrot',
    amount: '2本',
    expiryDate: '2026-09-21',
    useForMeals: true,
    ...props,
  };
}

/** 編集の欄の標本。本題だけが引数に現れる形にする。 */
function editValuesOf(props: Partial<StockItemEditValues> = {}): StockItemEditValues {
  return {
    amount: { number: '3', unit: '本' },
    expiryDate: '2026-10-01',
    useForMeals: true,
    ...props,
  };
}

describe('編集の欄の値 stockItemEditValuesOf', () => {
  it('在庫品の分量と期限をそのまま欄の値にし食材名を欄に持たない', () => {
    // FR-05 / B-55 規則1・2: 名称は出すが変えられないため欄に持たない。**厳密に比べる** —
    // 名称の欄が混ざれば落ちる。
    expect(stockItemEditValuesOf(stockItemOf())).toStrictEqual({
      amount: { number: '2', unit: '本' },
      expiryDate: '2026-09-21',
      useForMeals: true,
    });
  });

  it('分量が未設定の在庫品なら分量の欄を空にする', () => {
    // B-55 規則2 / NFR-15: `null` は空の欄に倒す（欄に `null` を描かせない）。
    expect(stockItemEditValuesOf(stockItemOf({ amount: null })).amount).toStrictEqual(
      EMPTY_AMOUNT_FIELD,
    );
  });

  it('期限が未設定の在庫品なら期限の欄を空文字にする', () => {
    // B-55 規則2 / NFR-15: 期限も同じに倒す。
    expect(stockItemEditValuesOf(stockItemOf({ expiryDate: null })).expiryDate).toBe('');
  });

  it('在庫品の分量の前後の空白を落とさずそのまま欄に置く', () => {
    // B-55 規則4 / 先行 `StockItemFormValues.ts` 規則4: 正規化はサーバの1か所に残す。
    expect(stockItemEditValuesOf(stockItemOf({ amount: ' 2本 ' })).amount).toStrictEqual(
      otherAmount(' 2本 '),
    );
  });
});

describe('更新の入力 updateStockItemInputOf', () => {
  it('2欄に値があるときその値をそのまま持つ更新の入力を返し食材名を送らない', () => {
    // FR-05 / B-55 規則1: `UpdateStockItemInput` に名称は無い。**厳密に比べる** —
    // 名称が混ざれば落ちる。
    expect(updateStockItemInputOf(editValuesOf())).toStrictEqual({
      amount: '3本',
      expiryDate: '2026-10-01',
      useForMeals: true,
    });
  });

  it('分量が空欄なら分量を消す更新の入力を返す', () => {
    // FR-13 / B-55 規則3: 空欄は「消す」を表し `null` を送る。**キーを省略しない** —
    // `UpdateStockItemInput` は常に置き換えとして扱う。
    expect(updateStockItemInputOf(editValuesOf({ amount: EMPTY_AMOUNT_FIELD }))).toStrictEqual({
      amount: null,
      expiryDate: '2026-10-01',
      useForMeals: true,
    });
  });

  it('期限が空欄なら期限を消す更新の入力を返す', () => {
    // FR-13 / B-55 規則3: 期限も同じに倒し、キーを省略しない。
    expect(updateStockItemInputOf(editValuesOf({ expiryDate: '' }))).toStrictEqual({
      amount: '3本',
      expiryDate: null,
      useForMeals: true,
    });
  });

  it('2欄とも空欄でも更新の入力を作る', () => {
    // FR-13 / B-55 規則3・6: 「どちらも消す」は正しい編集である。登録（食材名が空なら
    // `null` を返す）と違い、**作れない入力が無い。**
    expect(
      updateStockItemInputOf({
        amount: EMPTY_AMOUNT_FIELD,
        expiryDate: '',
        useForMeals: true,
      }),
    ).toStrictEqual({
      amount: null,
      expiryDate: null,
      useForMeals: true,
    });
  });

  it('欄の値が在庫品の今の値と同じでも更新の入力を作る', () => {
    // B-55 規則6: **差分を見て止めない** — 判断を2か所に増やさない。
    expect(updateStockItemInputOf(stockItemEditValuesOf(stockItemOf()))).toStrictEqual({
      amount: '2本',
      expiryDate: '2026-09-21',
      useForMeals: true,
    });
  });

  it('分量が空白だけならその空白をそのまま更新の入力に置く', () => {
    // B-55 規則3・4: 空にするのは空文字だけで、空白は落とさない。
    expect(updateStockItemInputOf(editValuesOf({ amount: otherAmount(' ') })).amount).toBe(' ');
  });

  it('書式が YYYY-MM-DD でない期限もそのまま更新の入力に置く', () => {
    // B-55 規則4 / 7章: 書式は画面で確かめず、サーバが `expiryDate.format` で断る。
    expect(updateStockItemInputOf(editValuesOf({ expiryDate: '2026/10/01' })).expiryDate).toBe(
      '2026/10/01',
    );
  });

  it('暦に無い日付の期限もそのまま更新の入力に置く', () => {
    // B-55 規則4 / 7章: 実在はサーバが `expiryDate.notACalendarDate` で断る。
    expect(updateStockItemInputOf(editValuesOf({ expiryDate: '2026-02-30' })).expiryDate).toBe(
      '2026-02-30',
    );
  });
});

// ---- 献立に使う（B-76）----

describe('献立に使うかどうか useForMeals', () => {
  it('開いた直後のフォームは献立に使う', () => {
    // B-76 設計 規則13: 開いた直後はオン。
    expect(EMPTY_STOCK_ITEM_FORM.useForMeals).toBe(true);
  });

  it.each([true, false])(
    '登録の入力にフォームの献立に使うかどうか（%s）をそのまま載せる',
    (useForMeals) => {
      // B-76 設計 規則15 / FR-01: 省略せず、null にもせず真偽値で含む。
      expect(registerInputOf({ useForMeals })?.useForMeals).toBe(useForMeals);
    },
  );

  it.each([true, false])(
    '食材名が空なら献立に使うかどうか（%s）によらず登録の入力を作らない',
    (useForMeals) => {
      // B-76 設計 規則15 / B-12 規則2: 保存できない条件は食材名が空のときだけのまま。
      expect(registerInputOf({ name: '', useForMeals })).toBe(null);
    },
  );

  it.each([true, false])(
    '編集の開いた直後の値は在庫品の今の献立に使うかどうか（%s）を持つ',
    (useForMeals) => {
      // B-76 設計 規則14 / FR-05: 初期値は対象の在庫品の現在の値。
      expect(stockItemEditValuesOf(stockItemOf({ useForMeals })).useForMeals).toBe(useForMeals);
    },
  );

  it.each([true, false])(
    '更新の入力に編集の値の献立に使うかどうか（%s）をそのまま載せる',
    (useForMeals) => {
      // B-76 設計 規則3・15: 更新は置き換えであり、真偽値を常に含む。
      expect(updateStockItemInputOf(editValuesOf({ useForMeals })).useForMeals).toBe(useForMeals);
    },
  );
});
