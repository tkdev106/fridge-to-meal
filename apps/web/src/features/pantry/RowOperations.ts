/**
 * 在庫一覧の行の操作の状態と遷移（B-69 設計 5章 / 6章 規則2〜6・10・14）。
 *
 * **React も DOM の型も import しない**（先行 `SwipeGesture.ts`）。
 */

import type { StockItemDto } from '@fridge-to-meal/contract';

export type RowOperations =
  | { readonly kind: 'idle' }
  | { readonly kind: 'revealed'; readonly stockItemId: string } // スワイプで `削除` が現れている
  | { readonly kind: 'operationsOpen'; readonly stockItemId: string } // `…` を開いている（編集・削除が出ている）
  | { readonly kind: 'confirming'; readonly stockItem: StockItemDto }; // 確認を出している

export type RowOperationEvent =
  | { readonly kind: 'swiped'; readonly stockItemId: string }
  | { readonly kind: 'tapped' }
  | { readonly kind: 'operationsToggled'; readonly stockItemId: string }
  | { readonly kind: 'deleteChosen'; readonly stockItem: StockItemDto } // 現れた `削除` か、開いた `…` の `削除`
  | { readonly kind: 'dismissed' } // やめる / Esc
  | { readonly kind: 'confirmed' };

/** 何も出ていない状態。`kind` が `idle` の値はこの1つしか無い。 */
export const IDLE: RowOperations = { kind: 'idle' };

/**
 * 出来事1つで次の状態を決める。
 *
 * **確認を出している間は `dismissed` と `confirmed` だけが効く**（規則14）— 確認は
 * `aria-modal` であり、外の一覧の操作（なぞる・タップ・`…`・開いた中身）は何もしない約束を
 * 読み上げだけでなく振る舞いでも守る。
 *
 * それ以外のときは、**出ているものは1度に1つだけ**である（規則2・3・5）— 新しい操作を始めれば
 * 前のものは閉じる。そのため遷移は前の状態をほとんど見ず、見るのは `…` の開閉（同じ行を
 * もう一度押せば閉じる）だけである。
 */
export function nextRowOperations(state: RowOperations, event: RowOperationEvent): RowOperations {
  if (state.kind === 'confirming') {
    return event.kind === 'dismissed' || event.kind === 'confirmed' ? IDLE : state;
  }

  switch (event.kind) {
    case 'swiped':
      // 現れている行をもう一度なぞっても現れたまま（規則2）。引っ込めるのはタップである。
      return { kind: 'revealed', stockItemId: event.stockItemId };
    case 'operationsToggled':
      // 開閉ボタンの形（規則3）。開いている行の `…` だけが閉じる側に倒れる。
      return state.kind === 'operationsOpen' && state.stockItemId === event.stockItemId
        ? IDLE
        : { kind: 'operationsOpen', stockItemId: event.stockItemId };
    case 'deleteChosen':
      // 現れた `削除` も開いた中身の `削除` も同じ確認を開く（規則6）。抱えるのは
      // **開いた時点の在庫品**である（規則12）。
      return { kind: 'confirming', stockItem: event.stockItem };
    case 'tapped':
    case 'dismissed':
    case 'confirmed':
      return IDLE;
  }
}

/**
 * 行のタップで編集を開いてよいか（規則4）。
 *
 * **何も出ていないときだけ**である。`削除` が現れている・`…` が開いている・確認を出している
 * ときのタップは、出ているものを閉じるだけにする — 取り消しの無い操作の隣で別の画面を開かない。
 */
export function opensEditOnTap(state: RowOperations): boolean {
  return state.kind === 'idle';
}
