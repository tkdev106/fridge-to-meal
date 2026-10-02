/**
 * 在庫品の削除の確認（B-69 設計 5章 / 6章 規則8〜10 / デザイン 9b）。`role="dialog"` の自前の部品。
 *
 * **`<dialog>` を使わない**（B-69 設計 10章）— jsdom に `showModal` が無く、描いて確かめられない
 * （ADR-052）。そのため Esc と Tab の巡回はこの部品の `onKeyDown` が持つ。
 *
 * **SP の下からの面と PC の中央は同じ部品である。** どこにどう出すか（位置・暗幕・動き）は
 * 見た目の周（B-64 / B-60）の持ち分で、ここは文と2つの操作だけを置く。
 *
 * **開いた直後の焦点は `やめる`**（規則9）— 取り消しの無い操作に焦点を置かない。DOM の並びも
 * `やめる` → `削除` である（規則8。見た目の並べ替えは B-64）。
 */

import type { JSX, KeyboardEvent } from 'react';
import { useId, useRef } from 'react';
import type { StockItemDto } from '@fridge-to-meal/contract';

export type StockItemDeleteConfirmationProps = {
  stockItem: StockItemDto;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * 確認の `削除` を押せなくするか（B-70 / FR-41。接続が切れている間）。省略は `false`。
   * **やめる・Esc は止めない** — どちらも書き込みを伴わない（先行 `SettingsScreen` の確定）。
   */
  confirmDisabled?: boolean;
};

/**
 * 確認の文（規則8 / デザイン 9b）。**分量が無ければ言わない** — `null` を文字にして出さない。
 */
function questionOf(stockItem: StockItemDto): string {
  const target =
    stockItem.amount === null ? stockItem.name : `${stockItem.name} ${stockItem.amount}`;

  return `${target} を削除しますか`;
}

export function StockItemDeleteConfirmation({
  stockItem,
  onConfirm,
  onCancel,
  confirmDisabled = false,
}: StockItemDeleteConfirmationProps): JSX.Element {
  const questionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // `やめる` と Esc は同じである（規則10）。
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }

    // Tab / Shift+Tab は2つの操作の間を巡り、外へ出ない（規則9）。操作が2つしか無いので、
    // どちら向きでも「もう片方へ」になる。
    if (event.key === 'Tab') {
      event.preventDefault();
      const next = document.activeElement === cancelRef.current ? confirmRef : cancelRef;
      next.current?.focus();
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={questionId} onKeyDown={handleKeyDown}>
      <p id={questionId}>{questionOf(stockItem)}</p>
      <button ref={cancelRef} type="button" autoFocus onClick={onCancel}>
        やめる
      </button>
      <button ref={confirmRef} type="button" disabled={confirmDisabled} onClick={onConfirm}>
        削除
      </button>
    </div>
  );
}
