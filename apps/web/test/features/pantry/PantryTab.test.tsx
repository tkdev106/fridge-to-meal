// @vitest-environment jsdom
/**
 * 在庫タブの中身 `PantryTab` の**一覧と登録の入れ替わり**（B-39 設計 6章 規則1〜7・14〜16 /
 * 7章 / ADR-052 / `docs/testing.md` 4.1）。
 *
 * 一覧そのものの見せ方は `PantryList.test.tsx`、登録の入力の扱いは `StockItemFormValues.test.ts`
 * と `RegisterFailureNotice.test.ts` が既に押さえている。ここで確かめるのは**切り出せないもの**
 * だけ — いまどちらの画面を出しているか、操作でどちらへ移るか、移っても残らないものである。
 *
 * **仮の文言と記号を期待値に書かない**（ADR-052 結果2 / `docs/testing.md` 4.1）。「＋」「←」も
 * 保存の名札も見出しも未確定であり（`docs/screen-design.md` 論点3 / B-39 設計 規則15）、留めると
 * **文言を変えただけで赤くなる**。観察は次の3つだけで行う。
 *
 * - **一覧が出ている** … **テストが渡した在庫品の名称**を `queryByText` で引く
 * - **登録の画面が出ている** … `queryAllByRole('textbox')` が1つ以上（一覧は `textbox` を
 *   1つも描かない。期限の欄は `type="date"` なのでこの役割に入らず、欄は [食材名, 分量] の2つ）
 * - **操作** … `getAllByRole('button')` を**文書順の位置**で引く。一覧では1つ（＝登録を開く）、
 *   登録の画面では先頭が閉じる操作・末尾が保存である
 *
 * **閉じたことを「渡した関数が呼ばれた回数」で観ない**（`docs/testing.md` 2章 / B-39 設計 8章）。
 * 送っていないことも、`vi.fn()` ではなく**テストが持つ配列の中身**で見る。
 */

import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { RegisterStockItemInput, StockItemDto } from '@fridge-to-meal/contract';
import { fireEvent, render, screen, waitFor } from '../../support/dom/renderComponent.js';
import type { PantryTabProps } from '../../../src/features/pantry/PantryTab.js';
import { PantryTab } from '../../../src/features/pantry/PantryTab.js';
import type { TabId } from '../../../src/navigation/Tabs.js';
import { DEFAULT_TAB, TAB_ORDER } from '../../../src/navigation/Tabs.js';
import { TabbedScreen } from '../../../src/navigation/TabbedScreen.js';
import type {
  DeleteStockItem,
  RegisterStockItem,
  RegisterStockItemOutcome,
} from '../../../src/server/StockItemRequests.js';

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
      ingredientNames={{ outcome: 'loading' }}
      {...overrides}
    />
  );
}

/**
 * 押せる操作を**文書順の位置**で引く（負の位置は末尾から数える）。
 *
 * **下タブは混ざらない。** 帯のタブは `role="tab"` を明示しており、この問い合わせに
 * 引っかからない（`TabbedScreen.tsx` / 2026-09-21 に実物で確認）。
 */
function operationAt(index: number): HTMLElement {
  const found = screen.getAllByRole('button').at(index);
  if (found === undefined) throw new Error(`${index} 番目の操作が無い`);

  return found;
}

/**
 * 食材名の欄。**補完の `list` を持つため役割は `combobox` である**（B-50c）— 補完が0件の
 * 回も欄はこの役割のままである。
 *
 * **`instanceof HTMLInputElement` で絞らない** — 役割で引いている以上、入力の欄であることは
 * 問い合わせの側が保証している。**DOM の形を辿らない**（ADR-052 結果3）。
 */
