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
 * **文言は ADR-074 で確定した**（`docs/design/`。B-65）。確定した文言を期待値に書くのは末尾の
 * B-65 の suite だけで、それより前の観点は文言に頼らず、次の4つで観る（B-55 のときの書き方の
 * まま残す — 文言が変わっても振る舞いの観点が赤くならないようにするため）。
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
import { amountNumberField, amountUnitField, typeAmount } from '../../support/dom/typeAmount.js';
import { FixedBackNavigation } from '../../support/backNavigation/FixedBackNavigation.js';
import { FixedStockItemRequests } from '../../support/server/FixedStockItemRequests.js';
import type { FixedStockItemRequestsOptions } from '../../support/server/FixedStockItemRequests.js';
import { BackNavigationProvider } from '../../../src/backNavigation/BackHandler.js';
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
    useForMeals: true,
    ...overrides,
  };
}

/**
 * 残日数を数える基準日（B-65 設計 5章）。**本体は現在時刻を読まず、呼び出し側が渡す**
 * （`docs/testing.md` 5章）。B-65 より前の観点にとっては本題でないので固定で渡す。
 */
const today = '2026-09-20';

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
      today={today}
    />,
  );

  return requests;
}

/**
 * 期限の欄。**この suite で唯一もろい引き方である。**
 *
 * `input[type="date"]` は ARIA の役割に写らないため `textbox` で引けない。B-55 の観点はラベルの
 * 文言に頼らずに書いたので、**いま出ている値で引く** — 開いた直後の値はテストが渡した在庫品の
 * ものであり（規則2）、分量の値と重ならないようにしてある。
 */
function expiryDateField(currentValue: string): HTMLElement {
  return screen.getByDisplayValue(currentValue);
}

/**
 * 保存せずに閉じる操作（`戻る` と `閉じる`。規則7・8 / B-65 規則2 / B-65b 規則9）。名前は原本から
 * 取った文言で仮ではない（ADR-074）。
 */
function closeOperations(): readonly HTMLElement[] {
  return [
    ...screen.queryAllByRole('button', { name: '戻る' }),
    ...screen.queryAllByRole('button', { name: '閉じる' }),
  ];
}

/**
 * 保存。**文書順の末尾である**（設計 規則5）。
 *
 * 保存せずに閉じる操作（`closeOperations`）を除けば、編集の画面の操作は保存の1つだけである
 * （「保存してもう1件」は置かない。規則5）。**この数を先に確かめる** — 崩れた回に閉じる操作を
 * 保存として押してしまうと、テストは何が壊れたか読めない形で落ちる。**名札では引かない**（規則19。
 * 送っている間は名札が変わる）。
 */
function saveOperation(): HTMLElement {
  const closes = closeOperations();
  const all = screen.getAllByRole('button');
  expect(all.filter((button) => !closes.includes(button))).toHaveLength(1);

  const found = all.at(-1);
  if (found === undefined) throw new Error('保存の操作が無い');

  return found;
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
  typeAmount(typedValues.amount);
  fireEvent.change(expiryDateField(stockItem.expiryDate ?? ''), {
    target: { value: typedValues.expiryDate },
  });
}

describe('編集の画面 StockItemEditForm の2つの欄', () => {
  it('開いた直後の分量の欄には、その在庫品の分量が出る', () => {
    renderEditForm(stockItemOf({ amount: '2本' }));

    // 規則2 / NFR-15: その行の値をそのまま置き、空に戻さない — 分量だけ直したい回に期限を
    // 打ち直させない。
    expect(amountNumberField().value).toBe('2');
    expect(amountUnitField().value).toBe('本');
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
    expect(amountNumberField().value).toBe('');
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
    expect(screen.queryAllByRole('combobox', { name: '食材名' })).toHaveLength(0);
  });
});

