/**
 * 分量の欄に打つ。「2本」のような数値＋選べる単位は、単位を選んでから数値を打つ。
 * それ以外（「少々」「1/4個」）は `その他` を選んでから自由入力の欄に打つ。
 * 空文字は今の欄を空にする。
 */

import { fireEvent, screen } from './renderComponent.js';
import { amountFieldValuesOf } from '../../../src/features/pantry/AmountFieldValues.js';

/** 分量の欄（数値の欄、または `その他` の自由入力の欄）。名前は `分量` と札 `任意`。 */
export function amountNumberField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: /^分量\s*任意$/ }) as HTMLInputElement;
}

/** 単位の選択。 */
export function amountUnitField(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: '単位' }) as HTMLSelectElement;
}

export function typeAmount(text: string): void {
  if (text === '') {
    fireEvent.change(amountNumberField(), { target: { value: '' } });
    return;
  }

  const values = amountFieldValuesOf(text);
  fireEvent.change(amountUnitField(), { target: { value: values.unit } });
  fireEvent.change(amountNumberField(), { target: { value: values.number } });
}
