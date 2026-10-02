/**
 * 行の中に置かれた操作（`…`・開いた `…` の編集と削除・現れた `削除`）を押す（B-69 設計 6章 規則7）。
 *
 * 指でもマウスでも、押すことは **押下 → 離上 → click** の3つとして届き、押下と離上は
 * 行（`<li>`）まで泡立つ。**3つを同じ座標で送る** — click だけを送ると、行が押下と離上を
 * 「タップ」と読んで編集を開く経路（規則7 が断っているもの）を素通りし、確かめたことにならない。
 *
 * **判断は本体の持ち分**で、ここは入力を送るだけである。
 */

import { fireEvent } from './renderComponent.js';

export function pressOperation(operation: HTMLElement): void {
  fireEvent.pointerDown(operation, { pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(operation, { pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.click(operation);
}
