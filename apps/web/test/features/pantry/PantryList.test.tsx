// @vitest-environment jsdom
/**
 * `PantryList` の**表示の分岐**（`docs/testing.md` 4章 / ADR-052）。
 *
 * `PantrySections.ts` と `RemainingDays.ts` の計算は、それぞれの純粋関数のテストが既に
 * 押さえている。ここで確かめるのは**受け取った3値のどれを描くか**だけである（B-22 設計 5章）。
 *
 * **仮の文言を期待値に書かない。** 見出しも案内も `docs/screen-design.md` 論点3 で未確定であり
 * （`PantryList.tsx` の doc がそう断っている）、文字列で留めると**文言を変えただけで赤くなる。**
 * 代わりに、**利用者から見える構造**（行が出るか、帯がいくつか、どの順か）と、
 * **こちらが渡したデータ**（在庫品の名称）で観察する。
 */

import { describe, expect, it } from 'vitest';
import type { StockItemDto } from '@fridge-to-meal/contract';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../support/dom/renderComponent.js';
import { installPointerCapture } from '../../support/dom/pointerCapture.js';
import { pressOperation } from '../../support/dom/pressOperation.js';
import { FixedStockItemRequests } from '../../support/server/FixedStockItemRequests.js';
import type { FixedStockItemRequestsOptions } from '../../support/server/FixedStockItemRequests.js';
import { PantryList } from '../../../src/features/pantry/PantryList.js';

const TODAY = '2026-09-20';

// 行をなぞる／タップする経路は jsdom に無いメソッドを通る（`support/dom/pointerCapture.ts`）。
// **本体の振る舞いではなく、道具の欠けを道具の側で埋めるものである。**
installPointerCapture();

/** 消せない相手。この観点のテストは削除を起こさないので、呼ばれたら分かる形にしておく。 */
const neverDelete = () => Promise.reject(new Error('この観点では削除を呼ばない'));

/** 編集を開かない相手（B-55）。同じく、呼ばれたら分かる形にしておく。 */
const neverEdit = (): never => {
  throw new Error('この観点では編集を開かない');
};

function stockItem(overrides: Partial<StockItemDto> & { id: string; name: string }): StockItemDto {
  return { ingredientId: null, amount: null, expiryDate: null, ...overrides };
}

/** 並びを位置で見るための取り出し。件数は呼ぶ側が先に確かめている。 */
function rowAt(rows: readonly HTMLElement[], index: number): HTMLElement {
  const row = rows[index];
  if (row === undefined) throw new Error(`${index} 番目の行が無い`);

  return row;
}

