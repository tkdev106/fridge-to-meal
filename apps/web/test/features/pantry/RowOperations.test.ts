/**
 * 行の操作の状態と遷移 `RowOperations`（B-69 設計 5章 / 6章 規則2〜6・10・14）。
 *
 * 画面に描くこと（`削除` が行の中に現れる・開いた `…` の編集と削除が `…` の直後に出る）は
 * `PantryList.test.tsx` の持ち分であり、ここは**どの出来事でどの状態へ移るか**だけを見る。
 * 純粋関数なので node で回る（`docs/testing.md` 4.1）。
 */

import { describe, expect, it } from 'vitest';
import type { StockItemDto } from '@fridge-to-meal/contract';
import type {
  RowOperationEvent,
  RowOperations,
} from '../../../src/features/pantry/RowOperations.js';
import {
  IDLE,
  nextRowOperations,
  opensEditOnTap,
} from '../../../src/features/pantry/RowOperations.js';

const itemA: StockItemDto = {
  id: 'a',
  name: '豚こま肉',
  ingredientId: null,
  amount: '300g',
  expiryDate: null,
};

const itemB: StockItemDto = {
  id: 'b',
  name: '白菜',
  ingredientId: null,
  amount: null,
  expiryDate: null,
};

function revealed(stockItemId: string): RowOperations {
  return { kind: 'revealed', stockItemId };
}

function opened(stockItemId: string): RowOperations {
  return { kind: 'operationsOpen', stockItemId };
}

function confirming(stockItem: StockItemDto): RowOperations {
  return { kind: 'confirming', stockItem };
}

function swiped(stockItemId: string): RowOperationEvent {
  return { kind: 'swiped', stockItemId };
}

function toggled(stockItemId: string): RowOperationEvent {
  return { kind: 'operationsToggled', stockItemId };
}

function deleteChosen(stockItem: StockItemDto): RowOperationEvent {
  return { kind: 'deleteChosen', stockItem };
}

const tapped: RowOperationEvent = { kind: 'tapped' };
const dismissed: RowOperationEvent = { kind: 'dismissed' };
const confirmed: RowOperationEvent = { kind: 'confirmed' };

describe('行の操作 nextRowOperations のスワイプ', () => {
  it('何も出ていない行をなぞると、その行に削除が現れる', () => {
    // 規則1・2: なぞっただけでは消えず、削除の操作が現れるだけである。
    expect(nextRowOperations(IDLE, swiped('a'))).toEqual(revealed('a'));
  });

  it('削除が現れているときに別の行をなぞると、なぞった行に移る', () => {
    // 規則2: 削除が現れるのは1度に1行だけ。
    expect(nextRowOperations(revealed('a'), swiped('b'))).toEqual(revealed('b'));
  });

  it('削除が現れている行をもう一度なぞっても、現れたままである', () => {
    // 規則2: 引っ込めるのはタップである（規則4）。
    expect(nextRowOperations(revealed('a'), swiped('a'))).toEqual(revealed('a'));
  });
});

describe('行の操作 nextRowOperations の行末の操作', () => {
  it('何も出ていないときに行の操作を押すと、その行の `…` が開く', () => {
    // 規則3 / 論点4 #2: 行末の `…` から編集と削除に届く。
    expect(nextRowOperations(IDLE, toggled('a'))).toEqual(opened('a'));
  });

  it('開いている行の `…` をもう一度押すと、閉じる', () => {
    // 規則3: 開閉ボタンの形である。
    expect(nextRowOperations(opened('a'), toggled('a'))).toEqual(IDLE);
  });

  it('`…` が開いているときに別の行の操作を押すと、その行の `…` に移る', () => {
    // 規則3: 開くのは1度に1行だけ。
    expect(nextRowOperations(opened('a'), toggled('b'))).toEqual(opened('b'));
  });

  it('削除が現れているときに行の操作を押すと、`…` が開き削除は消える', () => {
    // 規則5: 別の操作を始めたら前のものは閉じる。
    expect(nextRowOperations(revealed('a'), toggled('a'))).toEqual(opened('a'));
  });

  it('`…` が開いているときに別の行をなぞると、`…` は閉じてなぞった行に削除が現れる', () => {
    // 規則5: なぞれば開いた `…` は閉じる。
    expect(nextRowOperations(opened('a'), swiped('b'))).toEqual(revealed('b'));
  });
});

describe('行の操作 nextRowOperations のタップ', () => {
  it('削除が現れているときのタップは、それを閉じる', () => {
    // 規則4: タップは出ているものを閉じるだけである。
    expect(nextRowOperations(revealed('a'), tapped)).toEqual(IDLE);
  });

  it('`…` が開いているときのタップは、それを閉じる', () => {
    // 規則4。
    expect(nextRowOperations(opened('a'), tapped)).toEqual(IDLE);
  });
});

describe('行のタップで編集を開いてよいか opensEditOnTap', () => {
  it('何も出ていないときは開いてよい', () => {
    // 規則4 / FR-05: 行のタップが編集への導線である。
    expect(opensEditOnTap(IDLE)).toBe(true);
  });

  it('削除が現れているときは開かない', () => {
    // 規則4: 取り消しの無い操作の隣で別の画面を開かない。
    expect(opensEditOnTap(revealed('a'))).toBe(false);
  });

  it('`…` が開いているときは開かない', () => {
    // 規則4。
    expect(opensEditOnTap(opened('a'))).toBe(false);
  });

  it('確認を出しているときは開かない', () => {
    // 規則14: 確認を出している間、一覧の操作は何もしない。
    expect(opensEditOnTap(confirming(itemA))).toBe(false);
  });
});

describe('行の操作 nextRowOperations の確認', () => {
  it('現れた削除を選ぶと、その在庫品の確認に移る', () => {
    // 規則6・12 / FR-06: 確認は開いた時点の在庫品1件を抱える。
    expect(nextRowOperations(revealed('a'), deleteChosen(itemA))).toEqual(confirming(itemA));
  });

  it('開いた `…` の削除を選ぶと、同じ確認に移る', () => {
    // 規則6: 開いた `…` の削除と現れた削除はどちらも同じ確認を開く。
    expect(nextRowOperations(opened('a'), deleteChosen(itemA))).toEqual(confirming(itemA));
  });

  it('確認をやめると、何も出ていない状態に戻る', () => {
    // 規則10: 現れていた削除も開いた `…` も残さない。
    expect(nextRowOperations(confirming(itemA), dismissed)).toEqual(IDLE);
  });

  it('確認で削除を確かめると、何も出ていない状態に戻る', () => {
    // 規則11: 確認を閉じてから削除を送る。
    expect(nextRowOperations(confirming(itemA), confirmed)).toEqual(IDLE);
  });

  it('開いた `…` を閉じる求めは、それを閉じる', () => {
    // 規則13: 開いた `…` を Esc で閉じる。
    expect(nextRowOperations(opened('a'), dismissed)).toEqual(IDLE);
  });

  it.each([
    ['別の行をなぞる', swiped('b')],
    ['行をタップする', tapped],
    ['別の行の操作を押す', toggled('b')],
    ['別の在庫品の削除を選ぶ', deleteChosen(itemB)],
  ])('確認を出している間は、%s出来事で状態が変わらない', (_label, event) => {
    // 規則14: `dismissed` と `confirmed` 以外の出来事は状態を変えない（aria-modal と同じ約束）。
    expect(nextRowOperations(confirming(itemA), event)).toEqual(confirming(itemA));
  });
});
