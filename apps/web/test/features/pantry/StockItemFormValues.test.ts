import { describe, expect, it } from 'vitest';
import type { RegisterStockItemInput } from '@fridge-to-meal/contract';
import type { StockItemFormValues } from '../../../src/features/pantry/StockItemFormValues.js';
import {
  EMPTY_STOCK_ITEM_FORM,
  registerStockItemInputOf,
} from '../../../src/features/pantry/StockItemFormValues.js';

/**
 * テストの本題でない欄を隠す（`docs/testing.md` 6章）。本題だけが引数に現れる。
 *
 * 既定を `EMPTY_STOCK_ITEM_FORM` から取らない — それだと規則6 のテストが落ちたときに、
 * 関係のない12件も一緒に落ちて理由が読めなくなる。
 */
function formValuesOf(props: Partial<StockItemFormValues> = {}): StockItemFormValues {
  return { name: 'にんじん', amount: '', expiryDate: '', ...props };
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
    const input = registerInputOf({ name: 'にんじん', amount: '200g', expiryDate: '2026-09-30' });

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
    expect(registerInputOf({ name: '', amount: '200g', expiryDate: '2026-09-30' })).toBe(null);
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
    expect(amountOf(registerInputOf({ name: 'にんじん', amount: '' }))).toBe(null);
  });

  it('分量が空白だけならその空白をそのまま分量に置く', () => {
    // B-12 設計 規則3 と規則4: 空にするのは空文字だけで、空白は落とさない。
    expect(amountOf(registerInputOf({ name: 'にんじん', amount: '   ' }))).toBe('   ');
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
    expect(EMPTY_STOCK_ITEM_FORM).toEqual({ name: '', amount: '', expiryDate: '' });
  });

  it('開いた直後のフォームからは登録の入力を作らない', () => {
    // B-12 設計 規則2・6: 開いた直後に保存できる状態にしない。
    expect(registerStockItemInputOf(EMPTY_STOCK_ITEM_FORM)).toBe(null);
  });
});
