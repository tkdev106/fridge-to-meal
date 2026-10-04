// @vitest-environment jsdom
/**
 * `PantryList` の**表示の分岐**（`docs/testing.md` 4章 / ADR-052）。
 *
 * `PantrySections.ts` と `RemainingDays.ts` の計算は、それぞれの純粋関数のテストが既に
 * 押さえている。ここで確かめるのは**受け取った3値のどれを描くか**だけである（B-22 設計 5章）。
 *
 * **仮の文言を期待値に書かない。** 読み込み中・取れなかった・0件・消せなかったの案内は
 * `docs/screen-design.md` 論点3 で未確定のままであり、文字列で留めると**文言を変えただけで
 * 赤くなる。** 代わりに、**利用者から見える構造**（行が出るか、帯がいくつか、どの順か）と、
 * **こちらが渡したデータ**（在庫品の名称）で観察する。
 *
 * **帯の見出し（`今日まで` / `期限が近い` / `その他`）と残日数の文（`今日` / `あと N日` / `－`）は
 * デザインが正になった**（ADR-074 結果1 / B-64 設計 規則3〜5）。B-64 の suite はこれらを期待値に置く。
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
import { FixedBackNavigation } from '../../support/backNavigation/FixedBackNavigation.js';
import { pressOperation } from '../../support/dom/pressOperation.js';
import { FixedStockItemRequests } from '../../support/server/FixedStockItemRequests.js';
import type { FixedStockItemRequestsOptions } from '../../support/server/FixedStockItemRequests.js';
import { BackNavigationProvider } from '../../../src/backNavigation/BackHandler.js';
import { PantryList } from '../../../src/features/pantry/PantryList.js';
import type { DeleteStockItem } from '../../../src/server/StockItemRequests.js';

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
  return { ingredientId: null, amount: null, expiryDate: null, useForMeals: true, ...overrides };
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
    // **当てるのはテストが渡した名称と分量だけである。** 残日数の文（`今日` / `あと2日` / `－`）は
    // デザインが正になった（ADR-074 結果1 / B-64 設計 規則5）が、この観点の本題は並びであり、
    // 文の確かめは下の B-64 の suite の持ち分である。
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
    // 見出しの文言はデザインが正になった（B-64 設計 規則3）が、文言の確かめは下の B-64 の
    // suite の持ち分であり、ここでは数だけを見る。
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

/**
 * 接続が切れている間の削除（B-70 設計 6章 規則6・11・14 / 7章 行1 / FR-41 / FR-06。B-69 で
 * 確認を挟んだあとの形）。
 *
 * **確認の `削除` を押せなくする**（SettingsScreen の確定と同じ構え）。なぞる・確認を開く・
 * やめるは止めない — どれも書き込みを伴わない。タップで編集を開くことも止めない（規則6）。
 *
 * 届いたものも届かなかったことも、**テストが持つ配列の中身**で見る（`docs/testing.md` 2章）。
 */