describe('在庫一覧 PantryList', () => {
  it('取れた在庫品を、渡された順に並べる', () => {
    render(
      <PantryList
        today={TODAY}
        onDelete={neverDelete}
        onEdit={neverEdit}
        stockItems={{
          outcome: 'loaded',
          stockItems: [
            stockItem({ id: '1', name: '豚こま肉', amount: '300g', expiryDate: '2026-09-20' }),
            stockItem({ id: '2', name: '白菜', expiryDate: '2026-09-22' }),
            stockItem({ id: '3', name: 'にんじん', amount: '2本' }),
          ],
        }}
      />,
    );

    // 並びはサーバが決めた順のまま（FR-04 / B-22 設計 規則3）。
    //
    // **当てるのはテストが渡した名称と分量だけである。** 行には残日数の言い換え（`今日` /
    // `あと2日` / `－`）も出ているが、それは画面が持つ**仮の文言**であり（`PantryList.tsx` の
    // `remainingDaysText` / `NO_REMAINING_DAYS_MARK`、`docs/screen-design.md` 論点3）、
    // 期待値に留めると**文言を変えただけで赤くなる**（ADR-052 結果2 / `docs/testing.md` 4.1）。
    // 残日数の言い換えそのものは `RemainingDays.ts` の純粋関数テストの持ち分である。
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rowAt(rows, 0)).queryByText('豚こま肉')).not.toBeNull();
    expect(within(rowAt(rows, 0)).queryByText('300g')).not.toBeNull();
    expect(within(rowAt(rows, 1)).queryByText('白菜')).not.toBeNull();
    expect(within(rowAt(rows, 2)).queryByText('にんじん')).not.toBeNull();
    expect(within(rowAt(rows, 2)).queryByText('2本')).not.toBeNull();
  });

  it('帯1つにつき見出しを1つ描く', () => {
    render(
      <PantryList
        today={TODAY}
        onDelete={neverDelete}
        onEdit={neverEdit}
        stockItems={{
          outcome: 'loaded',
          stockItems: [
            stockItem({ id: '1', name: '豚こま肉', expiryDate: '2026-09-20' }),
            stockItem({ id: '2', name: '白菜', expiryDate: '2026-09-22' }),
            stockItem({ id: '3', name: 'にんじん' }),
          ],
        }}
      />,
    );

    // 3件が3つの帯へ1件ずつ入る（FR-12 / B-11 設計 規則6）。**どう振り分けるかは
    // `PantrySections.ts` の持ち分**で、ここで確かめるのは「帯の数だけ見出しが出ること」である。
    // **見出しの文言は見ない** — 仮である（`docs/screen-design.md` 論点3）。
    expect(screen.getAllByRole('heading')).toHaveLength(3);
  });

  it('在庫が0件なら帯も行も出さない', () => {
    render(
      <PantryList
        today={TODAY}
        onDelete={neverDelete}
        onEdit={neverEdit}
        stockItems={{ outcome: 'loaded', stockItems: [] }}
      />,
    );

    // 登録を促す案内だけが出る（B-11 設計 規則11）。**文言は見ない。**
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryAllByRole('heading')).toHaveLength(0);
  });

  it('読み込み中は在庫品を1件も出さない', () => {
    render(
      <PantryList
        today={TODAY}
        onDelete={neverDelete}
        onEdit={neverEdit}
        stockItems={{ outcome: 'loading' }}
      />,
    );

    // **0件の在庫と同じ見せ方にしない**のが B-22 設計 7章 の眼目だが、ここで確かめられるのは
    // 「在庫があるように見せない」ほうである。**行が出ないこと**を押さえる。
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('取れなかったときも在庫品を1件も出さない', () => {
    render(
      <PantryList
        today={TODAY}
        onDelete={neverDelete}
        onEdit={neverEdit}
        stockItems={{ outcome: 'failed' }}
      />,
    );

    // 古い在庫を残して出すと、消えたはずのものが見え続ける（B-22 設計 規則9）。
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

/**
 * 行のタップで編集を開く導線（FR-05 / B-55 設計 6章 規則15 / `docs/screen-design.md` 2章
 * `pantry --> edit`）。
 *
 * **どの動きをタップと読むか・削除と読むかは `SwipeGesture.test.ts` の持ち分**（`isTap` /
 * `isDeleteSwipe`）。ここで確かめるのは**切り出せないもの**だけ — 行から送られたポインタの
 * 2点が、どちらの口へ何を届けるかである。
 *
 * **`vi.fn()` で呼び出し回数を数えない**（`docs/testing.md` 2章）。届いたものも、届かなかった
 * ことも**テストが持つ配列の中身**で見る。
 */

/** 帯を1つに揃えた2件。**期限を持たせない**ことで並びが渡した順のまま読める。 */
const twoRows = [stockItem({ id: '1', name: '豚こま肉' }), stockItem({ id: '2', name: '白菜' })];

/** 編集の口へ届いた在庫品を**配列に残す**（`docs/testing.md` 2章）。 */
function recordingEdit(edits: StockItemDto[]) {
  return (edited: StockItemDto) => {
    edits.push(edited);
  };
}

/** 削除の口へ届いた識別子を**配列に残す**。結末は「消えた」を返す。 */
function recordingDelete(deletedIds: string[]) {
  return (id: string) => {
    deletedIds.push(id);

    return Promise.resolve({ outcome: 'deleted' } as const);
  };
}

function renderTwoRows(edits: StockItemDto[], deletedIds: string[]) {
  render(
    <PantryList
      today={TODAY}
      onDelete={recordingDelete(deletedIds)}
      onEdit={recordingEdit(edits)}
      stockItems={{ outcome: 'loaded', stockItems: twoRows }}
    />,
  );
}

/**
 * 2件目の行に、押下と離上の2点を送る。**判断は `SwipeGesture.ts` の持ち分**で、ここは入力を
 * 送るだけである（先行 `App.test.tsx` の `swipeSoleRow`）。
 */
function pressAndRelease(end: { readonly x: number; readonly y: number }): void {
  const rows = screen.getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  const row = rowAt(rows, 1);

  fireEvent.pointerDown(row, { pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(row, { pointerId: 1, clientX: end.x, clientY: end.y });
}

describe('在庫一覧 PantryList の行のタップ', () => {
  it('行をタップすると、その行の在庫品が編集の口へ届く', () => {
    const edits: StockItemDto[] = [];
    renderTwoRows(edits, []);

    // 押した点と離した点が同じ＝動かしていない（規則15 / `isTap`）。
    pressAndRelease({ x: 0, y: 0 });

    // FR-05 / 規則15: **どの行を触ったか**が届く。編集できるのは触った1件だけである。
    expect(edits).toEqual([twoRows[1]]);
  });

  it('行をタップしても、削除の口へは何も届かない', () => {
    const deletedIds: string[] = [];
    renderTwoRows([], deletedIds);

    pressAndRelease({ x: 0, y: 0 });

    // 規則15 / FR-06: 触っただけで消えない — 消すのは確認の削除を押したときだけである
    // （B-69 設計 規則1 / `docs/screen-design.md` 5章）。
    expect(deletedIds).toEqual([]);
  });

  it('削除として読む長さまでなぞった動きでは、編集の口へ何も届かない', () => {
    const edits: StockItemDto[] = [];
    const deletedIds: string[] = [];
    renderTwoRows(edits, deletedIds);

    pressAndRelease({ x: 100, y: 0 });

    // 削除として読まれている（対にして確かめる — 読まれていなければ「編集が開かないこと」を
    // 動きの長さで確かめたことにならない）。B-69 設計 規則1: なぞった行には削除の操作が
    // 現れるだけで、行の中の操作は `…` と現れた削除の2つになる。
    expect(within(rowAt(screen.getAllByRole('listitem'), 1)).getAllByRole('button')).toHaveLength(
      2,
    );

    // 規則15: 取り消しの無い削除と編集の画面が同時に起きない。**2つの閾値の間に隙間がある**
    // ことの帰結であり、旗でも順序でも保っていない。
    expect(edits).toEqual([]);
  });

  it('タップとも削除とも読めない長さの動きでは、編集の口へ何も届かない', () => {
    const edits: StockItemDto[] = [];
    const deletedIds: string[] = [];
    renderTwoRows(edits, deletedIds);

    pressAndRelease({ x: 20, y: 0 });

    // 規則15: どちらにも当たらない動きでは**何も起こさない**（8px 以上 64px 未満）。
    expect(edits).toEqual([]);
    expect(deletedIds).toEqual([]);
  });
});

/**
 * 行の操作と削除の確認の配線（B-69 設計 6章 規則1・3・4・6・7・11〜13・15・16 /
 * FR-05 / FR-06 / NFR-16 / 論点4 #1・#2）。
 *
 * **状態の遷移そのものは `RowOperations.test.ts`、確認の部品は
 * `StockItemDeleteConfirmation.test.tsx` の持ち分**であり、ここは**切り出せないもの**だけを見る —
 * どの行に何が描かれ、どの口へ何が届くか。
 *
 * **仮の文言を期待値に書かない**（`docs/testing.md` 4.1）。操作は次の手がかりで引く。
 *
 * - **行末の `…`** … 行（`<li>`）の中で `aria-expanded` を持つ button
 * - **現れた `削除`** … 行の中の、`aria-expanded` を持たない button（規則2・判断済み2）
 * - **開いた `…` の中身** … `…` の `aria-controls` が指す要素（規則3）。中の button は [編集, 削除]
 * - **確認** … `role="dialog"` の中の button を文書順に [やめる, 削除]（規則8）
 *
 * 行の中の操作は**押下 → 離上 → click** で押す（`pressOperation`。規則7 — 押し始めが操作の
 * 上なら行の動きとして読まない）。
 */

/** 押したあとに届く更新（削除の結末）を `act` の中で流す。 */
async function flush(): Promise<void> {
  await act(async () => {});
}

function listOf(
  stockItems: readonly StockItemDto[],
  requests: FixedStockItemRequests,
  edits: StockItemDto[],
) {
  return (
    <PantryList
      today={TODAY}
      onDelete={requests.deleteStockItem}
      onEdit={recordingEdit(edits)}
      stockItems={{ outcome: 'loaded', stockItems }}
    />
  );
}

/**
 * 2件の一覧を描く。削除の口は既定で「消えた」を返す。**取り直しは門の持ち分**なので、
 * 一覧を入れ替えたい観点は返した `rerenderWith` で描き直す（規則12・15）。
 */
function renderOperableRows(options: FixedStockItemRequestsOptions = {}) {
  const requests = new FixedStockItemRequests({ remove: [{ outcome: 'deleted' }], ...options });
  const edits: StockItemDto[] = [];
  const { rerender } = render(listOf(twoRows, requests, edits));

  return {
    requests,
    edits,
    rerenderWith: (stockItems: readonly StockItemDto[]) => {
      rerender(listOf(stockItems, requests, edits));
    },
  };
}

function rows(): readonly HTMLElement[] {
  return screen.getAllByRole('listitem');
}

function rowButtons(index: number): readonly HTMLElement[] {
  return within(rowAt(rows(), index)).queryAllByRole('button');
}

/** その行の `…`。**1つだけである**ことを先に確かめる（規則3）。 */
function rowToggle(index: number): HTMLElement {
  const toggles = rowButtons(index).filter((button) => button.hasAttribute('aria-expanded'));
  expect(toggles).toHaveLength(1);

  const [toggle] = toggles;
  if (toggle === undefined) throw new Error(`${index} 番目の行に操作が無い`);

  return toggle;
}

/** 一覧に出ている `…` をすべて、文書順に。 */
function allToggles(): readonly HTMLElement[] {
  return screen.queryAllByRole('button').filter((button) => button.hasAttribute('aria-expanded'));
}

/** その行に現れた `削除`。**1つだけである**ことを先に確かめる（規則2）。 */
function revealedDelete(index: number): HTMLElement {
  const found = rowButtons(index).filter((button) => !button.hasAttribute('aria-expanded'));
  expect(found).toHaveLength(1);

  const [operation] = found;
  if (operation === undefined) throw new Error(`${index} 番目の行に削除が現れていない`);

  return operation;
}

/** `…` が `aria-controls` で指す要素（規則3）。閉じていれば `null`。 */
function controlledPanel(toggle: HTMLElement): HTMLElement | null {
  const id = toggle.getAttribute('aria-controls');
  if (id === null) return null;

  return document.getElementById(id);
}

/** 開いた `…` の中身の button を文書順に [編集, 削除]。**2つである**ことを先に確かめる。 */
function openedOperations(index: number): readonly HTMLElement[] {
  const panel = controlledPanel(rowToggle(index));
  if (panel === null) throw new Error(`${index} 番目の行の操作が開いていない`);

  const operations = within(panel).getAllByRole('button');
  expect(operations).toHaveLength(2);

  return operations;
}

function openedEdit(index: number): HTMLElement {
  const found = openedOperations(index).at(0);
  if (found === undefined) throw new Error('開いた操作に編集が無い');

  return found;
}

function openedDelete(index: number): HTMLElement {
  const found = openedOperations(index).at(1);
  if (found === undefined) throw new Error('開いた操作に削除が無い');

  return found;
}

/** 確認の button を文書順に [やめる, 削除]。**2つである**ことを先に確かめる（規則8）。 */
function confirmationOperations(): readonly HTMLElement[] {
  const operations = within(screen.getByRole('dialog')).getAllByRole('button');
  expect(operations).toHaveLength(2);

  return operations;
}

function cancelConfirmation(): HTMLElement {
  const found = confirmationOperations().at(0);
  if (found === undefined) throw new Error('確認にやめるが無い');

  return found;
}

function confirmDeletion(): HTMLElement {
  const found = confirmationOperations().at(1);
  if (found === undefined) throw new Error('確認に削除が無い');

  return found;
}

/** 行を横になぞる（削除のスワイプ。判断は `SwipeGesture.ts`）。 */
function swipeRow(index: number): void {
  const row = rowAt(rows(), index);

  fireEvent.pointerDown(row, { pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(row, { pointerId: 1, clientX: 100, clientY: 0 });
}

/** 行をタップする（押した点と離した点が同じ。`isTap`）。 */
function tapRow(index: number): void {
  const row = rowAt(rows(), index);

  fireEvent.pointerDown(row, { pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(row, { pointerId: 1, clientX: 0, clientY: 0 });
}

/** 2行目をなぞって現れた削除を押し、確認を開く。 */
function openConfirmationBySwipe(): void {
  swipeRow(1);
  pressOperation(revealedDelete(1));
}

/** 2行目の `…` を開き、その中の削除を押して確認を開く。 */
function openConfirmationByToggle(): void {
  pressOperation(rowToggle(1));
  pressOperation(openedDelete(1));
}

/** 確認の名前に、渡した名称が入っているもの。 */
function dialogsNaming(name: string): readonly HTMLElement[] {
  return screen.queryAllByRole('dialog', {
    name: (accessibleName) => accessibleName.includes(name),
  });
}

describe('在庫一覧 PantryList の行の操作', () => {
  it('どの行にも、閉じた行の操作が1つずつ置かれている', () => {
    // 規則3 / 論点4 #2: 行末の `…` はどの幅でも全行に置く。
    renderOperableRows();

    const closedToggles = [0, 1].map(
      (index) =>
        rowButtons(index).filter((button) => button.getAttribute('aria-expanded') === 'false')
          .length,
    );
    expect(closedToggles).toEqual([1, 1]);
  });

  it('行をなぞっただけでは、削除の口へ何も届かない', async () => {
    // 規則1 / FR-06 / 論点4 #1: なぞるのは削除の操作を現すだけである。
    const { requests } = renderOperableRows();

    swipeRow(1);
    await flush();

    expect(requests.deletedIds).toEqual([]);
  });

  it('行をなぞると、その行の中に削除の操作が現れる', () => {
    // 規則1・2: 行の中の操作が `…` と現れた削除の2つになる。
    renderOperableRows();

    swipeRow(1);

    expect(rowButtons(1)).toHaveLength(2);
  });

  it('別の行をなぞると、前の行の削除は消えてなぞった行に現れる', () => {
    // 規則2: 削除が現れるのは1度に1行だけ。
    renderOperableRows();

    swipeRow(0);
    swipeRow(1);

    expect([rowButtons(0).length, rowButtons(1).length]).toEqual([1, 2]);
  });

  it('現れた削除を押すと、その在庫品の確認が出る', () => {
    // 規則6・8: 確認の名前は何を消すのかを含む。
    renderOperableRows();

    openConfirmationBySwipe();

    expect(dialogsNaming('白菜')).toHaveLength(1);
  });

  it('確認の削除を押すと、その行の識別子が削除の口へ届く', async () => {
    // 規則11 / FR-06: 消すのは確認の削除を押したときだけである。
    const { requests } = renderOperableRows();

    openConfirmationBySwipe();
    pressOperation(confirmDeletion());
    await flush();

    expect(requests.deletedIds).toEqual(['2']);
  });

  it('確認の削除を押すと、結末を待たずに確認は閉じる', () => {
    // 規則11: 確認を閉じてから削除を送る。
    renderOperableRows({ remove: [{ heldUntilSettled: { outcome: 'deleted' } }] });

    openConfirmationBySwipe();
    pressOperation(confirmDeletion());

    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
  });

  it('削除を送っている間に別の行で確認まで進めても、2度目は送らない', () => {
    // 規則11: 送っている間の二度目は今どおり送らない。
    const { requests } = renderOperableRows({
      remove: [{ heldUntilSettled: { outcome: 'deleted' } }],
    });

    openConfirmationBySwipe();
    pressOperation(confirmDeletion());
    swipeRow(0);
    pressOperation(revealedDelete(0));
    pressOperation(confirmDeletion());

    expect(requests.deletedIds).toHaveLength(1);
  });

  it('行の操作を押すと開いた印が立ち、指す先に操作が2つ出る', () => {
    // 規則3 / NFR-16: `aria-expanded` で開閉を、`aria-controls` で開いた中身を指す。
    renderOperableRows();

    pressOperation(rowToggle(1));

    const toggle = rowToggle(1);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const panel = controlledPanel(toggle);
    expect(panel === null ? [] : within(panel).getAllByRole('button')).toHaveLength(2);
  });

  it('開いた `…` の中の操作は、その `…` の直後に並ぶ', () => {
    // 規則3 / NFR-16: 開いた中身は DOM で `…` の直後に置き、Tab で届く。
    renderOperableRows();

    pressOperation(rowToggle(1));

    const all = screen.getAllByRole('button');
    const at = all.indexOf(rowToggle(1));
    expect(all.slice(at + 1, at + 3)).toEqual(openedOperations(1));
  });

  it('行の操作をもう一度押すと、開いた中身は描かれなくなる', () => {
    // 規則3: 開閉ボタンの形である。
    renderOperableRows();
    pressOperation(rowToggle(1));
    const panelId = rowToggle(1).getAttribute('aria-controls');

    pressOperation(rowToggle(1));

    expect(panelId === null ? null : document.getElementById(panelId)).toBeNull();
  });

  it('別の行の操作を押すと、前の `…` は閉じる', () => {
    // 規則3: 開くのは1度に1行だけ。
    renderOperableRows();

    pressOperation(rowToggle(0));
    pressOperation(rowToggle(1));

    expect(allToggles().map((toggle) => toggle.getAttribute('aria-expanded'))).toEqual([
      'false',
      'true',
    ]);
  });

  it('行の操作を押しても、編集の口へ何も届かない', () => {
    // 規則7: 押し始めが行の中の操作の上なら、行のタップとして読まない。
    const { edits } = renderOperableRows();

    pressOperation(rowToggle(1));

    expect(edits).toEqual([]);
  });

  it('開いた `…` の編集を押すと、その行の在庫品が編集の口へ届く', () => {
    // 規則6 / FR-05: キーボードと読み上げから編集に届く。
    const { edits } = renderOperableRows();

    pressOperation(rowToggle(1));
    pressOperation(openedEdit(1));

    expect(edits).toEqual([twoRows[1]]);
  });

  it('開いた `…` の編集を押すと、`…` は閉じる', () => {
    // 規則6: 編集は開いた `…` を閉じる。
    renderOperableRows();
    pressOperation(rowToggle(1));
    const panelId = rowToggle(1).getAttribute('aria-controls');

    pressOperation(openedEdit(1));

    expect(panelId === null ? null : document.getElementById(panelId)).toBeNull();
  });

  it('開いた `…` の削除を押すと、その在庫品の確認が出る', () => {
    // 規則6: 開いた `…` の削除と現れた削除はどちらも同じ確認を開く。
    renderOperableRows();

    openConfirmationByToggle();

    expect(dialogsNaming('白菜')).toHaveLength(1);
  });

  it('開いた `…` の削除を押すと、`…` は閉じる', () => {
    // 規則6: 確認を開くと `…` は閉じる。
    renderOperableRows();
    pressOperation(rowToggle(1));
    const panelId = rowToggle(1).getAttribute('aria-controls');

    pressOperation(openedDelete(1));

    expect(panelId === null ? null : document.getElementById(panelId)).toBeNull();
  });

  it('削除が現れているときに行をタップしても、編集の口へ何も届かない', () => {
    // 規則4: 取り消しの無い操作の隣で別の画面を開かない（どの行のタップでも同じ）。
    const { edits } = renderOperableRows();

    swipeRow(1);
    tapRow(0);

    expect(edits).toEqual([]);
  });

  it('削除が現れているときに行をタップすると、現れた削除は消える', () => {
    // 規則4: タップは出ているものを閉じる。
    renderOperableRows();

    swipeRow(1);
    tapRow(0);

    expect(rowButtons(1)).toHaveLength(1);
  });

  it('`…` が開いているときに行をタップしても、編集の口へ何も届かない', () => {
    // 規則4。
    const { edits } = renderOperableRows();

    pressOperation(rowToggle(1));
    tapRow(1);

    expect(edits).toEqual([]);
  });

  it('行の操作の上で押して横へ離しても、削除は現れない', () => {
    // 規則7: 押し始めが行の中の操作の上なら、スワイプにも数えない。
    renderOperableRows();
    const toggle = rowToggle(1);

    fireEvent.pointerDown(toggle, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(toggle, { pointerId: 1, clientX: 100, clientY: 0 });

    expect(rowButtons(1)).toHaveLength(1);
  });
});

describe('在庫一覧 PantryList の削除の確認', () => {
  it('確認でやめると、削除の口へ何も届かない', async () => {
    // 規則10 / 論点4 #1: やめるは何も消さない。
    const { requests } = renderOperableRows();

    openConfirmationBySwipe();
    pressOperation(cancelConfirmation());
    await flush();

    expect(requests.deletedIds).toEqual([]);
  });

  it('確認で Esc を押しても、削除の口へ何も届かない', async () => {
    // 規則10: `やめる` と Esc は同じである。
    const { requests } = renderOperableRows();

    openConfirmationBySwipe();
    fireEvent.keyDown(cancelConfirmation(), { key: 'Escape' });
    await flush();

    expect(requests.deletedIds).toEqual([]);
  });

  it('確認でやめると、確認も現れていた削除も残らない', () => {
    // 規則10: 状態は何も出ていない形に戻る。
    renderOperableRows();

    openConfirmationBySwipe();
    pressOperation(cancelConfirmation());

    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(rowButtons(1)).toHaveLength(1);
  });

  it('`…` から開いた確認をやめると、焦点はその行の操作へ戻る', () => {
    // 規則13 / NFR-16: キーボードの利用者が元の場所を見失わない。
    renderOperableRows();

    openConfirmationByToggle();
    pressOperation(cancelConfirmation());

    expect(document.activeElement).toBe(rowToggle(1));
  });

  it('開いた `…` の中で Esc を押すと、`…` は閉じて焦点はその行の操作へ戻る', () => {
    // 規則13: 開いた `…` を Esc で閉じたときも焦点はその行の `…`（Esc は開いた中身の button で受ける）。
    renderOperableRows();
    pressOperation(rowToggle(1));
    const panelId = rowToggle(1).getAttribute('aria-controls');

    fireEvent.keyDown(openedEdit(1), { key: 'Escape' });

    expect(panelId === null ? null : document.getElementById(panelId)).toBeNull();
    expect(document.activeElement).toBe(rowToggle(1));
  });

  it('確認の行が一覧から消えたあとにやめると、焦点はどの行の操作にも戻らない', () => {
    // 規則13: その行がもう無ければ戻さない。
    const { rerenderWith } = renderOperableRows();

    openConfirmationByToggle();
    rerenderWith([twoRows[0] as StockItemDto]);
    pressOperation(cancelConfirmation());

    expect(allToggles()).not.toContain(document.activeElement);
  });

  it('確認を出している間に行をタップしても、編集の口へ何も届かない', () => {
    // 規則14: 確認を出している間、一覧の操作は何もしない。
    const { edits } = renderOperableRows();

    openConfirmationBySwipe();
    tapRow(0);

    expect(edits).toEqual([]);
  });

  it('確認を出している間に行の操作を押しても、`…` は開かない', () => {
    // 規則14。
    renderOperableRows();

    openConfirmationBySwipe();
    pressOperation(rowToggle(0));

    expect(rowToggle(0).getAttribute('aria-expanded')).toBe('false');
  });

  it('確認を出している間に行をなぞっても、削除は現れない', () => {
    // 規則14。
    renderOperableRows();

    openConfirmationBySwipe();
    swipeRow(0);

    expect(rowButtons(0)).toHaveLength(1);
  });

  it('確認を出している間に一覧からその行が消えても、確認は開いた在庫品を出し続ける', () => {
    // 規則12: 確認は開いた時点の在庫品1件を抱える（B-55 規則17 と同じ構え）。
    const { rerenderWith } = renderOperableRows();

    openConfirmationBySwipe();
    rerenderWith([twoRows[0] as StockItemDto]);

    expect(dialogsNaming('白菜')).toHaveLength(1);
  });

  it('一覧からその行が消えたあとに確認の削除を押すと、抱えている識別子で送る', async () => {
    // 規則12 / ADR-050: 一覧から消えていれば `delete.notFound` になり、消えたと読む。
    const { requests, rerenderWith } = renderOperableRows();

    openConfirmationBySwipe();
    rerenderWith([twoRows[0] as StockItemDto]);
    pressOperation(confirmDeletion());
    await flush();

    expect(requests.deletedIds).toEqual(['2']);
  });

  it('`…` を開いた行が一覧から消えると、開いた中身は描かれない', () => {
    // 規則15: 状態が指す識別子が今の一覧に無いとき、開いた中身を描かない。
    const { rerenderWith } = renderOperableRows();

    pressOperation(rowToggle(1));
    rerenderWith([twoRows[0] as StockItemDto]);

    expect(screen.getAllByRole('button')).toEqual([rowToggle(0)]);
  });

  it('削除が現れた行が一覧から消えると、現れた削除は描かれない', () => {
    // 規則15。
    const { rerenderWith } = renderOperableRows();

    swipeRow(1);
    rerenderWith([twoRows[0] as StockItemDto]);

    expect(screen.getAllByRole('button')).toEqual([rowToggle(0)]);
  });

  it.each([
    ['読み込み中', { outcome: 'loading' } as const],
    ['取れなかった', { outcome: 'failed' } as const],
    ['0件', { outcome: 'loaded', stockItems: [] } as const],
  ])('%sの一覧には、行の操作を1つも描かない', (_label, stockItems) => {
    // 規則16 / B-22 / B-11: 行が無いので、行の操作も開いた中身も無い。
    render(
      <PantryList
        today={TODAY}
        onDelete={neverDelete}
        onEdit={neverEdit}
        stockItems={stockItems}
      />,
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('確認の削除の結末が「見つからない」なら、案内を出さない', async () => {
    // 7章 / ADR-050: `delete.notFound` は「すでに消えている」と読む（今のまま）。
    const { requests } = renderOperableRows({
      remove: [{ outcome: 'rejected', rule: 'delete.notFound' }],
    });

    openConfirmationBySwipe();
    pressOperation(confirmDeletion());
    await waitFor(() => {
      expect(requests.deletedIds).toHaveLength(1);
    });
    await flush();

    expect(screen.queryAllByRole('paragraph')).toHaveLength(0);
  });

  it('確認の削除の結末が失敗なら、案内を1つ出す', async () => {
    // 7章 / ADR-032 決定3: それ以外の断り・失敗は今の案内（文言は見ない）。
    renderOperableRows({ remove: [{ outcome: 'failed' }] });

    openConfirmationBySwipe();
    pressOperation(confirmDeletion());

    await waitFor(() => {
      expect(screen.queryAllByRole('paragraph')).toHaveLength(1);
    });
  });
});