describe('編集の画面 StockItemEditForm の保存', () => {
  it('開いた直後に打ち始めた文字は、分量として更新の口へ届く', () => {
    const requests = renderEditForm(stockItemOf(), { update: [{ outcome: 'updated' }] });

    fireEvent.change(focused(), { target: { value: '300' } });
    fireEvent.click(saveOperation());

    // 規則18 / NFR-15: 開いた直後の焦点は分量の欄である（編集できる先頭の欄）。
    // **どの欄かは「打った文字がどこへ届いたか」で観る**（先行 `StockItemForm.test.tsx`）。
    // 単位は開いた在庫品の分量「2本」から読み戻した `本` のままである。
    expect(requests.receivedUpdates.at(0)?.input.amount).toBe('300本');
  });

  it('保存を押すと、打った分量と期限が、その在庫品の識別子とともに更新の口へ届く', () => {
    const stockItem = stockItemOf({ id: '1' });
    const requests = renderEditForm(stockItem, { update: [{ outcome: 'updated' }] });

    fillTwoFields(stockItem);
    fireEvent.click(saveOperation());

    // 規則1・13 / FR-05: 送るのは分量と期限だけで、**名称のキーを持たない**
    // （`UpdateStockItemInput` に名称が無い）。世帯は運ばない（C-9）。
    expect(requests.receivedUpdates).toEqual([
      { id: '1', input: { amount: '300g', expiryDate: '2026-09-30', useForMeals: true } },
    ]);
  });

  it('欄を空にして保存すると、未設定として更新の口へ届く', () => {
    const stockItem = stockItemOf();
    const requests = renderEditForm(stockItem, { update: [{ outcome: 'updated' }] });

    typeAmount('');
    fireEvent.change(expiryDateField(stockItem.expiryDate ?? ''), { target: { value: '' } });
    fireEvent.click(saveOperation());

    // 規則3 / FR-13 / B-06 規則3: 空欄は「消す」を表し、**キーを省略せず `null` を送る** —
    // 省略に読み替えると、消したい回に今の値が残る。
    expect(requests.receivedUpdates).toEqual([
      { id: '1', input: { amount: null, expiryDate: null, useForMeals: true } },
    ]);
  });

  it('値を1つも変えずに保存しても、更新の口へ届く', () => {
    const requests = renderEditForm(stockItemOf({ amount: '2本', expiryDate: '2026-09-25' }), {
      update: [{ outcome: 'updated' }],
    });

    fireEvent.click(saveOperation());

    // 規則6: **差分を見て止めない** — 送るかどうかの判断が画面とサーバの2か所に増える。
    expect(requests.receivedUpdates).toEqual([
      { id: '1', input: { amount: '2本', expiryDate: '2026-09-25', useForMeals: true } },
    ]);
  });

  it('保存の操作は1つである', () => {
    renderEditForm();

    // 規則5: 「保存してもう1件」を置かない — 編集は在庫品1件に閉じ、次の1件が無い
    // （FR-08 は登録の話である）。閉じる操作が2つ（`戻る` / `閉じる`。B-65b 規則9）と保存の1つである。
    expect(screen.getAllByRole('button')).toHaveLength(3);
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
      { id: '1', input: { amount: '300g', expiryDate: '2026-09-30', useForMeals: true } },
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

    // ADR-032 決定3 / 7章 行2: 断りは案内1つで伝える。**文面は見ない**（文面は B-65 の suite が見る）。
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
    expect(amountNumberField().value).toBe('300');
    expect(amountUnitField().value).toBe('g');
  });
});

/**
 * 接続が切れている間（B-70 設計 6章 規則6・10・14 / 7章 行1 / FR-41 / FR-05 / NFR-15）。
 *
 * **止めるのは保存と、欄での Enter（`<form>` の送信）である。** 打った分量は消さない。
 * 保存せずに閉じることは止めない（規則6）。
 */
