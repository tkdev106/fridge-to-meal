// @vitest-environment jsdom
/**
 * 在庫品の削除の確認 `StockItemDeleteConfirmation`（B-69 設計 6章 規則8〜10 / ADR-052 /
 * `docs/testing.md` 4.1）。
 *
 * **仮の文言を期待値に書かない**（`docs/testing.md` 4.1）。名前（`aria-labelledby` の文）は
 * **テストが渡した名称と分量を含むか**で見る。操作は `getAllByRole('button')` を**文書順の位置**で
 * 引き（[やめる, 削除]。規則8）、**先に件数を確かめる**。**操作の名前 `やめる` / `削除` は原本 9b の
 * 文言であり**（ADR-074 結果1）、B-64 の suite は文書順の確かめにこの2つを期待値に置く。
 *
 * **`vi.fn()` で呼び出しを検めない**（`docs/testing.md` 2章）。届いた求めはテストが持つ配列に積む。
 */

import { describe, expect, it } from 'vitest';
import type { StockItemDto } from '@fridge-to-meal/contract';
import { fireEvent, render, screen } from '../../support/dom/renderComponent.js';
import { StockItemDeleteConfirmation } from '../../../src/features/pantry/StockItemDeleteConfirmation.js';

const porkWithAmount: StockItemDto = {
  id: '1',
  name: '豚こま肉',
  ingredientId: null,
  amount: '300g',
  expiryDate: null,
  useForMeals: true,
};

const cabbageWithoutAmount: StockItemDto = {
  id: '2',
  name: '白菜',
  ingredientId: null,
  amount: null,
  expiryDate: null,
  useForMeals: true,
};

function renderConfirmation(stockItem: StockItemDto = porkWithAmount, received: string[] = []) {
  return render(
    <StockItemDeleteConfirmation
      stockItem={stockItem}
      onConfirm={() => received.push('confirm')}
      onCancel={() => received.push('cancel')}
    />,
  );
}

/** 確認の操作を文書順で引く。**2つである**（規則8 — やめるが先、削除が後）。 */
function operationAt(index: number): HTMLElement {
  const operations = screen.getAllByRole('button');
  expect(operations).toHaveLength(2);

  const found = operations.at(index);
  if (found === undefined) throw new Error(`${index} 番目の操作が無い`);

  return found;
}

function cancelOperation(): HTMLElement {
  return operationAt(0);
}

function confirmOperation(): HTMLElement {
  return operationAt(1);
}