describe('在庫一覧 PantryList の接続が切れている間', () => {
  /** `offline` を後から切り替えるために、描き直しの口を返す。 */
  function renderTwoRowsWith(edits: StockItemDto[], onDelete: DeleteStockItem, offline: boolean) {
    const rendered = render(
      <PantryList
        today={TODAY}
        onDelete={onDelete}
        onEdit={recordingEdit(edits)}
        stockItems={{ outcome: 'loaded', stockItems: twoRows }}
        offline={offline}
      />,
    );

    return {
      setOffline: (next: boolean) => {
        rendered.rerender(
          <PantryList
            today={TODAY}
            onDelete={onDelete}
            onEdit={recordingEdit(edits)}
            stockItems={{ outcome: 'loaded', stockItems: twoRows }}
            offline={next}
          />,
        );
      },
    };
  }

  it('接続が切れている間は、確認の削除が押せない', () => {
    renderTwoRowsWith([], recordingDelete([]), true);

    openConfirmationBySwipe();

    // 規則11 / FR-41: 削除は書き込みを伴う操作である。
    expect(confirmDeletion()).toHaveProperty('disabled', true);
  });

  it('接続が切れている間は、確認の削除を押しても削除の口へ何も届かず、行は残る', async () => {
    const deletedIds: string[] = [];
    renderTwoRowsWith([], recordingDelete(deletedIds), true);

    openConfirmationBySwipe();
    fireEvent.click(confirmDeletion());
    await act(async () => {});

    expect(deletedIds).toEqual([]);
    expect(screen.queryByText('白菜')).not.toBeNull();
  });

  it('接続が切れている間も、確認はやめられる', () => {
    renderTwoRowsWith([], recordingDelete([]), true);

    openConfirmationBySwipe();
    pressOperation(cancelConfirmation());

    // 規則6: やめるは書き込みを伴わない。
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('接続が切れていても、行をタップするとその在庫品が編集の口へ届く', () => {
    const edits: StockItemDto[] = [];
    renderTwoRowsWith(edits, recordingDelete([]), true);

    pressAndRelease({ x: 0, y: 0 });

    // 規則6・11: 編集の画面を開くのは遷移である。
    expect(edits).toEqual([twoRows[1]]);
  });

  it('接続が戻ると、確認の削除でなぞった行の識別子が削除の口へ届く', () => {
    const deletedIds: string[] = [];
    const { setOffline } = renderTwoRowsWith([], recordingDelete(deletedIds), true);

    openConfirmationBySwipe();
    setOffline(false);
    pressOperation(confirmDeletion());

    // 規則14: 戻れば止めた操作は元に戻る。
    expect(deletedIds).toEqual(['2']);
  });
});

/**
 * 帯と行の見せ方（B-64 設計 6章 規則3〜6 / FR-12 / FR-13 / NFR-17 / ADR-074）。
 *
 * **帯の見出しと残日数の文はデザインが正である**（ADR-074 結果1）ので、ここでは期待値に置く。
 * **見た目（色・寸法・class 名）は見ない**（ADR-055 結果1 — class 名は vitest では何でも通る）。
 */

/** 3つの帯へ1件ずつ入る標本（基準日 2026-09-20：今日・2日後・期限なし）。 */
const oneRowPerSection = [
  stockItem({ id: '1', name: '豚こま肉', expiryDate: '2026-09-20' }),
  stockItem({ id: '2', name: '白菜', expiryDate: '2026-09-22' }),
  stockItem({ id: '3', name: 'にんじん' }),
];

function renderRows(stockItems: readonly StockItemDto[]) {
  render(
    <PantryList
      today={TODAY}
      onDelete={neverDelete}
      onEdit={neverEdit}
      stockItems={{ outcome: 'loaded', stockItems }}
    />,
  );
}

/** 要素の文字の中に `mark` が何回現れるか。 */
function countOf(element: HTMLElement, mark: string): number {
  return Array.from(element.textContent ?? '').filter((character) => character === mark).length;
}

/** 1件だけ渡したときの、その1行。**1行であることを先に確かめる。** */
function soleRow(): HTMLElement {
  const found = screen.getAllByRole('listitem');
  expect(found).toHaveLength(1);

  return rowAt(found, 0);
}

/** `a` が文書順で `b` より前にあるか。 */
function precedes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('在庫一覧 PantryList の帯と行の見せ方', () => {
  it('3つの帯の見出しは、上から `今日まで`・`期限が近い`・`その他` である', () => {
    renderRows(oneRowPerSection);

    // B-64 規則3 / FR-12: 見出しの文そのものが警告になっている（NFR-17）。名前は完全一致で引く —
    // `!` が名前に入っていれば当たらない。
    const expected = ['今日まで', '期限が近い', 'その他'].map((name) =>
      screen.queryByRole('heading', { level: 2, name }),
    );
    expect(screen.getAllByRole('heading', { level: 2 })).toEqual(expected);
  });

  it('`!` を添えるのは `今日まで` の帯の見出しだけである', () => {
    renderRows(oneRowPerSection);

    // B-64 規則3 / NFR-17: 色だけで分けないために記号を添える。添えるのは最も急ぐ帯だけである。
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => countOf(heading, '!')),
    ).toEqual([1, 0, 0]);
  });

  it('行には名称・分量・残日数がこの順に並び、行の操作が最後に来る', () => {
    renderRows([
      stockItem({ id: '1', name: '豚こま肉', amount: '300g', expiryDate: '2026-09-22' }),
    ]);

    // B-64 規則4 / FR-04: 行は名称・分量・残日数・`…` の順（原本 rowCols）。
    const row = soleRow();
    const ordered = [
      within(row).getByText('豚こま肉'),
      within(row).getByText('300g'),
      within(row).getByText('あと2日'),
      within(row).getByRole('button', { name: '操作' }),
    ];
    expect(
      ordered.slice(1).map((element, index) => precedes(ordered[index] as Node, element)),
    ).toEqual([true, true, true]);
  });

  it('分量の無い行には、`null` も `－` も文字として出さない', () => {
    renderRows([stockItem({ id: '1', name: '白菜', amount: null, expiryDate: '2026-09-22' })]);

    // B-64 規則4 / FR-13: `－` は期限なしの印であり、分量には使わない。
    const text = soleRow().textContent ?? '';
    expect([text.includes('null'), text.includes('－')]).toEqual([false, false]);
  });

  it('期限の無い行は、残日数を `－` で示す', () => {
    renderRows([stockItem({ id: '1', name: 'にんじん', amount: '2本' })]);

    // B-64 規則5 / FR-13: 期限が未設定の行は `－`。
    expect(countOf(soleRow(), '－')).toBe(1);
  });

  it('分量も期限も無い行では、`－` を1つだけ出す', () => {
    renderRows([stockItem({ id: '1', name: 'にんじん' })]);

    // B-64 規則4・5: 分量の欄は空のまま置き、`－` は残日数の欄にだけ出す。
    expect(countOf(soleRow(), '－')).toBe(1);
  });

  it('期限が今日の行は、残日数を `今日` と文で示す', () => {
    renderRows([stockItem({ id: '1', name: '豚こま肉', expiryDate: TODAY })]);

    // B-64 規則5 / NFR-17: 色は文に添えるだけで、文は必ず出す。
    expect(within(soleRow()).queryAllByText('今日')).toHaveLength(1);
  });

  it('期限が近い行は、残日数を `あと N日` と文で示す', () => {
    renderRows([stockItem({ id: '1', name: '白菜', expiryDate: '2026-09-22' })]);

    // B-64 規則5 / NFR-17。
    expect(within(soleRow()).queryAllByText('あと2日')).toHaveLength(1);
  });

  it('行の操作の名前は `操作` である', () => {
    renderRows(twoRows);

    // B-64 規則6 / 論点4 #2: アイコンに替えても名前は変えない。
    expect(
      allToggles().filter((toggle) => toggle.getAttribute('aria-label') === '操作'),
    ).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: '操作' })).toEqual(allToggles());
  });
});