function ingredientNameField(): HTMLInputElement {
  return screen.getByRole('combobox') as HTMLInputElement;
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

    fireEvent.click(operationAt(0));

    // 規則3 / FR-01: 一覧の側に登録を開く操作を1つ置く。**記号も名札も見ない**（規則15）。
    expect(screen.queryAllByRole('textbox').length).toBeGreaterThan(0);
  });

  it('登録を開くと、一覧に出ていた在庫品は描かれなくなる', () => {
    render(pantryTab());

    fireEvent.click(operationAt(0));

    // 規則1: **入れ替わりであって、足し算ではない**（先行 `TabbedScreen.test.tsx` と同じ構え）。
    expect(screen.queryByText(carrot.name)).toBeNull();
  });

  it('一覧のときに押せる操作は、登録を開くもの1つだけである', () => {
    render(pantryTab({ stockItems: loaded(carrot, chineseCabbage) }));

    // 規則3: 置くのは1つである。行に削除の操作は無く（削除はスワイプ。B-23）、
    // ログアウトは門の側に残る（規則16 / ADR-046 結果4）。
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('登録から閉じる操作を押すと、一覧へ戻る', () => {
    render(pantryTab());

    fireEvent.click(operationAt(0));
    // 規則7: 保存せずに閉じる手段を1つ置く。登録の画面では**先頭**がそれである。
    fireEvent.click(operationAt(0));

    expect(screen.queryByText(carrot.name)).not.toBeNull();
  });

  it('閉じてから開き直すと、打ちかけの食材名は残っていない', () => {
    render(pantryTab());

    fireEvent.click(operationAt(0));
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(operationAt(0));
    fireEvent.click(operationAt(0));

    // 規則7: 入力は捨てる。下書きを保存しない。
    expect(ingredientNameField().value).toBe('');
  });

  it('保存せずに閉じる操作は、登録を送らない', () => {
    const registrations: RegisterStockItemInput[] = [];
    render(pantryTab({ onRegister: recordingRegister(registrations, { outcome: 'registered' }) }));

    fireEvent.click(operationAt(0));
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(operationAt(0));

    // 規則7 / ADR-007: 閉じるのは捨てることである。**送った中身を配列で見る。**
    expect(registrations).toEqual([]);
  });

  it('一覧が取れなかったときも登録を開ける', () => {
    render(pantryTab({ stockItems: { outcome: 'failed' } }));

    fireEvent.click(operationAt(0));

    // 7章3行目 / 規則3: 一覧が取れない断りは登録の画面に及ばない（B-22 / B-23）。
    expect(screen.queryAllByRole('textbox').length).toBeGreaterThan(0);
  });

  it('登録が断られても登録の画面のままで、一覧へ戻らない', async () => {
    const registrations: RegisterStockItemInput[] = [];
    render(
      pantryTab({
        onRegister: recordingRegister(registrations, { outcome: 'rejected', rule: 'name.empty' }),
      }),
    );

    fireEvent.click(operationAt(0));
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    // 登録の画面では**末尾**が保存である。
    fireEvent.click(operationAt(-1));

    // 結末は非同期に届くので、送られたことを待ってから画面を見る。**待つ手がかりは案内の
    // 文言ではなくテストが記録した配列である** — 文言は仮である（規則15）。
    await waitFor(() => {
      expect(registrations).toHaveLength(1);
    });

    // 7章1行目 / NFR-15 / ADR-032 決定3: 断られた回は閉じない。入力を残して案内を出す。
    expect(screen.queryAllByRole('textbox').length).toBeGreaterThan(0);
    expect(screen.queryByText(carrot.name)).toBeNull();
  });

  it('一覧の結末が入れ替わっても、開いている登録の画面は閉じない', () => {
    const { rerender } = render(pantryTab());

    fireEvent.click(operationAt(0));
    rerender(pantryTab({ stockItems: loaded(chineseCabbage) }));

    // 規則4 / B-22 設計 規則10: 出し分けの状態は中身が持つ。門が一覧を取り直しても閉じない。
    expect(screen.queryAllByRole('textbox').length).toBeGreaterThan(0);
    expect(screen.queryByText(chineseCabbage.name)).toBeNull();
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
    fireEvent.click(operationAt(0));

    // 規則5 / NFR-14: 帯は下位の画面でも隠さない。隠すには器か門が「在庫タブが下位の画面に
    // 居る」ことを知る必要があり、規則4（状態は中身が持つ）と衝突する。
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('別のタブへ移って在庫タブへ戻ると、一覧が出ている', () => {
    tabbedPantryTab();

    fireEvent.click(tabFor('pantry'));
    fireEvent.click(operationAt(0));
    fireEvent.click(tabFor('meals'));
    fireEvent.click(tabFor('pantry'));

    // 規則6 / B-38 設計 6章 規則6: 選んだタブの中身だけを木に置くことの帰結である。
    expect(screen.queryByText(carrot.name)).not.toBeNull();
  });

  it('別のタブを挟むと、打ちかけの食材名は残らない', () => {
    tabbedPantryTab();

    fireEvent.click(tabFor('pantry'));
    fireEvent.click(operationAt(0));
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(tabFor('meals'));
    fireEvent.click(tabFor('pantry'));
    fireEvent.click(operationAt(0));

    // 規則6: 打ちかけの入力も消える。この周で器を変えてまで残さない。
    expect(ingredientNameField().value).toBe('');
  });
});

/**
 * 2つの保存を押したときに、**どちらの画面が出ているか**（B-39 設計 6章 規則8〜12 / 7章）。
 *
 * **閉じたことを「渡した関数が呼ばれた回数」で観ない**（`docs/testing.md` 2章 / 設計 8章）—
 * `PantryTab` 越しに「一覧が出ている／出ていない」で観る。入力が残るかどうかは登録の画面の
 * 持ち分であり、`StockItemForm.test.tsx` にある。
 *
 * 一覧に置く標本は**白菜1件だけ**にし、登録の欄には別の名称を打つ。同じ名称を使うと、
 * 「一覧が出ている」のか「打った値が残っている」のかを取り違える。
 */

/**
 * 分量の欄。**`textbox` はこれ1つだけである** — 食材名は `combobox`（B-50c）、期限は
 * `type="date"` なので、どちらもこの役割に入らない。
 */
function amountField(): HTMLInputElement {
  const field = screen.getAllByRole('textbox')[0];
  if (field === undefined) throw new Error('分量の欄が無い');

  return field as HTMLInputElement;
}

/**
 * 期限の欄。**この観点で唯一もろい引き方である。**
 *
 * `input[type="date"]` は ARIA の役割に写らないため `textbox` で引けず、ラベルの文言は仮である
 * （規則15）。そこで**値が空の入力が1つだけになった状態**で引く — 食材名と分量を先に埋めて
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
 * 保存の操作を**文書順**で返す（規則8）。
 *
 * 登録の画面の押せる操作は3つで、**先頭が閉じる操作**（規則7）、後ろ2つが保存である。
 * **この数を先に確かめる** — 崩れた回に閉じる操作を保存として押してしまうと、テストは
 * 「一覧へ戻らない」ではなく別の理由で落ち、何が壊れたか読めなくなる。**名札は見ない**（規則15）。
 */
function saveOperations(): readonly HTMLElement[] {
  const operations = screen.getAllByRole('button');
  expect(operations).toHaveLength(3);

  return operations.slice(1);
}

function saveOperationAt(index: number): HTMLElement {
  const found = saveOperations().at(index);
  if (found === undefined) throw new Error(`${index} 番目の保存の操作が無い`);

  return found;
}

/** 「保存してもう1件」。前に出すほうである（規則8）。 */
function saveAndStay(): HTMLElement {
  return saveOperationAt(0);
}

/** 「保存して閉じる」。文書順の最後である（規則8）。 */
function saveAndClose(): HTMLElement {
  return saveOperationAt(1);
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

    fireEvent.click(operationAt(0));
    fillRegisterFields();
    fireEvent.click(saveAndClose());

    // 規則9 / `docs/screen-design.md` 6章: 通ったら一覧へ戻る。**待つ手がかりはテストが渡した
    // 在庫品の名称である**（仮の文言を使わない。規則15）。
    expect(await screen.findByText(chineseCabbage.name)).not.toBeNull();
  });

  it('送っている間は閉じる操作も効かない', async () => {
    // 結末を保留できる口。押した時点ではまだ返さない。
    let settle: (outcome: RegisterStockItemOutcome) => void = () => undefined;
    const pendingRegister: RegisterStockItem = () =>
      new Promise<RegisterStockItemOutcome>((resolve) => {
        settle = resolve;
      });

    render(pantryTab({ stockItems: loaded(chineseCabbage), onRegister: pendingRegister }));

    fireEvent.click(operationAt(0));
    fillRegisterFields();
    fireEvent.click(saveAndStay());

    // 送っている間に閉じようとする。`onClose` は onClick で**同期に**呼ばれるので、効いて
    // しまえばこの時点で一覧が出る。
    fireEvent.click(operationAt(0));

    // 規則10 / 規則11: **送っている間に閉じられてはいけない。** 閉じると、断りの案内が出ない
    // まま画面が消え、打った入力も捨てられる — 利用者は保存できたと思い込む。結末が届く前に
    // 画面を捨てることは、規則10 が守ろうとしているものをこの経路だけ抜けさせる。
    expect(screen.queryByText(chineseCabbage.name)).toBeNull();

    settle({ outcome: 'failed' });

    // 結末が届いたあとも登録の画面のままである（`saveOperations` が3つを確かめる）。
    await waitFor(() => {
      expect(saveOperations()).toHaveLength(2);
    });
    expect(screen.queryByText(chineseCabbage.name)).toBeNull();
  });

  it('「保存してもう1件」が通っても一覧へ戻らない', async () => {
    const registrations: RegisterStockItemInput[] = [];
    render(
      pantryTab({
        stockItems: loaded(chineseCabbage),
        onRegister: recordingRegister(registrations, { outcome: 'registered' }),
      }),
    );

    fireEvent.click(operationAt(0));
    fillRegisterFields();
    fireEvent.click(saveAndStay());

    // 欄が空に戻ったことを待ってから断定する — 結末は非同期に届くので、押した直後の木を
    // 見ると「まだ戻っていない」だけの状態を通してしまう。
    await waitFor(() => {
      expect(screen.queryByDisplayValue('にんじん')).toBeNull();
    });

    // 規則9 / FR-08: こちらは登録の画面に留まり、続けてもう1件入れられる。
    expect(screen.queryByText(chineseCabbage.name)).toBeNull();
  });

  it('登録が失敗したときは一覧へ戻らない', async () => {
    const registrations: RegisterStockItemInput[] = [];
    render(
      pantryTab({
        stockItems: loaded(chineseCabbage),
        onRegister: recordingRegister(registrations, { outcome: 'failed' }),
      }),
    );

    fireEvent.click(operationAt(0));
    fillRegisterFields();
    fireEvent.click(saveAndClose());

    await waitFor(() => {
      expect(registrations).toHaveLength(1);
    });

    // 規則10 / 7章 行2 / ADR-007: 失敗した回は閉じない。自動で送り直さないので、
    // 送り直せる画面を残す必要がある。
    expect(screen.queryByText(chineseCabbage.name)).toBeNull();
  });

  it('食材名が空のまま「保存して閉じる」を押しても一覧へ戻らない', () => {
    const registrations: RegisterStockItemInput[] = [];
    render(
      pantryTab({
        stockItems: loaded(chineseCabbage),
        onRegister: recordingRegister(registrations, { outcome: 'registered' }),
      }),
    );

    fireEvent.click(operationAt(0));
    // 分量だけを埋める。食材名が空のままでは登録の入力が作れない（B-12 設計 規則2）。
    fireEvent.change(amountField(), { target: { value: '2本' } });
    fireEvent.click(saveAndClose());

    // 規則11: 効かない操作で画面が移らない。送っていないので待つものも無い。
    expect(screen.queryByText(chineseCabbage.name)).toBeNull();
  });

  it('保存して閉じたあとの一覧に、いま登録した食材名は出ない', async () => {
    const registrations: RegisterStockItemInput[] = [];
    render(
      pantryTab({
        stockItems: loaded(chineseCabbage),
        onRegister: recordingRegister(registrations, { outcome: 'registered' }),
      }),
    );

    fireEvent.click(operationAt(0));
    fillRegisterFields();
    fireEvent.click(saveAndClose());

    await screen.findByText(chineseCabbage.name);

    // 規則12 / B-22 設計 規則3 / B-24: 登録が通ったときに一覧を取り直すのは**門**である。
    // 中身の側で列に足すと、並び（期限の近い順）を web が握り直すことになる。
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('にんじん')).toBeNull();
  });
});
