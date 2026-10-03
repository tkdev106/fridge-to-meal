// @vitest-environment jsdom
/**
 * 在庫タブの中身 `PantryTab` の**一覧と登録・編集のパネル**（B-39 設計 6章 規則1〜7・14〜16 /
 * 7章 / B-55 / B-65b 設計 6章 規則1〜10 / 7章 / ADR-052 / ADR-076 / `docs/testing.md` 4.1）。
 *
 * 一覧そのものの見せ方は `PantryList.test.tsx`、登録の入力の扱いは `StockItemFormValues.test.ts`
 * と `RegisterFailureNotice.test.ts` が既に押さえている。ここで確かめるのは**切り出せないもの**
 * だけ — いまパネルを出しているか、操作でどう移るか、移っても残らないもの、焦点がどこへ戻るかである。
 *
 * **B-65b で入れ替わりは「一覧を常に置き、パネルを隣に出す」に変わった**（B-65b 規則1。B-39 規則1・
 * B-55 規則16 の置き換え）。パネルを出している間、一覧の側（見出しの行と一覧）は木に残ったまま
 * `inert` の中に入る（規則3）。SP で一覧の側を隠すのは CSS で、jsdom では見えない（ADR-055 決定3）。
 *
 * **文言は ADR-074 で確定した**（`docs/design/`）。観察は次の手がかりで行う。
 *
 * - **パネルが出ている** … 登録なら `combobox`（食材名の欄）の有無、編集なら `textbox`（分量の欄）が
 *   1つあるか。**一覧の側は `textbox` も `combobox` も描かない。** 一覧の側が常に木にあるので、
 *   在庫品の名称や `listitem` の有無では「パネルが出ているか」を読めない（B-65b）
 * - **`inert`** … `closest('[inert]')` で属性の有無を見る（先例 `PantryList.test.tsx`）。引くときは
 *   `hidden: true` を付ける
 * - **焦点** … `document.activeElement`（先例 `PantryList.test.tsx`）
 * - **操作** … 確定した文言の名前で引く（`食材を追加` `戻る` `閉じる` `保存してもう1件`
 *   `保存して閉じる` `保存` `操作` `設定`。ADR-074）。**一覧だけを出している回の数え方**は
 *   `contentButtons` / `operationAt` で、名前 `設定` を除いた文書順の位置で引く
 *
 * **閉じたことを「渡した関数が呼ばれた回数」で観ない**（`docs/testing.md` 2章 / B-39 設計 8章）。
 * 送っていないことも、`vi.fn()` ではなく**テストが持つ配列の中身**で見る。
 */

import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { RegisterStockItemInput, StockItemDto } from '@fridge-to-meal/contract';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../support/dom/renderComponent.js';
import { installPointerCapture } from '../../support/dom/pointerCapture.js';
import { FixedStockItemRequests } from '../../support/server/FixedStockItemRequests.js';
import type { FixedStockItemRequestsOptions } from '../../support/server/FixedStockItemRequests.js';
import type { PantryTabProps } from '../../../src/features/pantry/PantryTab.js';
import { PantryTab } from '../../../src/features/pantry/PantryTab.js';
import type { TabId } from '../../../src/navigation/Tabs.js';
import { DEFAULT_TAB, TAB_ORDER } from '../../../src/navigation/Tabs.js';
import { TabbedScreen } from '../../../src/navigation/TabbedScreen.js';
import type {
  DeleteStockItem,
  RegisterStockItem,
  RegisterStockItemOutcome,
  UpdateStockItem,
} from '../../../src/server/StockItemRequests.js';

// 行をタップする経路は jsdom に無いメソッドを通る（`support/dom/pointerCapture.ts`）。
// **本体の振る舞いではなく、道具の欠けを道具の側で埋めるものである。**
installPointerCapture();

/** 残日数の基準日。帯の振り分けはこの観点の本題ではないので固定で渡す。 */
const today = '2026-09-20';

function stockItemOf(name: string, id: string): StockItemDto {
  return { id, name, ingredientId: null, amount: null, expiryDate: null };
}

/** 一覧が出ていることを観るための標本。**当てるのはこの名称だけである。** */
const carrot = stockItemOf('にんじん', '1');
/** 一覧の結末が入れ替わったことを観るための、もう1つの標本。 */
const chineseCabbage = stockItemOf('白菜', '2');

function loaded(...stockItems: readonly StockItemDto[]): PantryTabProps['stockItems'] {
  return { outcome: 'loaded', stockItems };
}

/** この観点では削除を起こさない。呼ばれたら分かる形にしておく（先行 `PantryList.test.tsx`）。 */
const neverDelete: DeleteStockItem = () => Promise.reject(new Error('この観点では削除を呼ばない'));

/** 登録を起こさない観点のための口。同じく、呼ばれたら分かる形にしておく。 */
const neverRegister: RegisterStockItem = () =>
  Promise.reject(new Error('この観点では登録を呼ばない'));

/** 更新を起こさない観点のための口（B-55）。同じく、呼ばれたら分かる形にしておく。 */
const neverUpdate: UpdateStockItem = () => Promise.reject(new Error('この観点では更新を呼ばない'));

/**
 * 送られた登録を**配列に残す**口。`vi.fn()` で回数を数えず、配列の中身を状態として見る
 * （`docs/testing.md` 2章）。
 */
function recordingRegister(
  registrations: RegisterStockItemInput[],
  outcome: RegisterStockItemOutcome,
): RegisterStockItem {
  return (input) => {
    registrations.push(input);

    return Promise.resolve(outcome);
  };
}

function pantryTab(overrides: Partial<PantryTabProps> = {}) {
  return (
    <PantryTab
      stockItems={loaded(carrot)}
      today={today}
      onDelete={neverDelete}
      onRegister={neverRegister}
      onUpdate={neverUpdate}
      ingredientNames={{ outcome: 'loading' }}
      onOpenSettings={() => {}}
      {...overrides}
    />
  );
}

/**
 * 名前 `設定` の操作 — 見出しの行の歯車（B-60 設計 6章 規則13）と、器を挟む観点では帯の「設定」。
 * 名前は原本から取った文言で仮ではない（ADR-074 決定1）ので、名前で引く。
 */
function settingsButtons(): HTMLElement[] {
  return screen.queryAllByRole('button', { name: '設定', hidden: true });
}

/**
 * 在庫の操作を**文書順**で引く。**見出しの歯車（と帯の「設定」）は数えない**（B-60）— 歯車は
 * 一覧の先頭に置かれるので、数えると「一覧の先頭の操作＝登録を開く」が崩れる。
 *
 * **一覧だけを出している回にだけ使う。** パネルを出している回は一覧の側の操作も木に残る
 * （B-65b 規則1）ので、位置ではなく名前で引く。
 */
function contentButtons(): HTMLElement[] {
  const settings = settingsButtons();

  return screen.queryAllByRole('button').filter((button) => !settings.includes(button));
}