describe('編集の画面 StockItemEditForm の接続が切れている間', () => {
  /** `offline` を後から切り替えるために、描き直しの口を返す。 */
  function renderEditFormWith(offline: boolean, onClose: () => void = ignoreClose) {
    const requests = new FixedStockItemRequests({ update: [{ outcome: 'updated' }] });
    const stockItem = stockItemOf();

    const rendered = render(
      <StockItemEditForm
        stockItem={stockItem}
        onUpdate={requests.updateStockItem}
        onClose={onClose}
        offline={offline}
        today={today}
      />,
    );

    return {
      requests,
      setOffline: (next: boolean) => {
        rendered.rerender(
          <StockItemEditForm
            stockItem={stockItem}
            onUpdate={requests.updateStockItem}
            onClose={onClose}
            offline={next}
            today={today}
          />,
        );
      },
    };
  }

  it('接続が切れている間は、保存が押せない', () => {
    renderEditFormWith(true);

    // 規則10 / FR-41: 更新は書き込みを伴う操作である。素の `disabled` プロパティで見る。
    expect((saveOperation() as HTMLButtonElement).disabled).toBe(true);
  });

  it('接続が切れている間は、欄で Enter しても更新の口へ何も届かない', () => {
    const { requests } = renderEditFormWith(true);

    typeAmount(typedValues.amount);
    fireEvent.submit(amountNumberField());

    // 規則10 / 7章 行1: 保存の本体で止める（ボタンを押さない経路も塞ぐ）。
    expect(requests.receivedUpdates).toEqual([]);
  });

  it('接続が切れている間に打った分量は、欄に残る', () => {
    const { setOffline } = renderEditFormWith(true);

    typeAmount(typedValues.amount);
    setOffline(false);

    // 規則10（入力は消さない）・規則14（戻っても欄を作り直さない）。
    expect(amountNumberField().value).toBe('300');
    expect(amountUnitField().value).toBe('g');
  });

  it('接続が切れていても、保存せずに閉じられる', () => {
    const closed: string[] = [];
    renderEditFormWith(true, () => closed.push('close'));

    fireEvent.click(screen.getByRole('button', { name: '戻る' }));

    // 規則6: 保存せずに閉じるのは遷移である。
    expect(closed).toHaveLength(1);
  });
});

/**
 * 見た目と文言（B-65 設計 6章 規則2・3・5・6・8・9・13 / ADR-074 / FR-05 / FR-13 / NFR-17）。
 *
 * **文言は ADR-074 で確定した**（`docs/design/` の原本 ★10・11）ので、ここでは文言を期待値に
 * literal で書く。CSS の値は見ない（ADR-055 決定3）。並びは**文書順**で観る（先行
 * `MealDetail.test.tsx` の `precedes`）。
 *
 * 期限の欄は役割に写らない（`type="date"`）ので、**欄の名前で引く**（`getByLabelText`）。
 * 欄の名前の後ろに箱の文字（`日付を選ぶ` / 日付 / 残日数）が続いて読まれてよい（規則6）ため、
 * 頭だけを当てる。
 */

/** `node` が `other` より前に在るか（文書の並びで。先行 `MealDetail.test.tsx`）。 */
function precedes(node: Node, other: Node): boolean {
  return (node.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** 分量の欄。名前は `分量` と札 `任意`（規則3）。 */
function namedAmountField(): HTMLElement {
  return screen.getByRole('textbox', { name: /^分量\s*任意$/ });
}

/** 期限の欄。名前の頭が `期限` と札 `任意`（規則3・6）。 */
function namedExpiryDateField(): HTMLInputElement {
  return screen.getByLabelText(/^期限\s*任意/) as HTMLInputElement;
}

/** 残日数の文字（規則8。一覧と同じ語）。 */
const remainingDaysText = /^(今日|あと\d+日|\d+日過ぎ)$/;

/**
 * 日付の選択を開く口を**投げる関数に差し替えて**から `run` を走らせ、終わったら戻す（規則6）。
 * jsdom 30 には `showPicker` が無い。投げる環境でも素の振る舞いに任せることを観るために置く。
 */
function withThrowingShowPicker(run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'showPicker');
  Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
    configurable: true,
    writable: true,
    value: () => {
      throw new DOMException('showPicker は使えない', 'NotAllowedError');
    },
  });

  try {
    run();
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker');
    } else {
      Object.defineProperty(HTMLInputElement.prototype, 'showPicker', original);
    }
  }
}

