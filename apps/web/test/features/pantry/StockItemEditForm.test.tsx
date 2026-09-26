// @vitest-environment jsdom
/**
 * 編集の画面 `StockItemEditForm`（FR-05 / B-55 設計 4章 / 5章 / 6章 規則1〜8・18 / 7章 /
 * ADR-052 / `docs/testing.md` 4.1）。
 *
 * 欄の値の作り方（`stockItemEditValuesOf`）と空欄の読み替え（`updateStockItemInputOf`）は
 * `StockItemFormValues.test.ts`、断りから案内を**選ぶ判断**は `UpdateFailureNotice.test.ts` が
 * 既に押さえている。ここで確かめるのは**切り出せないもの**だけ — 欄に何が出ているか、
 * 打った値がどう更新の口へ届くか、選ばれた案内が画面にどう現れるかである。
 *
 * **仮の文言と記号を期待値に書かない**（ADR-052 結果2 / `docs/testing.md` 4.1 / 設計 規則19）。
 * 見出しも保存の名札も「←」も案内の文面も未確定である（`docs/screen-design.md` 論点3）。
 * 観察はこの4つだけで行う。
 *
 * - **欄に出ている値** … `queryByDisplayValue` に**テストが渡した／打った値**を当てる
 * - **更新の口へ届いたもの** … `FixedStockItemRequests` が持つ配列の中身（識別子と入力の組）
 * - **押せる操作** … `getAllByRole('button')` を**文書順の位置**で引き、先に件数を確かめる
 * - **案内** … `queryAllByRole('paragraph')` の**数だけ**
 *
 * **`vi.fn()` で呼び出し回数を数えない**（`docs/testing.md` 2章）。**閉じたことはここでは
 * 観ない** — 「一覧が出ている」で観るのは `PantryTab.test.tsx` の持ち分である。
 */

import { describe, expect, it } from 'vitest';
import type { StockItemDto } from '@fridge-to-meal/contract';
import { act, fireEvent, render, screen, waitFor } from '../../support/dom/renderComponent.js';
import { FixedStockItemRequests } from '../../support/server/FixedStockItemRequests.js';
import type { FixedStockItemRequestsOptions } from '../../support/server/FixedStockItemRequests.js';
import { StockItemEditForm } from '../../../src/features/pantry/StockItemEditForm.js';

/**
 * 一覧へ戻す口。**この観点では閉じたかどうかを観ない**（`docs/testing.md` 2章。先行
 * `StockItemForm.test.tsx`）— 閉じたことは `PantryTab.test.tsx` が「一覧が出ている」で観る。
 */
const ignoreClose = () => {};

function stockItemOf(overrides: Partial<StockItemDto> = {}): StockItemDto {
  return {
    id: '1',
    name: 'にんじん',
    ingredientId: null,
    amount: '2本',
    expiryDate: '2026-09-25',
    ...overrides,
  };
}

/** 打つ値の標本。**期待値は各 `it` の literal で別に置く**（`docs/testing.md` 3章）。 */
const typedValues = { amount: '300g', expiryDate: '2026-09-30' } as const;

function renderEditForm(
  stockItem: StockItemDto = stockItemOf(),
  options: FixedStockItemRequestsOptions = {},
) {
  const requests = new FixedStockItemRequests(options);

  render(
    <StockItemEditForm
      stockItem={stockItem}
      onUpdate={requests.updateStockItem}
      onClose={ignoreClose}
    />,
  );

  return requests;
}

/**
 * 分量の欄。**`textbox` はこれ1つだけである**（設計 規則1・5）— 食材名の欄は無く、期限は
 * `type="date"` なのでこの役割に入らない。
 *
 * **`instanceof HTMLInputElement` で絞らない** — 役割で引いている以上、入力の欄であることは
 * 問い合わせの側が保証している（ADR-052 結果3。先行 `StockItemForm.test.tsx`）。
 */