/** `before` が文書順で `after` より前にあるか（jsdom はレイアウトを持たない）。 */
function precedes(before: Node, after: Node): boolean {
  return (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * 押せる操作を**文書順の位置**で引く（負の位置は末尾から数える）。**見出しの歯車は数えない**
 * （`contentButtons`。B-60）。**一覧だけを出している回にだけ使う**（`contentButtons`）。
 *
 * **下タブは混ざらない。** 帯のタブは `role="tab"` を明示しており、この問い合わせに
 * 引っかからない（`TabbedScreen.tsx` / 2026-09-21 に実物で確認）。
 */
function operationAt(index: number): HTMLElement {
  const found = contentButtons().at(index);
  if (found === undefined) throw new Error(`${index} 番目の操作が無い`);

  return found;
}

/** 要素が `inert` の中にあるか（先例 `PantryList.test.tsx`）。 */
function insideInert(element: HTMLElement): boolean {
  return element.closest('[inert]') !== null;
}

/**
 * 登録を開く操作 `食材を追加`（B-64 規則2 / ADR-074）。**`inert` の中にあっても引く**
 * （`hidden: true`）— パネルを出している間も木に残る（B-65b 規則1）。
 */
function openRegisterButton(): HTMLElement {
  return screen.getByRole('button', { name: '食材を追加', hidden: true });
}

/** 登録を開く。 */
function openRegister(): void {
  fireEvent.click(openRegisterButton());
}

/** 保存せずに閉じる操作 `戻る`（アイコン。B-65 規則2 / B-65b 規則9）。 */
function backButton(): HTMLElement {
  return screen.getByRole('button', { name: '戻る' });
}

/** 保存せずに閉じる操作 `閉じる`（見える文字。B-65b 規則9）。 */
function closeButton(): HTMLElement {
  return screen.getByRole('button', { name: '閉じる' });
}

/**
 * 食材名の欄。**`role="combobox"` を明示しているため役割は `combobox` である**（B-50c /
 * B-66 設計 規則13）— 補完が0件の回も欄はこの役割のままである。
 *
 * **`instanceof HTMLInputElement` で絞らない** — 役割で引いている以上、入力の欄であることは
 * 問い合わせの側が保証している。**DOM の形を辿らない**（ADR-052 結果3）。
 */
function ingredientNameField(): HTMLInputElement {
  return screen.getByRole('combobox') as HTMLInputElement;
}

/** 登録のパネルが出ているかの手がかり。**一覧の側は `combobox` を描かない。** */
function comboboxes(): HTMLElement[] {
  return screen.queryAllByRole('combobox');
}

/** 行をすべて。**`inert` の中にあっても引く**（`hidden: true`）。 */
function rows(): HTMLElement[] {
  return screen.queryAllByRole('listitem', { hidden: true });
}

/** 渡した名称を含む行（1つであることを先に確かめる）。 */
function rowOf(name: string): HTMLElement {
  const found = rows().filter((row) => within(row).queryByText(name) !== null);
  expect(found).toHaveLength(1);

  const [row] = found;
  if (row === undefined) throw new Error(`${name} の行が無い`);

  return row;
}

describe('在庫タブの中身 PantryTab', () => {
  it('最初に出すのは在庫の一覧である', () => {
    render(pantryTab());

    // 規則2 / 要件 第7章: 在庫タブを開いた直後は一覧である。
    expect(screen.queryByText(carrot.name)).not.toBeNull();
  });

  it('最初は登録の入力の欄を出さない', () => {
    render(pantryTab());

    // 規則1・2: 一覧と登録を縦に並べない（B-12 が遷移の無いまま置いた暫定をここで畳む）。
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('登録を開く操作を押すと、登録の入力の欄が出る', () => {
    render(pantryTab());

    fireEvent.click(screen.getByRole('button', { name: '食材を追加' }));

    // 規則3 / FR-01: 一覧の側に登録を開く操作を1つ置く。名前はデザインが正である
    // （B-64 設計 規則2 / ADR-074 結果1）。
    expect(screen.queryAllByRole('textbox').length).toBeGreaterThan(0);
  });

  it('登録を開いても、一覧の在庫品は描かれたまま `inert` の中にある', () => {
    render(pantryTab());

    openRegister();

    // B-65b 規則1・3 / ADR-076 決定2: 一覧の側は木から外さない（B-39 規則1「出すのは一方だけ」の
    // 置き換え）。パネルを出している間は `inert` で操作を受けない。
    const found = rows();
    expect(found).toHaveLength(1);
    expect(found.map(insideInert)).toEqual([true]);
  });

  it('一覧のときに押せる操作は、登録を開くもの1つと行ごとの操作である', () => {
    render(pantryTab({ stockItems: loaded(carrot, chineseCabbage) }));

    // 規則3: 行ごとの `…`（`aria-expanded` を持つ。B-69 設計 規則3）を除けば置くのは1つである。
    // ログアウトは在庫タブに置かない（B-56c 規則12 / `docs/screen-design.md` 2.1 —
    // ログアウトへの経路は設定画面の1つだけ）。見出しの歯車は数えない（B-60）。
    const operations = contentButtons();
    expect(operations.filter((button) => !button.hasAttribute('aria-expanded'))).toHaveLength(1);
    expect(operations.filter((button) => button.hasAttribute('aria-expanded'))).toHaveLength(2);
  });

  it('登録から `戻る` で閉じると、パネルが消え一覧の側の `inert` が外れる', () => {
    render(pantryTab());

    openRegister();
    // 規則7 / B-65b 規則9: 保存せずに閉じる手段。
    fireEvent.click(backButton());

    // B-65b 規則1・3 / B-39 規則7: 閉じればパネルは木から外れ、一覧の側は操作を受けるようになる。
    expect(comboboxes()).toHaveLength(0);
    expect(insideInert(rowOf(carrot.name))).toBe(false);
  });

  it('閉じてから開き直すと、打ちかけの食材名は残っていない', () => {
    render(pantryTab());

    openRegister();
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(backButton());
    openRegister();

    // 規則7: 入力は捨てる。下書きを保存しない。
    expect(ingredientNameField().value).toBe('');
  });

  it('保存せずに閉じる操作は、登録を送らない', () => {
    const registrations: RegisterStockItemInput[] = [];
    render(pantryTab({ onRegister: recordingRegister(registrations, { outcome: 'registered' }) }));

    openRegister();
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(backButton());

    // 規則7 / ADR-007: 閉じるのは捨てることである。**送った中身を配列で見る。**
    expect(registrations).toEqual([]);
  });

  it('一覧が取れなかったときも登録を開ける', () => {
    render(pantryTab({ stockItems: { outcome: 'failed' } }));

    openRegister();

    // 7章3行目 / 規則3: 一覧が取れない断りは登録の画面に及ばない（B-22 / B-23）。
    expect(screen.queryAllByRole('textbox').length).toBeGreaterThan(0);
  });

  it('登録が断られても、パネルは閉じず一覧の側は `inert` のままである', async () => {
    const registrations: RegisterStockItemInput[] = [];
    render(
      pantryTab({
        onRegister: recordingRegister(registrations, { outcome: 'rejected', rule: 'name.empty' }),
      }),
    );

    openRegister();
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存して閉じる' }));

    // 結末は非同期に届くので、送られたことを待ってから画面を見る。**待つ手がかりは案内の
    // 文言ではなくテストが記録した配列である。**
    await waitFor(() => {
      expect(registrations).toHaveLength(1);
    });

    // 7章1行目 / NFR-15 / ADR-032 決定3 / B-65b 7章: 断られた回は閉じない。入力を残して案内を出す。
    expect(comboboxes()).toHaveLength(1);
    expect(insideInert(rowOf(carrot.name))).toBe(true);
  });

  it('一覧の結末が入れ替わっても、開いている登録の画面は閉じない', () => {
    const { rerender } = render(pantryTab());

    openRegister();
    rerender(pantryTab({ stockItems: loaded(chineseCabbage) }));

    // 規則4 / B-22 設計 規則10 / B-65b 規則10: 出し分けの状態は中身が持つ。門が一覧を取り直しても閉じない。
    expect(comboboxes()).toHaveLength(1);
  });

  it('登録を開いている間に取り直した一覧は、`inert` の中で新しい在庫品を出す', () => {
    const { rerender } = render(pantryTab());

    openRegister();
    rerender(pantryTab({ stockItems: loaded(chineseCabbage) }));

    // B-65b 規則1・10: 一覧の側は木に残り、門が渡した結末をそのまま出す。
    expect(insideInert(rowOf(chineseCabbage.name))).toBe(true);
  });
});

/**
 * パネルを出している間の一覧の側（B-65b 設計 6章 規則1〜5 / ADR-076 決定2・結果2）。
 *
 * **`inert` は属性の有無で観る**（jsdom 30 は `inert` の振る舞いを持たない。先例
 * `PantryList.test.tsx`）。`inert` の中の操作を押しても効かないことは、jsdom では作れないので書かない。
 */

/** 一覧の見出し `冷蔵庫`（`h1`）をすべて引く。**`inert` の中にあっても引く。** */
function pantryHeadings(): readonly HTMLElement[] {
  return screen.queryAllByRole('heading', { level: 1, name: '冷蔵庫', hidden: true });
}

/** 唯一の見出し `冷蔵庫`。 */
function soleHeading(): HTMLElement {
  const headings = pantryHeadings();
  expect(headings).toHaveLength(1);

  const [heading] = headings;
  if (heading === undefined) throw new Error('見出し `冷蔵庫` が無い');

  return heading;
}

/** 唯一の名前 `設定` の操作（見出しの行の歯車）。 */
function soleGear(): HTMLElement {
  const gears = settingsButtons();
  expect(gears).toHaveLength(1);

  const [gear] = gears;
  if (gear === undefined) throw new Error('歯車が無い');

  return gear;
}

/** 唯一の `食材を追加`。 */
function soleOpenRegister(): HTMLElement {
  const found = screen.queryAllByRole('button', { name: '食材を追加', hidden: true });
  expect(found).toHaveLength(1);

  const [open] = found;
  if (open === undefined) throw new Error('`食材を追加` が無い');

  return open;
}

describe('在庫タブの中身のパネルと一覧の側', () => {
  it('登録を開いている間、`食材を追加` は `inert` の中にある', () => {
    render(pantryTab());

    openRegister();

    // B-65b 規則3: パネルを開いたまま `+` は効かない。
    expect(insideInert(soleOpenRegister())).toBe(true);
  });

  it('パネルを出していない間は、一覧の側を `inert` にしない', () => {
    render(pantryTab());

    // B-65b 規則3: `inert` を付けるのはパネルを出している間だけである。
    expect(
      [soleHeading(), soleOpenRegister(), soleGear(), rowOf(carrot.name)].map(insideInert),
    ).toEqual([false, false, false, false]);
  });

  it('登録のパネルの欄は `inert` の外にある', () => {
    render(pantryTab());

    openRegister();

    // B-65b 規則3: `inert` は一覧の側だけで、パネルを包まない。
    expect(insideInert(ingredientNameField())).toBe(false);
  });

  it('一覧の側は文書順でパネルより前にある', () => {
    render(pantryTab());

    openRegister();

    // B-65b 規則2 / 原本 `PantryScreen`（`main` の後に `aside`）。
    const panelHeading = screen.getByRole('heading', { level: 1, name: '食材を登録' });
    expect(precedes(soleHeading(), panelHeading)).toBe(true);
  });

  it('登録のパネルの包みに `dialog` と `complementary` の役割を付けない', () => {
    render(pantryTab());

    openRegister();

    // B-65b 規則5 / ADR-076 結果2: SP ではパネルが画面そのものであり、幅で ARIA を変えられない。
    expect([
      screen.queryAllByRole('dialog', { hidden: true }),
      screen.queryAllByRole('complementary', { hidden: true }),
    ]).toEqual([[], []]);
  });
});

/**
 * 器に載せたときの振る舞い（規則5・6）。**器は1行も変えない** — `TabbedScreen` の持ち分は
 * `test/navigation/TabbedScreen.test.tsx` にあり、ここで確かめるのは
 * 「在庫タブの中身が登録の画面を出しているときに、器との間で何が起きるか」だけである。
 */

/** 他の2つのタブへ渡す中身。**「テストが渡したもの」と読める文字列**にしておく。 */
const otherContents = {
  meals: '渡された献立の中身',
  history: '渡された履歴の中身',
} as const;

/**
 * 器は選んでいるタブを持たない（ADR-066 決定1）ので、**このテストの側で持つ。**
 * 門（`App.tsx`）が持つのと同じ形であり、ここで確かめたいのは器の持ち方ではなく
 * 「在庫タブの中身が、タブを挟んだときにどうなるか」である。
 */
function TabbedPantryTab({ pantry }: { pantry: ReactNode }) {
  const [selectedTab, setSelectedTab] = useState<TabId>(DEFAULT_TAB);

  return (
    <TabbedScreen
      meals={otherContents.meals}
      pantry={pantry}
      history={otherContents.history}
      selectedTab={selectedTab}
      onSelectTab={setSelectedTab}
      // 設定はこの観点の本題でない（B-60）。開いていない状態で渡す。
      settings={null}
      onOpenSettings={() => {}}
    />
  );
}

function tabbedPantryTab(overrides: Partial<PantryTabProps> = {}) {
  render(<TabbedPantryTab pantry={pantryTab(overrides)} />);
}

/** タブは並びの位置で引く（`TAB_ORDER` の何番目か。先行 `TabbedScreen.test.tsx`）。 */
function tabFor(tab: TabId): HTMLElement {
  const found = screen.getAllByRole('tab')[TAB_ORDER.indexOf(tab)];
  if (found === undefined) throw new Error(`${tab} のタブが帯に無い`);

  return found;
}

describe('在庫タブの中身と下タブの器', () => {
  it('登録の画面を出していても、下タブの帯は出たままである', () => {
    tabbedPantryTab();

    // **起動時に開くのは献立タブである**（ADR-064 / `navigation/Tabs.ts`）。
    fireEvent.click(tabFor('pantry'));
    openRegister();

    // 規則5 / NFR-14: 帯は下位の画面でも隠さない。隠すには器か門が「在庫タブが下位の画面に
    // 居る」ことを知る必要があり、規則4（状態は中身が持つ）と衝突する。
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('登録の画面を出している間も、下タブの帯は `inert` にしない', () => {
    tabbedPantryTab();

    fireEvent.click(tabFor('pantry'));
    openRegister();

    // B-65b 規則4: `inert` は在庫タブの中身の一覧の側だけで、帯（`PantryTab` の外）には及ばない。
    expect(screen.getAllByRole('tab').map(insideInert)).toEqual([false, false, false]);
  });

  it('登録を開いたまま別のタブへ移って戻ると、登録のパネルは閉じている', () => {
    tabbedPantryTab();

    fireEvent.click(tabFor('pantry'));
    openRegister();
    fireEvent.click(tabFor('meals'));
    fireEvent.click(tabFor('pantry'));

    // 規則6 / B-38 設計 6章 規則6 / B-65b 規則4: 選んだタブの中身だけを木に置くことの帰結である。
    expect(comboboxes()).toHaveLength(0);
    expect(insideInert(rowOf(carrot.name))).toBe(false);
  });

  it('別のタブを挟むと、打ちかけの食材名は残らない', () => {
    tabbedPantryTab();

    fireEvent.click(tabFor('pantry'));
    openRegister();
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(tabFor('meals'));
    fireEvent.click(tabFor('pantry'));
    openRegister();

    // 規則6: 打ちかけの入力も消える。この周で器を変えてまで残さない。
    expect(ingredientNameField().value).toBe('');
  });
});

/**
 * 2つの保存を押したときに、**パネルが閉じるか**（B-39 設計 6章 規則8〜12 / 7章）。
 *
 * **閉じたことを「渡した関数が呼ばれた回数」で観ない**（`docs/testing.md` 2章 / 設計 8章）—
 * `PantryTab` 越しに「`combobox` が出ている／出ていない」で観る。入力が残るかどうかは登録の画面の
 * 持ち分であり、`StockItemForm.test.tsx` にある。
 *
 * 一覧に置く標本は**白菜1件だけ**にし、登録の欄には別の名称を打つ。同じ名称を使うと、
 * 「一覧が出ている」のか「打った値が残っている」のかを取り違える。
 */

/**
 * 分量の欄。**`textbox` はこれ1つだけである** — 食材名は `role="combobox"` を明示しているため `combobox`（B-50c / B-66）、期限は
 * `type="date"` なので、どちらもこの役割に入らない。一覧の側は `textbox` を描かない。
 */
function amountField(): HTMLInputElement {
  const field = screen.getAllByRole('textbox')[0];
  if (field === undefined) throw new Error('分量の欄が無い');

  return field as HTMLInputElement;
}

/**
 * 期限の欄。**この観点で唯一もろい引き方である。**
 *
 * `input[type="date"]` は ARIA の役割に写らないため `textbox` で引けない。この観点はラベルの
 * 文言に頼らずに書いたので、**値が空の入力が1つだけになった状態**で引く — 食材名と分量を先に埋めて
 * おくことが前提である。欄が増えたり順が変わったりすると、この引き方は壊れる。
 */
function expiryDateField(): HTMLElement {
  return screen.getByDisplayValue('');
}

/** 登録の3欄を打つ。期限は最後に引く（`expiryDateField` の前提）。 */
function fillRegisterFields(): void {
  fireEvent.change(ingredientNameField(), { target: { value: 'にんじん' } });
  fireEvent.change(amountField(), { target: { value: '2本' } });
  fireEvent.change(expiryDateField(), { target: { value: '2026-09-25' } });
}

/**
 * 「保存してもう1件」。前に出すほうである（規則8）。名札は原本から取った文言で仮ではない
 * （ADR-074）ので名前で引く — 一覧の側の操作も木に残るため、位置では引けない（B-65b 規則1）。
 * **送っている間は押した側の名札が変わる**ので、押す前に引く。
 */
function saveAndStay(): HTMLElement {
  return screen.getByRole('button', { name: '保存してもう1件' });
}

/** 「保存して閉じる」。文書順の最後である（規則8）。 */
function saveAndClose(): HTMLElement {
  return screen.getByRole('button', { name: '保存して閉じる' });
}

describe('在庫タブの中身と2つの保存', () => {
  it('「保存して閉じる」が通ったら一覧へ戻る', async () => {
    const registrations: RegisterStockItemInput[] = [];
    render(
      pantryTab({
        stockItems: loaded(chineseCabbage),
        onRegister: recordingRegister(registrations, { outcome: 'registered' }),
      }),
    );

    openRegister();
    fillRegisterFields();
    fireEvent.click(saveAndClose());

    // 規則9 / `docs/screen-design.md` 6章: 通ったら一覧へ戻る。パネルが消えるのを待つ。
    await waitFor(() => {
      expect(comboboxes()).toHaveLength(0);
    });
    expect(insideInert(rowOf(chineseCabbage.name))).toBe(false);
  });

  it('送っている間は閉じる操作も効かない', async () => {
    // 結末を保留できる口。押した時点ではまだ返さない。
    let settle: (outcome: RegisterStockItemOutcome) => void = () => undefined;
    const pendingRegister: RegisterStockItem = () =>
      new Promise<RegisterStockItemOutcome>((resolve) => {
        settle = resolve;
      });

    render(pantryTab({ stockItems: loaded(chineseCabbage), onRegister: pendingRegister }));

    openRegister();
    fillRegisterFields();
    fireEvent.click(saveAndStay());

    // 送っている間に閉じようとする。`onClose` は onClick で**同期に**呼ばれるので、効いて
    // しまえばこの時点でパネルが消える。
    fireEvent.click(backButton());

    // 規則10 / 規則11: **送っている間に閉じられてはいけない。** 閉じると、断りの案内が出ない
    // まま画面が消え、打った入力も捨てられる — 利用者は保存できたと思い込む。結末が届く前に
    // 画面を捨てることは、規則10 が守ろうとしているものをこの経路だけ抜けさせる。
    expect(comboboxes()).toHaveLength(1);

    settle({ outcome: 'failed' });

    // 結末が届いたあとも登録の画面のままである（名札が元に戻るのを待つ）。
    await waitFor(() => {
      expect(saveAndStay()).not.toBeNull();
    });
    expect(comboboxes()).toHaveLength(1);
  });

  it('「保存してもう1件」が通っても一覧へ戻らない', async () => {
    const registrations: RegisterStockItemInput[] = [];
    render(
      pantryTab({
        stockItems: loaded(chineseCabbage),
        onRegister: recordingRegister(registrations, { outcome: 'registered' }),
      }),
    );

    openRegister();
    fillRegisterFields();
    fireEvent.click(saveAndStay());

    // 欄が空に戻ったことを待ってから断定する — 結末は非同期に届くので、押した直後の木を
    // 見ると「まだ戻っていない」だけの状態を通してしまう。
    await waitFor(() => {
      expect(screen.queryByDisplayValue('にんじん')).toBeNull();
    });

    // 規則9 / FR-08: こちらは登録の画面に留まり、続けてもう1件入れられる。
    expect(comboboxes()).toHaveLength(1);
  });

  it('登録が失敗したときは一覧へ戻らない', async () => {
    const registrations: RegisterStockItemInput[] = [];
    render(
      pantryTab({
        stockItems: loaded(chineseCabbage),
        onRegister: recordingRegister(registrations, { outcome: 'failed' }),
      }),
    );

    openRegister();
    fillRegisterFields();
    fireEvent.click(saveAndClose());

    await waitFor(() => {
      expect(registrations).toHaveLength(1);
    });

    // 規則10 / 7章 行2 / ADR-007: 失敗した回は閉じない。自動で送り直さないので、
    // 送り直せる画面を残す必要がある。
    expect(comboboxes()).toHaveLength(1);
  });

  it('食材名が空のまま「保存して閉じる」を押しても一覧へ戻らない', () => {
    const registrations: RegisterStockItemInput[] = [];
    render(
      pantryTab({
        stockItems: loaded(chineseCabbage),
        onRegister: recordingRegister(registrations, { outcome: 'registered' }),
      }),
    );

    openRegister();
    // 分量だけを埋める。食材名が空のままでは登録の入力が作れない（B-12 設計 規則2）。
    fireEvent.change(amountField(), { target: { value: '2本' } });
    fireEvent.click(saveAndClose());

    // 規則11: 効かない操作で画面が移らない。送っていないので待つものも無い。
    expect(comboboxes()).toHaveLength(1);
  });

  it('保存して閉じたあとの一覧に、いま登録した食材名は出ない', async () => {
    const registrations: RegisterStockItemInput[] = [];
    render(
      pantryTab({
        stockItems: loaded(chineseCabbage),
        onRegister: recordingRegister(registrations, { outcome: 'registered' }),
      }),
    );

    openRegister();
    fillRegisterFields();
    fireEvent.click(saveAndClose());

    // パネルが消えるのを待つ — 一覧の側は開いている間も木にあるので、名称では待てない（B-65b 規則1）。
    await waitFor(() => {
      expect(comboboxes()).toHaveLength(0);
    });

    // 規則12 / B-22 設計 規則3 / B-24: 登録が通ったときに一覧を取り直すのは**門**である。
    // 中身の側で列に足すと、並び（期限の近い順）を web が握り直すことになる。
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('にんじん')).toBeNull();
  });
});

/**
 * 一覧と**編集**のパネル（FR-05 / B-55 設計 6章 規則15〜17 / 7章 / B-65b 規則1・3）。
 *
 * 編集の画面そのものの振る舞い（欄の値・送る中身・案内）は `StockItemEditForm.test.tsx`、
 * どの動きをタップと読むかは `SwipeGesture.test.ts`、行から編集の口へ届くことは
 * `PantryList.test.tsx` が既に押さえている。ここで確かめるのは**切り出せないもの**だけ —
 * いまパネルを出しているか、どの結末で閉じるかである。
 *
 * 編集のパネルが出ていることは `queryAllByRole('textbox')` が**1つ**であることで観る — 編集の欄は
 * 分量（`textbox`）と期限（`type="date"`）の2つで、**名称の欄（`combobox`）は無い**（規則1）。
 * 一覧の側は `textbox` を描かない。
 *
 * 差し替えは `FixedStockItemRequests` を使う（先行 `StockItemForm.test.tsx` の2つめの suite）。
 * **結末を順に配れて保留もできる**ため、「送っている間」を実時間を待たずに書ける。
 */

/** 分量の違う2件。**どの行を開いたか**を欄の値で読み分けるための標本である。 */
const porkWithAmount: StockItemDto = {
  id: '1',
  name: '豚こま肉',
  ingredientId: null,
  amount: '300g',
  expiryDate: null,
};
const cabbageWithAmount: StockItemDto = {
  id: '2',
  name: '白菜',
  ingredientId: null,
  amount: '1玉',
  expiryDate: null,
};

function renderWithUpdate(
  options: FixedStockItemRequestsOptions,
  overrides: Partial<PantryTabProps> = {},
) {
  const requests = new FixedStockItemRequests(options);
  const props: Partial<PantryTabProps> = { onUpdate: requests.updateStockItem, ...overrides };

  return { requests, rendered: render(pantryTab(props)), props };
}

/** 行に押下と離上を同じ座標に送る — 動かしていないことがタップである（判断は `SwipeGesture.ts`）。 */
function tapRow(row: HTMLElement): void {
  fireEvent.pointerDown(row, { pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(row, { pointerId: 1, clientX: 0, clientY: 0 });
}

/**
 * 行をタップする（規則15）。**行の件数を先に確かめる。**
 */
function tapRowAt(index: number, expectedRows: number): void {
  const found = rows();
  expect(found).toHaveLength(expectedRows);

  const row = found.at(index);
  if (row === undefined) throw new Error(`${index} 番目の行が無い`);

  tapRow(row);
}

/**
 * 編集の画面の分量の欄。**`textbox` はこれ1つだけである**（規則1）。
 *
 * **`instanceof HTMLInputElement` で絞らない**（ADR-052 結果3。先行 `ingredientNameField`）。
 */
function editAmountField(): HTMLInputElement {
  return screen.getByRole('textbox') as HTMLInputElement;
}

/** 編集のパネルが出ているかの手がかり。**一覧の側は `textbox` を描かない。** */
function textboxes(): HTMLElement[] {
  return screen.queryAllByRole('textbox');
}

/** 編集の保存（名札 `保存`。B-65 規則11 / ADR-074）。送っている間は名札が変わるので、押す前に引く。 */
function saveEditOperation(): HTMLElement {
  return screen.getByRole('button', { name: '保存' });
}

describe('在庫タブの中身と編集', () => {
  it('行をタップすると、編集の入力の欄が出る', () => {
    renderWithUpdate({});

    tapRowAt(0, 1);

    // FR-05 / 規則15・16: 行のタップが編集への導線である
    // （`docs/screen-design.md` 2章 `pantry --> edit`）。
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('編集を開いても、一覧の行は描かれたまま `inert` の中にある', () => {
    renderWithUpdate({});

    tapRowAt(0, 1);

    // B-65b 規則1・3: 一覧の側は木から外さない（B-55 規則16「入れ替わる」の置き換え）。
    const found = rows();
    expect(found).toHaveLength(1);
    expect(found.map(insideInert)).toEqual([true]);
  });

  it('編集を開いている間、`食材を追加` は `inert` の中にある', () => {
    renderWithUpdate({});

    tapRowAt(0, 1);

    // B-65b 規則3: パネルを開いたまま登録へは移れない。
    expect(insideInert(soleOpenRegister())).toBe(true);
  });

  it('編集のパネルの欄は `inert` の外にある', () => {
    renderWithUpdate({});

    tapRowAt(0, 1);

    // B-65b 規則3。
    expect(insideInert(editAmountField())).toBe(false);
  });

  it('編集のパネルの包みに `dialog` と `complementary` の役割を付けない', () => {
    renderWithUpdate({});

    tapRowAt(0, 1);

    // B-65b 規則5 / ADR-076 結果2。
    expect([
      screen.queryAllByRole('dialog', { hidden: true }),
      screen.queryAllByRole('complementary', { hidden: true }),
    ]).toEqual([[], []]);
  });

  it('編集から `戻る` で閉じると、パネルが消え一覧の側の `inert` が外れる', () => {
    renderWithUpdate({});

    tapRowAt(0, 1);
    fireEvent.click(backButton());

    // 規則7・8 / B-65b 規則1・3。
    expect(textboxes()).toHaveLength(0);
    expect(insideInert(rowOf(carrot.name))).toBe(false);
  });

  it('保存せずに閉じる操作は、更新を送らない', () => {
    const { requests } = renderWithUpdate({});

    tapRowAt(0, 1);
    fireEvent.change(editAmountField(), { target: { value: '300g' } });
    fireEvent.click(backButton());

    // 規則7: 閉じるのは捨てることである。**送った中身を配列で見る**（`vi.fn()` を使わない）。
    expect(requests.receivedUpdates).toEqual([]);
  });

  it('更新が通ったら一覧へ戻る', async () => {
    renderWithUpdate({ update: [{ outcome: 'updated' }] });

    tapRowAt(0, 1);
    fireEvent.change(editAmountField(), { target: { value: '300g' } });
    fireEvent.click(saveEditOperation());

    // 規則8: **通った回だけ閉じる。** 待つ手がかりはパネルの欄が消えることである。
    await waitFor(() => {
      expect(textboxes()).toHaveLength(0);
    });
  });

  it('更新が断られても編集の画面のままで、一覧へ戻らない', async () => {
    const { requests } = renderWithUpdate({
      update: [{ outcome: 'rejected', rule: 'expiryDate.format' }],
    });

    tapRowAt(0, 1);
    fireEvent.change(editAmountField(), { target: { value: '300g' } });
    fireEvent.click(saveEditOperation());

    await waitFor(() => {
      expect(requests.receivedUpdates).toHaveLength(1);
    });

    // 規則8 / 7章 行2 / NFR-15: 断られた回は閉じない。入力を残して案内を出す。
    expect(textboxes()).toHaveLength(1);
  });

  it('見つからないという断りでも、編集の画面を閉じない', async () => {
    const { requests } = renderWithUpdate({
      update: [{ outcome: 'rejected', rule: 'update.notFound' }],
    });

    tapRowAt(0, 1);
    fireEvent.change(editAmountField(), { target: { value: '300g' } });
    fireEvent.click(saveEditOperation());

    await waitFor(() => {
      expect(requests.receivedUpdates).toHaveLength(1);
    });

    // **ADR-050 結果5** / 規則10: 削除は `delete.notFound` を「すでに消えている」と読んで
    // 何も出さないが、**更新は案内を出して画面も閉じない** — 利用者は書いた内容を持っている。
    expect(textboxes()).toHaveLength(1);
  });

  it('更新が失敗しても一覧へ戻らない', async () => {
    const { requests } = renderWithUpdate({ update: [{ outcome: 'failed' }] });

    tapRowAt(0, 1);
    fireEvent.change(editAmountField(), { target: { value: '300g' } });
    fireEvent.click(saveEditOperation());

    await waitFor(() => {
      expect(requests.receivedUpdates).toHaveLength(1);
    });

    // 規則8 / 7章 行4: 失敗も断りと同じ扱いで、送り直せる画面を残す（自動で送り直さない）。
    expect(textboxes()).toHaveLength(1);
  });

  it('送っている間に閉じる操作を押しても、一覧へ戻らない', async () => {
    const { requests } = renderWithUpdate({
      update: [{ heldUntilSettled: { outcome: 'failed' } }],
    });

    tapRowAt(0, 1);
    fireEvent.change(editAmountField(), { target: { value: '300g' } });
    fireEvent.click(saveEditOperation());

    // 送っている間に閉じようとする。`onClose` は onClick で**同期に**呼ばれるので、効いて
    // しまえばこの時点でパネルが消える。
    fireEvent.click(backButton());

    // 規則7: 結末が届く前に閉じると、**断りの案内が出ないまま画面が消え、打った入力も
    // 捨てられる** — 利用者は保存できたと思い込む。
    expect(textboxes()).toHaveLength(1);

    // 保留を解いてから終える — 届いた更新を `act` の中で起こすためである。
    await act(async () => {
      requests.settle();
    });
  });

  it('一覧の結末が入れ替わっても、開いている編集の画面は閉じない', () => {
    const { requests, rendered } = renderWithUpdate({});

    tapRowAt(0, 1);
    rendered.rerender(
      pantryTab({ onUpdate: requests.updateStockItem, stockItems: loaded(chineseCabbage) }),
    );

    // 規則17 / B-22 設計 規則10 / B-65b 規則10: 門が一覧を取り直しても閉じない（登録の画面と同じ構え）。
    expect(textboxes()).toHaveLength(1);
  });

  it('一覧の結末が入れ替わっても、編集の欄の値は変わらない', () => {
    const { requests, rendered } = renderWithUpdate({}, { stockItems: loaded(porkWithAmount) });

    tapRowAt(0, 1);
    fireEvent.change(editAmountField(), { target: { value: '300g' } });
    rendered.rerender(
      pantryTab({ onUpdate: requests.updateStockItem, stockItems: loaded(cabbageWithAmount) }),
    );

    // 規則17 / NFR-15: 編集の対象は**行から受け取った1件**である。取り直した一覧で欄が
    // 書き換わると、打ちかけの値が黙って消える。
    expect(editAmountField().value).toBe('300g');
  });

  it('一覧へ戻って別の行をタップすると、その行の分量が欄に出る', () => {
    const { requests } = renderWithUpdate(
      {},
      { stockItems: loaded(porkWithAmount, cabbageWithAmount) },
    );

    tapRowAt(0, 2);
    fireEvent.click(backButton());
    tapRowAt(1, 2);

    // 規則2・17: 開くたびに**その行の値**が出る（前に開いた行の値を持ち回さない）。
    expect(editAmountField().value).toBe('1玉');
    expect(requests.receivedUpdates).toEqual([]);
  });
});

/**
 * 一覧の見出しの行（B-64 設計 6章 規則1・2 / ADR-074 / デザイン ★9）。
 *
 * **見出し `冷蔵庫` と操作の名前 `食材を追加` はデザインが正である**（ADR-074 結果1）ので、
 * ここでは期待値に置く。**見た目（アイコン・余白・class 名）は見ない**（ADR-055 結果1）。
 */
describe('在庫タブの見出しの行', () => {
  it.each([
    ['読み込み中', { outcome: 'loading' } as const],
    ['取れなかった', { outcome: 'failed' } as const],
    ['0件', loaded()],
    ['在庫品あり', loaded(carrot)],
  ])('一覧の結末が%sでも、見出し `冷蔵庫` を1つ出す', (_label, stockItems) => {
    render(pantryTab({ stockItems }));

    // B-64 規則1 / ADR-074: 見出しは一覧の結末に関わらず出す（登録を開く操作を置く B-39 規則3 と同じ構え）。
    expect(pantryHeadings()).toHaveLength(1);
  });

  it('登録の画面を開いても、見出し `冷蔵庫` は `inert` の中に残る', () => {
    render(pantryTab({ stockItems: loaded(carrot) }));

    openRegister();

    // B-65b 規則1・3: 見出しの行も一覧の側であり、木に残ったまま `inert` に入る
    // （B-64 規則1 の「登録の画面は一覧と入れ替わる」の置き換え）。
    expect(insideInert(soleHeading())).toBe(true);
  });

  it('編集の画面を開いても、見出し `冷蔵庫` は `inert` の中に残る', () => {
    render(pantryTab({ stockItems: loaded(carrot) }));

    tapRowAt(0, 1);

    // B-65b 規則1・3（B-55 規則16 の置き換え）。
    expect(insideInert(soleHeading())).toBe(true);
  });

  it('登録を開く操作の名前は `食材を追加` である', () => {
    render(pantryTab({ stockItems: loaded(carrot) }));

    // B-64 規則2 / NFR-16: アイコンだけのボタンでも名前で読める。名前は `aria-label` の文だけで、
    // 記号を混ぜない（完全一致）。
    expect(screen.queryAllByRole('button', { name: '食材を追加' })).toHaveLength(1);
  });

  it('`食材を追加` は見出し `冷蔵庫` の後ろ、行の操作より前に並ぶ', () => {
    render(pantryTab({ stockItems: loaded(carrot, chineseCabbage) }));

    // B-64 規則2: 見出しの行の右に置く。文書順で h1 → `食材を追加` → 1行目の `…`。
    const headings = pantryHeadings();
    const opens = screen.queryAllByRole('button', { name: '食材を追加' });
    expect([headings.length, opens.length]).toEqual([1, 1]);

    const [heading] = headings;
    const [open] = opens;
    const firstToggle = screen.getAllByRole('button', { name: '操作' })[0];
    if (heading === undefined || open === undefined || firstToggle === undefined) {
      throw new Error('見出し・登録を開く操作・行の操作のどれかが無い');
    }

    expect([precedes(heading, open), precedes(open, firstToggle)]).toEqual([true, true]);
    expect(operationAt(0)).toBe(open);
  });
});

/**
 * 見出しの行（B-60 設計 6章 規則12〜13）。
 *
 * **題 `冷蔵庫` と歯車の名前 `設定` は原本から取った文言であり、仮ではない**（ADR-074 決定1）。
 * 歯車を置くのは**一覧の側だけ**で、登録・編集の画面には置かない（原本に無い）。B-65b で一覧の側は
 * パネルを出している間も木に残るので、歯車も `inert` の中に残る。
 */
describe('在庫タブの中身の見出しの行', () => {
  it.each<[string, PantryTabProps['stockItems']]>([
    ['読み込み中', { outcome: 'loading' }],
    ['取れなかった', { outcome: 'failed' }],
    ['取れた', loaded(carrot)],
  ])('一覧を出している回は、一覧の結末によらず歯車を置く（%s）', (_label, stockItems) => {
    // B-60 規則12: 取れなかった回にも置く — どのタブからもログアウトに届く。
    render(pantryTab({ stockItems }));

    expect(settingsButtons()).toHaveLength(1);
  });

  it('一覧の見出しは「冷蔵庫」である', () => {
    // B-60 規則13（原本 `PantryScreen`）。1つの一覧に `h1` は1つ。
    render(pantryTab());

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['冷蔵庫']);
  });

  it('歯車を押すと、設定を開く求めが届く', () => {
    // B-60 規則12 / ADR-066: 設定を開いているかは門が持ち、画面は押下を口で渡すだけである。
    const openedSettings: string[] = [];
    render(pantryTab({ onOpenSettings: () => openedSettings.push('settings') }));

    fireEvent.click(screen.getByRole('button', { name: '設定' }));

    expect(openedSettings).toEqual(['settings']);
  });

  it('見出しの行は在庫の一覧より前にあり、その中は見出し・登録を開く操作・歯車の順である', () => {
    // B-60 規則12（原本: 見出しは一覧の先頭）。B-64 規則2 で登録を開く操作が見出しの行に入り、
    // 原本 `PantryScreen` の並び（`+` の右に歯車）に揃えた。
    render(pantryTab());

    const heading = screen.getByRole('heading', { level: 1, name: '冷蔵庫' });
    const gear = screen.getByRole('button', { name: '設定' });
    const openRegister = operationAt(0);
    const [firstRow] = screen.getAllByRole('listitem');
    if (firstRow === undefined) throw new Error('行が無い');

    expect([precedes(heading, openRegister), precedes(openRegister, gear)]).toEqual([true, true]);
    for (const headerPart of [heading, gear]) {
      expect(precedes(headerPart, firstRow)).toBe(true);
    }
  });

  it('登録の画面を開いても、歯車は `inert` の中に残る', () => {
    // B-65b 規則1・3 / B-60 規則12 の読み替え: パネルに歯車は無いが、一覧の側の歯車は木に残る。
    render(pantryTab());

    openRegister();

    expect(insideInert(soleGear())).toBe(true);
  });

  it('編集の画面を開いても、歯車は `inert` の中に残る', () => {
    // B-65b 規則1・3 / B-60 規則12 の読み替え。
    render(pantryTab());

    tapRowAt(0, 1);

    expect(insideInert(soleGear())).toBe(true);
  });
});

/**
 * 編集の画面へ基準日を渡すこと（B-65 設計 4章 / 5章 / 6章 規則8 / NFR-17）。
 *
 * 残日数の文字は ADR-074 で確定した（`docs/design/` の原本 ★11）ので literal で書く。
 * **一覧の行も残日数を出し、B-65b からは編集の間も木に残る**ので、`inert` の外にあるもの
 * （パネルの側）だけを数える。
 */
describe('在庫タブの中身と編集の基準日', () => {
  it('編集の画面を開くと、パネルに在庫タブが受け取った基準日で数えた残日数が出る', () => {
    renderWithUpdate({}, { stockItems: loaded({ ...carrot, expiryDate: '2026-09-22' }) });

    tapRowAt(0, 1);

    // B-65 規則8 / 4章: 基準日 2026-09-20 は `PantryTab` から編集の画面へ渡る。
    const outsideInert = screen
      .queryAllByText('あと2日')
      .filter((element) => !insideInert(element));
    expect(outsideInert).toHaveLength(1);
  });
});

/**
 * パネルを閉じたときの焦点（B-65b 設計 6章 規則6〜9 / 7章 / B-69 規則13 の先行）。
 *
 * 焦点は `document.activeElement` で見る（先例 `PantryList.test.tsx`）。**`inert` を外してから
 * 焦点を移す順序は、jsdom では `inert` の中にも焦点が乗るので観られない**（書かない）。
 *
 * 編集の観点は2行の一覧で、**名称で選んだ行**の `…`（名前 `操作`）へ戻るかを見る — 位置で引くと、
 * 一覧の並べ方を変えただけで赤くなる。
 */

/** その名称の行の `…`（名前 `操作`。B-64 規則6）。 */
function rowToggleOf(name: string): HTMLElement {
  return within(rowOf(name)).getByRole('button', { name: '操作', hidden: true });
}

/** 一覧に出ている `…` をすべて。 */
function allRowToggles(): HTMLElement[] {
  return screen.queryAllByRole('button', { name: '操作', hidden: true });
}

/** `食材を追加` をすべて（`inert` の中にあっても引く）。 */
function openRegisterButtons(): HTMLElement[] {
  return screen.queryAllByRole('button', { name: '食材を追加', hidden: true });
}

/** 2行の一覧を描く（豚こま肉・白菜）。 */
function renderTwoRows(options: FixedStockItemRequestsOptions = {}) {
  return renderWithUpdate(options, { stockItems: loaded(porkWithAmount, cabbageWithAmount) });
}

describe('在庫タブの中身のパネルを閉じたときの焦点', () => {
  it('登録を開いた直後は食材名の欄に焦点がある', () => {
    render(pantryTab());

    openRegister();

    // B-65b 規則6 / B-39 規則13。
    expect(document.activeElement).toBe(ingredientNameField());
  });

  it('編集を開いた直後は分量の欄に焦点がある', () => {
    renderTwoRows();

    tapRow(rowOf(cabbageWithAmount.name));

    // B-65b 規則6 / B-55。
    expect(document.activeElement).toBe(editAmountField());
  });

  it('登録を `戻る` で閉じると、焦点は `食材を追加` へ戻る', () => {
    render(pantryTab());

    openRegister();
    fireEvent.click(backButton());

    // B-65b 規則7 / B-69 規則13: キーボードの利用者が元の場所を見失わない。
    expect(document.activeElement).toBe(soleOpenRegister());
  });

  it('登録を `閉じる` で閉じると、焦点は `食材を追加` へ戻る', () => {
    render(pantryTab());

    openRegister();
    fireEvent.click(closeButton());

    // B-65b 規則7・9: 閉じ方を問わない。
    expect(document.activeElement).toBe(soleOpenRegister());
  });

  it('「保存して閉じる」が通ると、焦点は `食材を追加` へ戻る', async () => {
    const registrations: RegisterStockItemInput[] = [];
    render(
      pantryTab({
        stockItems: loaded(chineseCabbage),
        onRegister: recordingRegister(registrations, { outcome: 'registered' }),
      }),
    );

    openRegister();
    fillRegisterFields();
    fireEvent.click(saveAndClose());

    await waitFor(() => {
      expect(comboboxes()).toHaveLength(0);
    });

    // B-65b 規則7。
    expect(document.activeElement).toBe(soleOpenRegister());
  });

  it('「保存してもう1件」が通っても、焦点は `食材を追加` へ移らない', async () => {
    const registrations: RegisterStockItemInput[] = [];
    render(
      pantryTab({
        stockItems: loaded(chineseCabbage),
        onRegister: recordingRegister(registrations, { outcome: 'registered' }),
      }),
    );

    openRegister();
    fillRegisterFields();
    fireEvent.click(saveAndStay());

    await waitFor(() => {
      expect(screen.queryByDisplayValue('にんじん')).toBeNull();
    });

    // B-65b 規則8 / B-39 規則9: 閉じないので焦点を戻さない。
    expect(openRegisterButtons()).not.toContain(document.activeElement);
  });

  it('登録が断られた回は、焦点を `食材を追加` へ移さない', async () => {
    const registrations: RegisterStockItemInput[] = [];
    render(
      pantryTab({
        onRegister: recordingRegister(registrations, { outcome: 'rejected', rule: 'name.empty' }),
      }),
    );

    openRegister();
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(saveAndClose());

    await waitFor(() => {
      expect(registrations).toHaveLength(1);
    });

    // B-65b 7章1行目: 断られた回は閉じず、焦点も戻さない。
    expect(openRegisterButtons()).not.toContain(document.activeElement);
  });

  it('タップで開いた編集を `戻る` で閉じると、焦点はその行の `…` へ戻る', () => {
    renderTwoRows();

    tapRow(rowOf(cabbageWithAmount.name));
    fireEvent.click(backButton());

    // B-65b 規則7 / 10章 前提2: タップで開いた回も `…` に戻す。
    expect(document.activeElement).toBe(rowToggleOf(cabbageWithAmount.name));
  });

  it('行の `…` の `編集` から開いた編集を閉じると、焦点はその行の `…` へ戻る', () => {
    renderTwoRows();

    fireEvent.click(rowToggleOf(cabbageWithAmount.name));
    fireEvent.click(screen.getByRole('button', { name: '編集' }));
    fireEvent.click(backButton());

    // B-65b 規則7。
    expect(document.activeElement).toBe(rowToggleOf(cabbageWithAmount.name));
  });

  it('編集を `閉じる` で閉じると、焦点はその行の `…` へ戻る', () => {
    renderTwoRows();

    tapRow(rowOf(cabbageWithAmount.name));
    fireEvent.click(closeButton());

    // B-65b 規則7・9。
    expect(document.activeElement).toBe(rowToggleOf(cabbageWithAmount.name));
  });

  it('更新が通って閉じると、焦点はその行の `…` へ戻る', async () => {
    renderTwoRows({ update: [{ outcome: 'updated' }] });

    tapRow(rowOf(cabbageWithAmount.name));
    fireEvent.click(saveEditOperation());

    await waitFor(() => {
      expect(textboxes()).toHaveLength(0);
    });

    // B-65b 規則7: 編集の `保存` が通った回も閉じ方の1つである。
    expect(document.activeElement).toBe(rowToggleOf(cabbageWithAmount.name));
  });

  it('更新が断られた回は、焦点を行の `…` へ移さない', async () => {
    const { requests } = renderTwoRows({
      update: [{ outcome: 'rejected', rule: 'expiryDate.format' }],
    });

    tapRow(rowOf(cabbageWithAmount.name));
    fireEvent.click(saveEditOperation());

    await waitFor(() => {
      expect(requests.receivedUpdates).toHaveLength(1);
    });

    // B-65b 7章1行目 / ADR-050 結果5: 閉じないので焦点も戻さない。
    expect(allRowToggles()).not.toContain(document.activeElement);
  });

  it('同じ行の編集を2度開いて閉じても、2度目も焦点はその行の `…` へ戻る', () => {
    renderTwoRows();

    tapRow(rowOf(cabbageWithAmount.name));
    fireEvent.click(backButton());
    // 1度目の戻しのあと、焦点を別の行の `…` へ移しておく。
    act(() => {
      rowToggleOf(porkWithAmount.name).focus();
    });
    tapRow(rowOf(cabbageWithAmount.name));
    fireEvent.click(backButton());

    // B-65b 規則7 / 10章 前提5: 同じ行を2度戻せる（求めの参照が変わるたびに移す）。
    expect(document.activeElement).toBe(rowToggleOf(cabbageWithAmount.name));
  });

  it('編集していた行が取り直しで消えたあとに閉じると、焦点はどの行の `…` にも移らない', () => {
    const { requests, rendered } = renderTwoRows();

    tapRow(rowOf(cabbageWithAmount.name));
    rendered.rerender(
      pantryTab({ onUpdate: requests.updateStockItem, stockItems: loaded(porkWithAmount) }),
    );

    // B-65b 7章2行目 / B-69 規則13: 戻す先の行が無ければ移さない。投げない。
    expect(() => {
      fireEvent.click(backButton());
    }).not.toThrow();
    expect(allRowToggles()).not.toContain(document.activeElement);
  });
});
