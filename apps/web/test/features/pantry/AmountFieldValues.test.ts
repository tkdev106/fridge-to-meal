import { describe, expect, it } from 'vitest';
import {
  EMPTY_AMOUNT_FIELD,
  amountFieldValuesOf,
  amountTextOf,
  numberTextOf,
  withUnit,
} from '../../../src/features/pantry/AmountFieldValues.js';

describe('送る分量の文字列 amountTextOf', () => {
  it('数値と単位をつないだ文字列を返す', () => {
    // ADR-010: 送る値は1つの自由文字列のまま。
    expect(amountTextOf({ number: '200', unit: 'g' })).toBe('200g');
  });

  it('数値が空なら単位を選んでいても空文字を返す', () => {
    // FR-13: 分量は任意。単位だけでは分量にしない。
    expect(amountTextOf({ number: '', unit: '本' })).toBe('');
  });

  it('その他なら打った文字をそのまま返す', () => {
    // 前後の空白も落とさない。正規化はサーバの `amountOf` の1か所に残す。
    expect(amountTextOf({ number: ' 少々 ', unit: 'その他' })).toBe(' 少々 ');
  });
});

describe('数値の欄の文字 numberTextOf', () => {
  it('数字と小数点だけを残す', () => {
    expect(numberTextOf('2.5本')).toBe('2.5');
  });

  it('全角の数字と小数点を半角に直す', () => {
    expect(numberTextOf('１２．５')).toBe('12.5');
  });
});

describe('保存済みの分量の読み戻し amountFieldValuesOf', () => {
  it.each([
    ['300g', { number: '300', unit: 'g' }],
    ['1.5kg', { number: '1.5', unit: 'kg' }],
    ['1L', { number: '1', unit: 'L' }],
    ['6パック', { number: '6', unit: 'パック' }],
  ])('「%s」は数値と単位に戻す', (amount, expected) => {
    expect(amountFieldValuesOf(amount)).toStrictEqual(expected);
  });

  it.each(['6こ', '少々', '1/4個', '200', ' 2本 '])(
    '数値と選べる単位に分けられない「%s」はその他の自由入力に入れる',
    (amount) => {
      expect(amountFieldValuesOf(amount)).toStrictEqual({ number: amount, unit: 'その他' });
    },
  );

  it('分量が未設定なら空の欄にする', () => {
    expect(amountFieldValuesOf(null)).toStrictEqual(EMPTY_AMOUNT_FIELD);
  });

  it('読み戻した値から作る文字列は保存済みの分量と同じである', () => {
    // 開いてそのまま保存した回に値が黙って変わらない。
    for (const amount of ['300g', '1.5kg', '6こ', ' 2本 ']) {
      expect(amountTextOf(amountFieldValuesOf(amount))).toBe(amount);
    }
  });
});

describe('単位の選び直し withUnit', () => {
  it('単位どうしの選び直しでは数値を残す', () => {
    expect(withUnit({ number: '300', unit: 'g' }, '本')).toStrictEqual({
      number: '300',
      unit: '本',
    });
  });

  it('その他から単位へ戻すとき、自由入力の文字が数値ならそのまま残す', () => {
    expect(withUnit({ number: '300', unit: 'その他' }, 'g')).toStrictEqual({
      number: '300',
      unit: 'g',
    });
  });

  it('その他から単位へ戻すとき、自由入力の文字が数値でなければ空にする', () => {
    expect(withUnit({ number: '1/4個', unit: 'その他' }, '個')).toStrictEqual({
      number: '',
      unit: '個',
    });
  });

  it('その他へ切り替えると数値をそのまま自由入力の文字にする', () => {
    expect(withUnit({ number: '300', unit: 'g' }, 'その他')).toStrictEqual({
      number: '300',
      unit: 'その他',
    });
  });
});