function amountField(): HTMLInputElement {
  return screen.getByRole('textbox') as HTMLInputElement;
}

/**
 * 期限の欄。**この suite で唯一もろい引き方である。**
 *
 * `input[type="date"]` は ARIA の役割に写らないため `textbox` で引けず、ラベルの文言は仮である
 * （設計 規則19）。そこで**いま出ている値で引く** — 開いた直後の値はテストが渡した在庫品の
 * ものであり（規則2）、分量の値と重ならないようにしてある。
 */
function expiryDateField(currentValue: string): HTMLElement {
  return screen.getByDisplayValue(currentValue);
}

/**
 * 押せる操作を**文書順**で返す（設計 規則5）。
 *
 * 編集の画面の操作は2つで、**先頭が閉じる操作**（規則7・8）、**末尾が保存**である
 * （「保存してもう1件」は置かない。規則5）。**この数を先に確かめる** — 崩れた回に閉じる操作を
 * 保存として押してしまうと、テストは何が壊れたか読めない形で落ちる。**名札は見ない**（規則19）。
 */
function operations(): readonly HTMLElement[] {
  const found = screen.getAllByRole('button');
  expect(found).toHaveLength(2);

  return found;
}

function operationAt(index: number): HTMLElement {
  const found = operations().at(index);
  if (found === undefined) throw new Error(`${index} 番目の操作が無い`);

  return found;
}

/** 保存。文書順の末尾である（設計 規則5）。 */
function saveOperation(): HTMLElement {
  return operationAt(-1);
}

/** 出ている案内。**数だけを見る**（設計 規則19 / 先行 `StockItemForm.test.tsx`）。 */
function notices(): readonly HTMLElement[] {
  return screen.queryAllByRole('paragraph');
}

/**
 * いま焦点の当たっている要素。
 *
 * **`autoFocus` 属性の有無を見ない**（ADR-052 結果3。先行 `StockItemForm.test.tsx`）— 属性は
 * 当て方（実装の手段）であり、利用者に見えるのは「打ち始めた文字がどの欄に入るか」である。
 */
function focused(): HTMLElement {
  const element = document.activeElement;

  // どこにも焦点が当たっていないとき、jsdom が返すのは `<body>` である。
  if (element === null || element === document.body) {
    throw new Error('開いた直後に焦点の当たった欄が無い（設計 規則18）');
  }

  return element as HTMLElement;
}

/** 2つの欄を打つ。期限は**開いた直後の値**で引く（`expiryDateField` の前提）。 */
function fillTwoFields(stockItem: StockItemDto = stockItemOf()): void {
  fireEvent.change(amountField(), { target: { value: typedValues.amount } });
  fireEvent.change(expiryDateField(stockItem.expiryDate ?? ''), {
    target: { value: typedValues.expiryDate },
  });
}

describe('編集の画面 StockItemEditForm の2つの欄', () => {
  it('開いた直後の分量の欄には、その在庫品の分量が出る', () => {
    renderEditForm(stockItemOf({ amount: '2本' }));

    // 規則2 / NFR-15: その行の値をそのまま置き、空に戻さない — 分量だけ直したい回に期限を
    // 打ち直させない。
    expect(amountField().value).toBe('2本');
  });

  it('開いた直後の期限の欄には、その在庫品の期限が出る', () => {
    renderEditForm(stockItemOf({ expiryDate: '2026-09-25' }));

    // 規則2: 期限も同じ。**役割で引けないので、渡した値そのもので引く**（`expiryDateField`）。
    expect(screen.queryByDisplayValue('2026-09-25')).not.toBeNull();
  });

  it('分量も期限も未設定の在庫品を開くと、どちらの欄も空である', () => {
    renderEditForm(stockItemOf({ amount: null, expiryDate: null }));

    // 規則2 / FR-13: 未設定（`null`）は空文字に倒す — 欄に `null` を描かせない。
    // **値が空の入力が2つである**ことで「どちらも空」を観る（欄は分量と期限の2つだけ。規則1）。
    expect(amountField().value).toBe('');
    expect(screen.getAllByDisplayValue('')).toHaveLength(2);
  });

  it('在庫品の名称を画面に出す', () => {
    renderEditForm(stockItemOf({ name: 'にんじん' }));

    // 規則1: 名称は**出すが変えられない** — 何を編集しているか分からないまま打たせない。
    expect(screen.queryByText('にんじん')).not.toBeNull();
  });

  it('名称を書き換える欄は置かない', () => {
    renderEditForm();

    // 規則1 / `UpdateStockItemInput`: 送れない値を編集させない。欄は分量（`textbox`）と期限
    // （`type="date"`）の2つだけで、登録の画面の食材名の欄（`combobox`。B-50c）は無い。
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });
});

