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
import type { RegisterStockItemInput, StockItemDto } from '@fridge-to-meal/contract';
import { fireEvent, render, screen, waitFor } from '../../support/dom/renderComponent.js';
import type { PantryTabProps } from '../../../src/features/pantry/PantryTab.js';
import { PantryTab } from '../../../src/features/pantry/PantryTab.js';
import type { TabId } from '../../../src/navigation/Tabs.js';
import { TAB_ORDER } from '../../../src/navigation/Tabs.js';
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
 * 食材名の欄。登録の画面の `textbox` の先頭である（期限は `type="date"` で入らない）。
 *
 * **`instanceof HTMLInputElement` で絞らない** — 大域名を実行時に読むと、`tsc --build` が
 * `dist-test/` へ出した `.js` の側で `no-undef` に当たる（あちらには browser の大域が
 * 与えられていない）。役割で引いている以上、入力の欄であることは問い合わせが保証している。
 */
function ingredientNameField(): HTMLInputElement {
  const [field] = screen.getAllByRole('textbox');
  if (field === undefined) throw new Error('食材名の欄が無い');

  return field as HTMLInputElement;
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

function tabbedPantryTab(overrides: Partial<PantryTabProps> = {}) {
  render(
    <TabbedScreen
      meals={otherContents.meals}
      pantry={pantryTab(overrides)}
      history={otherContents.history}
    />,
  );
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

    fireEvent.click(operationAt(0));

    // 規則5 / NFR-14: 帯は下位の画面でも隠さない。隠すには器か門が「在庫タブが下位の画面に
    // 居る」ことを知る必要があり、規則4（状態は中身が持つ）と衝突する。
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('別のタブへ移って在庫タブへ戻ると、一覧が出ている', () => {
    tabbedPantryTab();

    fireEvent.click(operationAt(0));
    fireEvent.click(tabFor('meals'));
    fireEvent.click(tabFor('pantry'));

    // 規則6 / B-38 設計 6章 規則6: 選んだタブの中身だけを木に置くことの帰結である。
    expect(screen.queryByText(carrot.name)).not.toBeNull();
  });

  it('別のタブを挟むと、打ちかけの食材名は残らない', () => {
    tabbedPantryTab();

    fireEvent.click(operationAt(0));
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(tabFor('meals'));
    fireEvent.click(tabFor('pantry'));
    fireEvent.click(operationAt(0));

    // 規則6: 打ちかけの入力も消える。この周で器を変えてまで残さない。
    expect(ingredientNameField().value).toBe('');
  });
});
