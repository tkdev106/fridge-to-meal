/**
 * 分量の欄。数値の欄と単位の選択を横に並べる。単位で `その他` を選ぶと、数値の欄が自由入力の
 * 欄に変わる。登録と編集の2画面で使う。
 *
 * 値の判断は `AmountFieldValues.ts` が持ち、ここは描くだけである。見た目の値は
 * `StockItemForm.module.css` にある（2画面で共有する module）。
 */

import { useId } from 'react';
import type { AmountFieldValues, AmountUnit } from './AmountFieldValues.js';
import { AMOUNT_UNITS, OTHER_UNIT, numberTextOf, withUnit } from './AmountFieldValues.js';
import styles from './StockItemForm.module.css';

const LABEL = '分量';
const OPTIONAL_LABEL = '任意';
const UNIT_LABEL = '単位';

/** 数値の欄の置き文字。 */
const NUMBER_PLACEHOLDER = '例: 300';

/** `その他` を選んだときの置き文字。 */
const OTHER_PLACEHOLDER = '例: 少々、1/4個';

export type AmountFieldProps = {
  values: AmountFieldValues;
  onChange: (values: AmountFieldValues) => void;
  autoFocus?: boolean;
};

export function AmountField({ values, onChange, autoFocus = false }: AmountFieldProps) {
  const inputId = useId();
  const other = values.unit === OTHER_UNIT;

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={inputId}>
        <span>{LABEL}</span>
        <span className={styles.optional}>{OPTIONAL_LABEL}</span>
      </label>
      <div className={styles.amountRow}>
        {/* 数値のときも type="number" にしない — 空と打ちかけの小数点を区別できず、ホイールで値が変わる。 */}
        <input
          id={inputId}
          autoFocus={autoFocus}
          className={styles.input}
          inputMode={other ? 'text' : 'decimal'}
          placeholder={other ? OTHER_PLACEHOLDER : NUMBER_PLACEHOLDER}
          value={values.number}
          onChange={(event) => {
            const raw = event.target.value;
            onChange({ ...values, number: other ? raw : numberTextOf(raw) });
          }}
        />
        <select
          className={styles.unitSelect}
          aria-label={UNIT_LABEL}
          value={values.unit}
          onChange={(event) => onChange(withUnit(values, event.target.value as AmountUnit))}
        >
          {AMOUNT_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
          <option value={OTHER_UNIT}>{OTHER_UNIT}</option>
        </select>
      </div>
    </div>
  );
}