/**
 * 確認を出している間の一覧（B-64 設計 6章 規則9 / 論点4 #1）。
 *
 * **`inert` は属性の有無で観る**（設計 10章 — jsdom は焦点を止める振る舞いまでは持たない）。
 * ARIA の役割でも文でも見えない約束なので、`closest('[inert]')` の1行だけ DOM を辿る
 * （先例 `SignInForm.test.tsx` の `closest('[aria-hidden="true"]')`）。
 *
 * 引くときは `hidden: true` を付ける — 読み上げの木から外れているかどうかはこの観点の本題ではなく、
 * 外れていても要素そのものは引けなければならない。
 */

/** 要素が `inert` の中にあるか。 */
function insideInert(element: HTMLElement): boolean {
  return element.closest('[inert]') !== null;
}

/** 帯の見出しと行をすべて。 */
function listParts(): readonly HTMLElement[] {
  return [
    ...screen.getAllByRole('heading', { level: 2, hidden: true }),
    ...screen.getAllByRole('listitem', { hidden: true }),
  ];
}

describe('在庫一覧 PantryList の確認を出している間', () => {
  it('確認を出していない間は、一覧を `inert` にしない', () => {
    renderOperableRows();

    // B-64 規則9: 何も出ていない一覧は操作できる。
    expect(listParts().map(insideInert)).toEqual([false, false, false]);
  });

  it('確認を出している間は、帯の見出しも行も `inert` の中にある', () => {
    renderOperableRows();

    openConfirmationBySwipe();

    // B-64 規則9 / 論点4 #1: 焦点を確認の中に閉じ込める。
    expect(listParts().map(insideInert)).toEqual([true, true, true]);
  });

  it('確認を出している間も、確認そのものは `inert` の外にある', () => {
    renderOperableRows();

    openConfirmationBySwipe();

    // B-64 規則9: 確認（暗幕と `role="dialog"`）は包みの外に置く。
    expect(insideInert(screen.getByRole('dialog'))).toBe(false);
  });

  it('確認をやめると、一覧の `inert` は外れる', () => {
    renderOperableRows();

    openConfirmationBySwipe();
    pressOperation(cancelConfirmation());

    // B-64 規則9: 閉じたら `inert` を外す。
    expect(listParts().map(insideInert)).toEqual([false, false, false]);
  });

  it('消せなかった案内も、次の確認を出している間は `inert` の中にある', async () => {
    renderOperableRows({ remove: [{ outcome: 'failed' }] });

    openConfirmationBySwipe();
    pressOperation(confirmDeletion());
    await waitFor(() => {
      expect(screen.queryAllByRole('paragraph')).toHaveLength(1);
    });
    openConfirmationBySwipe();

    // B-64 規則9: 包むのは帯・行・削除の断りの案内である。案内は確認の文でない段落で引く。
    const dialog = screen.getByRole('dialog');
    const notices = screen
      .getAllByRole('paragraph', { hidden: true })
      .filter((paragraph) => !dialog.contains(paragraph));
    expect(notices.map(insideInert)).toEqual([true]);
  });
});