describe('編集の画面 StockItemEditForm の見た目と文言', () => {
  it('見出しは「食材を編集」の h1 が1つだけである', () => {
    renderEditForm();

    // B-65 規則2 / ADR-074: 名称は見出しではなく食材名の欄の位置に出す（規則9）。
    expect(
      screen.getAllByRole('heading').map((heading) => [heading.tagName, heading.textContent]),
    ).toEqual([['H1', '食材を編集']]);
  });

  it('「戻る」という名前の操作を押すと、一覧へ戻す口が呼ばれる', () => {
    const closed: string[] = [];
    render(
      <StockItemEditForm
        stockItem={stockItemOf()}
        onUpdate={new FixedStockItemRequests().updateStockItem}
        onClose={() => closed.push('close')}
        today={today}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '戻る' }));

    // B-65 規則2: 戻るはアイコンだけで、名前は `aria-label="戻る"` で読ませる。
    expect(closed).toEqual(['close']);
  });

  it('「戻る」の操作は見える文字を持たない', () => {
    renderEditForm();

    // B-65 規則2 / ADR-074: `back` のアイコンだけを置く（先行 `MealDetail` の `.back`）。
    expect(screen.getByRole('button', { name: '戻る' }).textContent).toBe('');
  });

  it('欄の名前「食材名」の後ろに在庫品の名称が出る', () => {
    renderEditForm(stockItemOf({ name: 'にんじん' }));

    // B-65 規則9 / FR-05: 名称は食材名の欄の位置に、変えられない文字で出す。
    expect(precedes(screen.getByText('食材名'), screen.getByText('にんじん'))).toBe(true);
  });

  it('分量の欄の名前は「分量」と札「任意」である', () => {
    renderEditForm();

    // B-65 規則3 / FR-13: 任意であることを札の文字で伝える。
    expect(namedAmountField()).not.toBeNull();
  });

  it('期限の欄は名前が「期限」と札「任意」で、日付の欄である', () => {
    renderEditForm();

    // B-65 規則3・6: 素の `<input type="date">` を残す。
    expect(namedExpiryDateField().type).toBe('date');
  });

  it('分量が未設定の在庫品を開くと、分量の欄に置き文字「例: 300」が出る', () => {
    renderEditForm(stockItemOf({ amount: null }));

    // B-65 規則5 / ADR-010: 置き文字は分量の欄の `placeholder` である。
    expect(screen.getByPlaceholderText('例: 300')).toBe(namedAmountField());
  });

  it('期限のある在庫品を開くと、期限が「M月D日（曜）」で出る', () => {
    renderEditForm(stockItemOf({ expiryDate: '2026-09-22' }));

    // B-65 規則6・7 / ADR-074。
    expect(screen.queryByText('9月22日（火）')).not.toBeNull();
  });

  it('期限のある在庫品を開くと、基準日から数えた残日数が出る', () => {
    renderEditForm(stockItemOf({ expiryDate: '2026-09-22' }));

    // B-65 規則8 / NFR-17: 基準日 2026-09-20 から2日。色だけに頼らず文字で出す。
    expect(screen.queryByText('あと2日')).not.toBeNull();
  });

  it('期限の欄を変えると、残日数は変えた後の値で数え直される', () => {
    renderEditForm(stockItemOf({ expiryDate: '2026-09-22' }));

    fireEvent.change(namedExpiryDateField(), { target: { value: '2026-09-24' } });

    // B-65 規則8: 残日数は期限の欄の**今の値**から数える。
    expect(screen.queryByText('あと4日')).not.toBeNull();
    expect(screen.queryByText('あと2日')).toBeNull();
  });

  it('期限が未設定の在庫品を開くと、期限の箱に「日付を選ぶ」が出る', () => {
    renderEditForm(stockItemOf({ expiryDate: null }));

    // B-65 規則6 / ADR-074。
    expect(screen.queryByText('日付を選ぶ')).not.toBeNull();
  });

  it('期限が未設定の在庫品を開くと、残日数を出さない', () => {
    renderEditForm(stockItemOf({ expiryDate: null }));

    // B-65 規則8 / FR-13: 値が無ければ残日数も無い。
    expect(screen.queryByText(remainingDaysText)).toBeNull();
  });

  it('日付の選択を開く口が投げても、期限の欄で選んだ日付が更新の口へ届く', () => {
    const requests = renderEditForm(stockItemOf({ id: '1', amount: '2本' }), {
      update: [{ outcome: 'updated' }],
    });

    withThrowingShowPicker(() => {
      fireEvent.click(namedExpiryDateField());
      fireEvent.change(namedExpiryDateField(), { target: { value: '2026-09-30' } });
      fireEvent.click(saveOperation());
    });

    // B-65 規則6・13: 投げる環境では素の振る舞いに任せ、送る中身は変えない。
    expect(requests.receivedUpdates).toEqual([
      { id: '1', input: { amount: '2本', expiryDate: '2026-09-30', useForMeals: true } },
    ]);
  });

  it('「保存」という名前の操作は、操作の末尾に在る', () => {
    renderEditForm();

    // B-65 規則11・13 / ADR-074: 編集の保存の名札は `保存`。並び（戻る → 保存）は変えない。
    expect(screen.getByRole('button', { name: '保存' })).toBe(saveOperation());
  });
});