describe('在庫品の削除の確認 StockItemDeleteConfirmation', () => {
  it('確認はモーダルのダイアログとして描かれる', () => {
    // 規則8 / NFR-16: 読み上げに「確認の面」であることと、外が操作できないことを伝える。
    renderConfirmation();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('ダイアログの名前に、在庫品の名称と分量が入る', () => {
    // 規則8 / デザイン 9b: 何を消すのかを名前で読める。**文言そのものは見ない**（docs/testing.md 4.1）。
    renderConfirmation(porkWithAmount);

    const named = screen.queryAllByRole('dialog', {
      name: (name) => name.includes('豚こま肉') && name.includes('300g'),
    });
    expect(named).toHaveLength(1);
  });

  it('分量の無い在庫品では、名前に名称が入り、無い分量を言わない', () => {
    // 規則8: 分量が無ければ `<名称> を削除しますか`。`null` を文字にして出さない。
    renderConfirmation(cabbageWithoutAmount);

    const named = screen.queryAllByRole('dialog', {
      name: (name) => name.includes('白菜') && !name.includes('null'),
    });
    expect(named).toHaveLength(1);
  });

  it('押せる操作は2つである', () => {
    // 規則8: やめると削除の2つ。
    renderConfirmation();

    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('開いた直後の焦点は、先頭の操作にある', () => {
    // 規則9 / デザイン 9b: 最初の焦点は `やめる`（取り消しの無い操作に焦点を置かない）。
    renderConfirmation();

    expect(document.activeElement).toBe(cancelOperation());
  });

  it('先頭の操作を押すと、やめる求めだけが届く', () => {
    // 規則10: やめるは何も消さない。
    const received: string[] = [];
    renderConfirmation(porkWithAmount, received);

    fireEvent.click(cancelOperation());

    expect(received).toEqual(['cancel']);
  });

  it('2つめの操作を押すと、削除を確かめる求めだけが届く', () => {
    // 規則11 / FR-06: 消すのは確認の削除を押したときだけである。
    const received: string[] = [];
    renderConfirmation(porkWithAmount, received);

    fireEvent.click(confirmOperation());

    expect(received).toEqual(['confirm']);
  });

  it('Esc を押すと、やめる求めだけが届く', () => {
    // 規則10: `やめる` と Esc は同じである。
    const received: string[] = [];
    renderConfirmation(porkWithAmount, received);

    fireEvent.keyDown(cancelOperation(), { key: 'Escape' });

    expect(received).toEqual(['cancel']);
  });

  it('2つめの操作で Tab を押すと、焦点は先頭の操作へ巡る', () => {
    // 規則9: Tab は確認の2つの操作の間を巡り、外へ出ない。
    renderConfirmation();
    confirmOperation().focus();

    fireEvent.keyDown(confirmOperation(), { key: 'Tab' });

    expect(document.activeElement).toBe(cancelOperation());
  });

  it('先頭の操作で Shift+Tab を押すと、焦点は2つめの操作へ巡る', () => {
    // 規則9: Shift+Tab も同じく外へ出ない。
    renderConfirmation();
    cancelOperation().focus();

    fireEvent.keyDown(cancelOperation(), { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(confirmOperation());
  });
});

/**
 * 暗幕と操作の並び（B-64 設計 6章 規則10・11 / 原本 `confirm` / `confirmSP`）。
 *
 * **暗幕は ARIA の役割でも文でも見えない**（読み上げから外し、押しても何もしない）。そこで
 * `container.querySelector('[aria-hidden="true"]')` の1行だけ DOM を辿って引く —
 * **class 名では引かない**（ADR-055 結果1）。見た目（色・位置）は見ない。
 */

/** 暗幕。**在ることを先に確かめる。** */
function scrimIn(container: HTMLElement): HTMLElement {
  const scrim = container.querySelector<HTMLElement>('[aria-hidden="true"]');
  expect(scrim).not.toBeNull();
  if (scrim === null) throw new Error('暗幕が無い');

  return scrim;
}

describe('在庫品の削除の確認 StockItemDeleteConfirmation の暗幕と並び', () => {
  it('確認が描くもののうち、ダイアログの外にあるもの（暗幕）は読み上げから外れている', () => {
    const { container } = renderConfirmation();

    // B-64 規則10: 暗幕は読み上げから外し（`aria-hidden`）、ダイアログとは別の要素である。
    // 押せる操作は増やさない — 暗幕を button にしない（読み上げから外したものも数える）。
    const scrim = scrimIn(container);
    const dialog = screen.getByRole('dialog');
    expect([scrim.contains(dialog), dialog.contains(scrim)]).toEqual([false, false]);
    expect(screen.getAllByRole('button', { hidden: true })).toHaveLength(2);
  });

  it('暗幕を押しても、やめる求めも削除の求めも届かない', () => {
    const received: string[] = [];
    const { container } = renderConfirmation(porkWithAmount, received);

    fireEvent.click(scrimIn(container));

    // B-64 規則10 / `docs/screen-design.md` 5章: 閉じる手段は `やめる` と Esc の2つだけである。
    expect(received).toEqual([]);
    expect(screen.queryAllByRole('dialog')).toHaveLength(1);
  });

  it('確認の操作は、文書順に `やめる`・`削除` である', () => {
    renderConfirmation();

    // B-64 規則11 / B-69 規則8: 見た目は `削除` が上でも、DOM の順は `やめる` → `削除` のまま。
    expect(screen.getAllByRole('button')).toEqual([
      screen.getByRole('button', { name: 'やめる' }),
      screen.getByRole('button', { name: '削除' }),
    ]);
  });
});
