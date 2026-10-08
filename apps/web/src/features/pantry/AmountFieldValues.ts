/**
 * 分量の欄の値（数値と単位）と、送る分量の文字列との行き来。
 *
 * **分けるのは入力の欄だけで、送る値は1つの自由文字列のまま**（ADR-010）。数値と単位を
 * つないで「200g」にして送り、編集の画面では保存済みの文字列を数値と単位に読み戻す。
 * 読み戻せない文字列（「少々」「1/4個」「6こ」）は `その他` の自由入力に入れる。
 *
 * 判断はここに置き、描画は `AmountField.tsx` が持つ。React も import しない。
 */

/** 選べる単位。並びは選択肢の並びである。 */
export const AMOUNT_UNITS = [
  'g',
  'kg',
  'ml',
  'L',
  '個',
  '本',
  '玉',
  '束',
  '枚',
  '丁',
  'パック',
  '袋',
] as const;

/** 自由入力に切り替える選択肢。`number` の欄が自由文字列の分量そのものになる。 */
export const OTHER_UNIT = 'その他';

export type AmountUnit = (typeof AMOUNT_UNITS)[number] | typeof OTHER_UNIT;

/**
 * 分量の欄の値。`unit` が `その他` のとき、`number` は数値に限らない自由文字列である。
 */
export type AmountFieldValues = {
  readonly number: string;
  readonly unit: AmountUnit;
};

/** 開いた直後の値。単位は `g` から始める。 */
export const EMPTY_AMOUNT_FIELD: AmountFieldValues = { number: '', unit: 'g' };

/**
 * 送る分量の文字列を作る。数値が空なら空文字（分量なし）。
 * `その他` は打った文字をそのまま返す（前後の空白も落とさない。正規化はサーバの `amountOf`）。
 */
export function amountTextOf(values: AmountFieldValues): string {
  if (values.unit === OTHER_UNIT || values.number === '') return values.number;
  return `${values.number}${values.unit}`;
}

/**
 * 数値の欄に打った文字から、数字と小数点だけを残す。全角の数字と小数点は半角に直す
 * — 日本語入力のまま打っても数値になるように。
 */
export function numberTextOf(raw: string): string {
  return raw
    .replace(/[０-９．]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9.]/g, '');
}

/** 保存済みの分量を欄の値に読み戻す。`null` は空の欄。 */
export function amountFieldValuesOf(amount: string | null): AmountFieldValues {
  if (amount === null || amount === '') return EMPTY_AMOUNT_FIELD;

  for (const unit of AMOUNT_UNITS) {
    if (!amount.endsWith(unit)) continue;
    const number = amount.slice(0, -unit.length);
    if (/^\d+(\.\d+)?$/.test(number)) return { number, unit };
  }
  return { number: amount, unit: OTHER_UNIT };
}

/**
 * 単位を選び直した値。`その他` から単位へ戻すとき、自由入力の文字が数値でなければ空にする
 * — 「1/4個」から数字だけを拾って「14」にすると、打っていない分量が黙って入る。
 */
export function withUnit(values: AmountFieldValues, unit: AmountUnit): AmountFieldValues {
  if (values.unit === OTHER_UNIT && unit !== OTHER_UNIT) {
    const number = numberTextOf(values.number);
    return { number: number === values.number ? number : '', unit };
  }
  return { number: values.number, unit };
}