/**
 * 見出しの行の `閉じる`（B-65b 設計 6章 規則9 / ADR-074 / ADR-076 決定2）。
 *
 * **木には `戻る` と `閉じる` の2つとも置く**（10章 前提3）。jsdom ではどちらも見えるので、名前で
 * 引き分ける。見た目（下線・幅で隠すこと）は CSS で、ここでは見ない（ADR-055 決定3）。
 */
describe('編集の画面 StockItemEditForm の `閉じる`', () => {
  /** 一覧へ戻す口を配列に残して描く。 */
  function renderEditFormRecordingClose(
    closed: string[],
    options: FixedStockItemRequestsOptions = {},
    offline = false,
  ) {
    const requests = new FixedStockItemRequests(options);

    render(
      <StockItemEditForm
        stockItem={stockItemOf()}
        onUpdate={requests.updateStockItem}
        onClose={() => closed.push('close')}
        offline={offline}
        today={today}
      />,
    );

    return requests;
  }

  function closeButton(): HTMLElement {
    return screen.getByRole('button', { name: '閉じる' });
  }

  it('見出しの行は文書順で `戻る`・見出し・`閉じる` と並ぶ', () => {
    renderEditForm();

    // B-65b 規則9 / 原本 `IngredientForm`（SP は左に戻る、PC は右に閉じる）。
    const back = screen.getByRole('button', { name: '戻る' });
    const heading = screen.getByRole('heading', { level: 1, name: '食材を編集' });
    expect([precedes(back, heading), precedes(heading, closeButton())]).toEqual([true, true]);
  });

  it('`閉じる` は見える文字 `閉じる` を持つ', () => {
    renderEditForm();

    // B-65b 規則9 / ADR-074。
    expect(closeButton().textContent).toBe('閉じる');
  });

  it('`閉じる` を押すと、一覧へ戻す口が呼ばれる', () => {
    const closed: string[] = [];
    renderEditFormRecordingClose(closed);

    fireEvent.click(closeButton());

    // B-65b 規則9: `戻る` と同じ「保存せずに閉じる」である。
    expect(closed).toEqual(['close']);
  });

  it('分量を打ってから `閉じる` を押しても、更新の口へは何も届かない', () => {
    const requests = renderEditFormRecordingClose([]);

    typeAmount(typedValues.amount);
    fireEvent.click(closeButton());

    // B-65b 規則9: 閉じるのは捨てることである（`<form>` の送信にならない）。
    expect(requests.receivedUpdates).toEqual([]);
  });

  it('送っている間は `閉じる` を押しても一覧へ戻す口が呼ばれない', async () => {
    const closed: string[] = [];
    const requests = renderEditFormRecordingClose(closed, {
      // 結末を保留する口。押した時点ではまだ返らない（`support/HeldDelivery.ts`）。
      update: [{ heldUntilSettled: { outcome: 'failed' } }],
    });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    // 前提: 1件は送られ、結末はまだ返っていない。
    expect(requests.receivedUpdates).toHaveLength(1);

    fireEvent.click(closeButton());

    // B-65b 規則9 / B-39 規則11: 送っている間はどちらの閉じる操作も効かない。
    expect(closed).toEqual([]);

    // 保留を解いてから終える — 届いた更新を `act` の中で起こすためである。
    await act(async () => {
      requests.settle();
    });
  });

  it('接続が切れていても `閉じる` で閉じられる', () => {
    const closed: string[] = [];
    renderEditFormRecordingClose(closed, {}, true);

    fireEvent.click(closeButton());

    // B-70 / B-65 規則6: 保存せずに閉じるのは遷移で、止めない。
    expect(closed).toEqual(['close']);
  });
});