/**
 * 端末の「戻る」（B-75 設計 6章 規則1・2・3・11 / ADR-084）。
 *
 * 継ぎ目は記憶上の `FixedBackNavigation` に差し替え、`pressBack()` で「利用者が戻るを押した」
 * ことにする。受け取ったかどうかは `pressBack()` の戻り値、閉じたことは画面に何が残るかで観る。
 * 閉じ方は Esc・やめると同じ口（`dismissed`）なので、焦点の戻し方も同じである（規則1）。
 */
describe('在庫一覧 PantryList の端末の戻る', () => {
  function renderRowsWithBack(offline = false): FixedBackNavigation {
    const backNavigation = new FixedBackNavigation();
    render(
      <BackNavigationProvider backNavigation={backNavigation}>
        <PantryList
          today={TODAY}
          onDelete={recordingDelete([])}
          onEdit={recordingEdit([])}
          stockItems={{ outcome: 'loaded', stockItems: twoRows }}
          offline={offline}
        />
      </BackNavigationProvider>,
    );

    return backNavigation;
  }

  function pressBack(backNavigation: FixedBackNavigation): boolean {
    let received = false;
    act(() => {
      received = backNavigation.pressBack();
    });

    return received;
  }

  it('何も出ていない一覧では、戻るを受け取らない', () => {
    const backNavigation = renderRowsWithBack();

    // 規則2・5: 行の操作の口は `rowOperations` が何も出ていないときには置かない。
    expect(pressBack(backNavigation)).toBe(false);
  });

  it('削除の確認を出している間に戻ると、確認が閉じる', () => {
    const backNavigation = renderRowsWithBack();
    openConfirmationBySwipe();

    pressBack(backNavigation);

    // 規則1・2: 確認 → 一覧。
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
  });

  it('`…` から開いた削除の確認を戻るで閉じると、焦点はその行の操作へ戻る', () => {
    const backNavigation = renderRowsWithBack();
    openConfirmationByToggle();

    pressBack(backNavigation);

    // 規則1 / B-69 規則13 / NFR-16: やめると同じ口で閉じるので、焦点の戻し方も同じである。
    expect(document.activeElement).toBe(rowToggle(1));
  });

  it('開いた `…` は、戻るで閉じる', () => {
    const backNavigation = renderRowsWithBack();
    pressOperation(rowToggle(1));
    const panelId = rowToggle(1).getAttribute('aria-controls');

    pressBack(backNavigation);

    // 規則2: 行の `…` → 一覧。
    expect(panelId === null ? null : document.getElementById(panelId)).toBeNull();
  });

  it('開いた `…` を戻るで閉じると、焦点はその行の操作にある', () => {
    const backNavigation = renderRowsWithBack();
    pressOperation(rowToggle(1));

    pressBack(backNavigation);

    // 規則1 / B-69 規則13: Esc で閉じたときと同じ。
    expect(document.activeElement).toBe(rowToggle(1));
  });

  it('なぞって現れた削除は、戻るで消える', () => {
    const backNavigation = renderRowsWithBack();
    swipeRow(1);

    pressBack(backNavigation);

    // 規則2: 現れた `削除` も `rowOperations` が `idle` でない状態の1つである。行に残るのは `…` だけ。
    expect(rowButtons(1)).toHaveLength(1);
  });

  it('接続が切れていても、削除の確認は戻るで閉じる', () => {
    const backNavigation = renderRowsWithBack(true);
    openConfirmationBySwipe();

    pressBack(backNavigation);

    // 規則11 / FR-41: 閉じるのは書き込みではない。
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
  });
});
