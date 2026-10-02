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

    // 規則15 / FR-06: 触っただけで消えない — 確認も取り消しも無い操作である
    // （`docs/screen-design.md` 5章）。
    expect(deletedIds).toEqual([]);
  });

  it('削除として読む長さまでなぞった動きでは、編集の口へ何も届かない', async () => {
    const edits: StockItemDto[] = [];
    const deletedIds: string[] = [];
    renderTwoRows(edits, deletedIds);

    pressAndRelease({ x: 100, y: 0 });

    // 削除は届いている（対にして確かめる — 届いていなければ「編集が開かないこと」を
    // 動きの長さで確かめたことにならない）。
    await waitFor(() => {
      expect(deletedIds).toEqual(['2']);
    });

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
 * 接続が切れている間のスワイプ（B-70 設計 6章 規則6・11・14 / 7章 行1 / FR-41 / FR-06）。
 *
 * **スワイプ削除は `disabled` を持たないので、削除と読めた動きを捨てる**（規則11）。削除の口を
 * 呼ばず、断りの案内も出さず、行は残る。タップで編集を開くことは止めない（規則6）。
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

  /** 削除の口へ届いた識別子を**配列に残し**、結末は「失敗」を返す（案内が出る結末）。 */
  function recordingFailedDelete(deletedIds: string[]) {
    return (id: string) => {
      deletedIds.push(id);

      return Promise.resolve({ outcome: 'failed' } as const);
    };
  }

  it('接続が切れている間は、削除と読める長さまでなぞっても削除の口へ何も届かない', () => {
    const deletedIds: string[] = [];
    renderTwoRowsWith([], recordingDelete(deletedIds), true);

    pressAndRelease({ x: 100, y: 0 });

    // 規則11 / FR-41: 削除は書き込みを伴う操作である。
    expect(deletedIds).toEqual([]);
  });

  it('接続が切れている間になぞっても、行は残る', () => {
    renderTwoRowsWith([], recordingDelete([]), true);

    pressAndRelease({ x: 100, y: 0 });

    // 規則11: 行は残る。
    expect(screen.queryByText('白菜')).not.toBeNull();
  });

  it('接続が切れている間になぞっても、断りの案内を出さない', async () => {
    // 結末を「失敗」にしておく — 削除の口が呼ばれれば案内が出るので、出ないことに意味がある。
    renderTwoRowsWith([], recordingFailedDelete([]), true);

    pressAndRelease({ x: 100, y: 0 });
    await act(async () => {});

    // 規則11 / 7章 行1: 理由は門の帯が示すので、二重に案内しない。
    expect(screen.queryAllByRole('paragraph')).toHaveLength(0);
  });

  it('接続が切れていても、行をタップするとその在庫品が編集の口へ届く', () => {
    const edits: StockItemDto[] = [];
    renderTwoRowsWith(edits, recordingDelete([]), true);

    pressAndRelease({ x: 0, y: 0 });

    // 規則6・11: 編集の画面を開くのは遷移である。
    expect(edits).toEqual([twoRows[1]]);
  });

  it('接続が戻ると、なぞった行の識別子が削除の口へ届く', () => {
    const deletedIds: string[] = [];
    const { setOffline } = renderTwoRowsWith([], recordingDelete(deletedIds), true);

    setOffline(false);
    pressAndRelease({ x: 100, y: 0 });

    // 規則14: 戻れば止めた操作は元に戻る。
    expect(deletedIds).toEqual(['2']);
  });
});