/**
 * 端末の「戻る」（B-75 設計 6章 規則1・2・6 / ADR-084）。
 *
 * 継ぎ目は記憶上の `FixedBackNavigation` に差し替え、`pressBack()` で「利用者が戻るを押した」
 * ことにする。**届いた先は一覧へ戻す口を配列に残して観る**（`docs/testing.md` 2章）。
 */
describe('編集の画面 StockItemEditForm の端末の戻る', () => {
  function renderEditFormWithBack(closed: string[], options: FixedStockItemRequestsOptions = {}) {
    const requests = new FixedStockItemRequests(options);
    const backNavigation = new FixedBackNavigation();

    render(
      <BackNavigationProvider backNavigation={backNavigation}>
        <StockItemEditForm
          stockItem={stockItemOf()}
          onUpdate={requests.updateStockItem}
          onClose={() => closed.push('close')}
          today={today}
        />
      </BackNavigationProvider>,
    );

    return { requests, backNavigation };
  }

  function pressBack(backNavigation: FixedBackNavigation): void {
    act(() => {
      backNavigation.pressBack();
    });
  }

  it('編集の画面で戻ると、一覧へ戻す口へ届く', () => {
    const closed: string[] = [];
    const { backNavigation } = renderEditFormWithBack(closed);

    pressBack(backNavigation);

    // 規則1・2: 「戻る」の操作と同じ口で閉じる（パネル → 一覧）。
    expect(closed).toEqual(['close']);
  });

  it('編集を送っている間に戻っても、一覧へ戻す口は呼ばれない', async () => {
    const closed: string[] = [];
    const { requests, backNavigation } = renderEditFormWithBack(closed, {
      // 結末を保留する口。押した時点ではまだ返らない（`support/HeldDelivery.ts`）。
      update: [{ heldUntilSettled: { outcome: 'failed' } }],
    });
    fireEvent.click(saveOperation());
    // 前提: 1件は送られ、結末はまだ返っていない。
    expect(requests.receivedUpdates).toHaveLength(1);

    pressBack(backNavigation);

    // 規則6 / B-39 規則11: 送っている間は戻るを飲み込む。
    expect(closed).toEqual([]);

    await act(async () => {
      requests.settle();
    });
  });
});

/**
 * 「献立に使う」のチェックボックス（B-76 設計 6章 規則14・15 / FR-05）。
 *
 * 文言は確定している（ADR-074）ので名前で引く。並びは**文書順**で観る（`precedes`）。
 * 送った値は更新の口へ届いた入力の配列で観る（`docs/testing.md` 2章）。
 */
describe('編集の画面 StockItemEditForm の献立に使う', () => {
  function useForMealsCheckbox(): HTMLInputElement {
    return screen.getByRole('checkbox', { name: '献立に使う' }) as HTMLInputElement;
  }

  it.each([true, false])(
    '開いた直後の「献立に使う」のチェックは在庫品の今の値（%s）である',
    (useForMeals) => {
      renderEditForm(stockItemOf({ useForMeals }));

      // B-76 規則14: 初期値は対象の在庫品の現在の値。
      expect(useForMealsCheckbox().checked).toBe(useForMeals);
    },
  );

  it('チェックを外して保存すると、献立に使わないとして更新の口へ届く', () => {
    const requests = renderEditForm(
      stockItemOf({ id: '1', amount: '2本', expiryDate: '2026-09-25', useForMeals: true }),
      { update: [{ outcome: 'updated' }] },
    );

    fireEvent.click(useForMealsCheckbox());
    fireEvent.click(saveOperation());

    // B-76 規則3・15 / FR-05: 切り替えた値が真偽値で届く。
    expect(requests.receivedUpdates).toEqual([
      { id: '1', input: { amount: '2本', expiryDate: '2026-09-25', useForMeals: false } },
    ]);
  });

  it('「献立に使う」は期限の欄の後、「保存」の前に並ぶ', () => {
    renderEditForm();

    // B-76 規則14: 登録の画面と同じ位置。
    expect([
      precedes(namedExpiryDateField(), useForMealsCheckbox()),
      precedes(useForMealsCheckbox(), screen.getByRole('button', { name: '保存' })),
    ]).toEqual([true, true]);
  });
});