describe('編集の画面 StockItemEditForm の保存', () => {
  it('開いた直後に打ち始めた文字は、分量として更新の口へ届く', () => {
    const requests = renderEditForm(stockItemOf(), { update: [{ outcome: 'updated' }] });

    fireEvent.change(focused(), { target: { value: '300g' } });
    fireEvent.click(saveOperation());

    // 規則18 / NFR-15: 開いた直後の焦点は分量の欄である（編集できる先頭の欄）。
    // **どの欄かは「打った文字がどこへ届いたか」で観る**（先行 `StockItemForm.test.tsx`）。
    expect(requests.receivedUpdates.at(0)?.input.amount).toBe('300g');
  });

  it('保存を押すと、打った分量と期限が、その在庫品の識別子とともに更新の口へ届く', () => {
    const stockItem = stockItemOf({ id: '1' });
    const requests = renderEditForm(stockItem, { update: [{ outcome: 'updated' }] });

    fillTwoFields(stockItem);
    fireEvent.click(saveOperation());

    // 規則1・13 / FR-05: 送るのは分量と期限だけで、**名称のキーを持たない**
    // （`UpdateStockItemInput` に名称が無い）。世帯は運ばない（C-9）。
    expect(requests.receivedUpdates).toEqual([
      { id: '1', input: { amount: '300g', expiryDate: '2026-09-30' } },
    ]);
  });

  it('欄を空にして保存すると、未設定として更新の口へ届く', () => {
    const stockItem = stockItemOf();
    const requests = renderEditForm(stockItem, { update: [{ outcome: 'updated' }] });

    fireEvent.change(amountField(), { target: { value: '' } });
    fireEvent.change(expiryDateField(stockItem.expiryDate ?? ''), { target: { value: '' } });
    fireEvent.click(saveOperation());

    // 規則3 / FR-13 / B-06 規則3: 空欄は「消す」を表し、**キーを省略せず `null` を送る** —
    // 省略に読み替えると、消したい回に今の値が残る。
    expect(requests.receivedUpdates).toEqual([
      { id: '1', input: { amount: null, expiryDate: null } },
    ]);
  });

  it('値を1つも変えずに保存しても、更新の口へ届く', () => {
    const requests = renderEditForm(stockItemOf({ amount: '2本', expiryDate: '2026-09-25' }), {
      update: [{ outcome: 'updated' }],
    });

    fireEvent.click(saveOperation());

    // 規則6: **差分を見て止めない** — 送るかどうかの判断が画面とサーバの2か所に増える。
    expect(requests.receivedUpdates).toEqual([
      { id: '1', input: { amount: '2本', expiryDate: '2026-09-25' } },
    ]);
  });

  it('保存の操作は1つである', () => {
    renderEditForm();

    // 規則5: 「保存してもう1件」を置かない — 編集は在庫品1件に閉じ、次の1件が無い
    // （FR-08 は登録の話である）。先頭が閉じる操作、末尾が保存の2つだけである。
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('送っている間にもう一度保存を押しても、更新の口へは1件しか届かない', async () => {
    const stockItem = stockItemOf();
    const requests = renderEditForm(stockItem, {
      // 結末を保留する口。押した時点ではまだ返らない（`support/HeldDelivery.ts`）。
      update: [{ heldUntilSettled: { outcome: 'updated' } }],
    });

    fillTwoFields(stockItem);
    fireEvent.click(saveOperation());

    // 前提: 1件は送られ、結末はまだ返っていない。
    expect(requests.receivedUpdates).toHaveLength(1);

    fireEvent.click(saveOperation());

    // 規則7: 送っている間は保存が効かない。二重に送ると往復を1つ無駄にし、2度目の結末で
    // 画面の読みが上書きされる。
    expect(requests.receivedUpdates).toEqual([
      { id: '1', input: { amount: '300g', expiryDate: '2026-09-30' } },
    ]);

    // 保留を解いてから終える — 届いた更新を `act` の中で起こすためである。
    await act(async () => {
      requests.settle();
    });
  });
});

describe('編集の画面 StockItemEditForm の案内', () => {
  it('更新が断られると案内が1つ出る', async () => {
    renderEditForm(stockItemOf(), {
      update: [{ outcome: 'rejected', rule: 'expiryDate.format' }],
    });

    // 押す前には案内が出ていない（出ていたら「断りで出た」と読めない）。
    expect(notices()).toHaveLength(0);

    fireEvent.click(saveOperation());

    // ADR-032 決定3 / 7章 行2: 断りは案内1つで伝える。**文面は見ない**（未確定である）。
    await waitFor(() => {
      expect(notices()).toHaveLength(1);
    });
  });

  it('見つからないという断りでも案内が1つ出る', async () => {
    renderEditForm(stockItemOf(), {
      update: [{ outcome: 'rejected', rule: 'update.notFound' }],
    });

    fireEvent.click(saveOperation());

    // **ADR-050 結果5** / 規則10: **削除と対になる読みである** — `deleteFailureNoticeOf` は
    // `delete.notFound` を「すでに消えている」と読んで**案内を出さない**が、更新では出す。
    // 利用者は書いた内容を持っており、消えた相手に書き戻せない以上伝えるべきことがある。
    await waitFor(() => {
      expect(notices()).toHaveLength(1);
    });
  });

  it('更新が失敗すると案内が1つ出る', async () => {
    renderEditForm(stockItemOf(), { update: [{ outcome: 'failed' }] });

    fireEvent.click(saveOperation());

    // 7章 行4 / 規則11: 理由の無い失敗も伝える。**原因は断定しない**（`unavailable`）。
    await waitFor(() => {
      expect(notices()).toHaveLength(1);
    });
  });

  it('更新が通った回は案内を出さない', async () => {
    const requests = renderEditForm(stockItemOf(), { update: [{ outcome: 'updated' }] });

    fireEvent.click(saveOperation());
    expect(requests.receivedUpdates).toHaveLength(1);

    // 結末は非同期に届くので、**届いた更新を `act` の中で起こしてから**木を見る。
    // 押した直後の木を見ると「まだ届いていない」だけの状態を通してしまう。
    await act(async () => {});

    // 規則8 / 7章 行5: 通った回に案内は要らない（`updateFailureNoticeOf` が `null` を返す）。
    expect(notices()).toHaveLength(0);
  });

  it('更新が断られても、打った分量は欄に残る', async () => {
    const stockItem = stockItemOf();
    renderEditForm(stockItem, { update: [{ outcome: 'rejected', rule: 'expiryDate.format' }] });

    fillTwoFields(stockItem);
    fireEvent.click(saveOperation());

    await waitFor(() => {
      expect(notices()).toHaveLength(1);
    });

    // 規則8 / NFR-15 / 7章 行2: 入力を消さない。打ち直しは1件10秒に収まらない。
    expect(screen.queryByDisplayValue('300g')).not.toBeNull();
  });
});
