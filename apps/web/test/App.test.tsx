// @vitest-environment jsdom
/**
 * 門 `App`（B-40 設計 6章 規則1〜14 / 7章 / ADR-052 / `docs/testing.md` 4.1）。
 *
 * 門が持つ判断は**3つだけ**である（設計 規則9）— セッションの3値の出し分け、在庫を取りに行く
 * 条件、そして取り直す条件。子の中の判断（一覧の見せ方・登録の入力の扱い・タブの切り替え・
 * 断りから案内を選ぶこと）は `PantryList.test.tsx` / `PantryTab.test.tsx` /
 * `StockItemForm.test.tsx` / `TabbedScreen.test.tsx` / `RegisterFailureNotice.test.ts` /
 * `DeleteFailureNotice.test.ts` が既に押さえており、**ここで二重に書かない。**
 *
 * **仮の文言と記号を期待値に書かない**（ADR-052 結果2 / 設計 規則2）。観察は次の4つだけで行う
 * （設計 規則3・12）。
 *
 * - **セッションの3値** … `'unknown'`＝`tab` も `textbox` も0、`'signedOut'`＝`tab` 0 かつ
 *   `textbox` 1、`'signedIn'`＝`tab` 3
 * - **在庫品** … **テストが渡した名称**を `queryByText` / `findByText` で引く。**取り直したか
 *   どうかの検めは画面である**（設計 規則6）— 一覧の台本の2件目が出れば取り直している
 * - **件数の断定** … `listCount` を観るのは「取りに行かないこと」の1件だけ（同 規則6）
 * - **操作** … `getAllByRole('button')` を**文書順の位置**で引き、**先に件数を確かめる**
 *
 * **`vi.fn()` で呼び出し回数を数えない**（`docs/testing.md` 2章 / 設計 規則5）。差し替えは
 * `FixedSession` と `FixedStockItemRequests` である。**素で描く**（`<StrictMode>` を被せない。
 * 設計 規則13）。
 */

import { describe, expect, it } from 'vitest';
import type { StockItemDto } from '@fridge-to-meal/contract';
import { act, fireEvent, render, screen, waitFor } from './support/dom/renderComponent.js';
import { installPointerCapture } from './support/dom/pointerCapture.js';
import { FixedSession } from './support/session/FixedSession.js';
import type { FixedSessionOptions } from './support/session/FixedSession.js';
import { FixedStockItemRequests } from './support/server/FixedStockItemRequests.js';
import type { FixedStockItemRequestsOptions } from './support/server/FixedStockItemRequests.js';
import { FixedSuggestionRequests } from './support/server/FixedSuggestionRequests.js';
import type { FixedSuggestionRequestsOptions } from './support/server/FixedSuggestionRequests.js';
import { FixedIngredientNameRequests } from './support/server/FixedIngredientNameRequests.js';
import type { FixedIngredientNameRequestsOptions } from './support/server/FixedIngredientNameRequests.js';
import { App } from '../src/App.js';
import type { SessionState } from '../src/session/Session.js';
import type { StockItemsOutcome } from '../src/server/StockItemRequests.js';
import type {
  LatestSuggestionOutcome,
  RequestNewMealsOutcome,
} from '../src/server/SuggestionRequests.js';

// 行をなぞる経路は jsdom に無いメソッドを通る（`support/dom/pointerCapture.ts`）。
// **本体の振る舞いではなく、道具の欠けを道具の側で埋めるものである。**
installPointerCapture();

function stockItemOf(name: string, id: string): StockItemDto {
  return { id, name, ingredientId: null, amount: null, expiryDate: null };
}

/** 一覧に出ていることを観るための標本。**当てるのはこの名称だけである**（設計 規則6）。 */
const carrot = stockItemOf('にんじん', '1');
/** **取り直したこと**を観るための、2件目の台本に置く標本。 */
const chineseCabbage = stockItemOf('白菜', '2');

function loaded(...stockItems: readonly StockItemDto[]): StockItemsOutcome {
  return { outcome: 'loaded', stockItems };
}

function renderApp(
  sessionOptions: FixedSessionOptions = {},
  requestOptions: FixedStockItemRequestsOptions = {},
  suggestionOptions: FixedSuggestionRequestsOptions = {},
  ingredientNameOptions: FixedIngredientNameRequestsOptions = {},
) {
  const session = new FixedSession(sessionOptions);
  const requests = new FixedStockItemRequests(requestOptions);
  // **既定は「まだ提案が無い」を1度だけ配る**（S-8）。門はサインイン済みになると必ず
  // 取りに行くので（ADR-065 決定1）、提案が本題でない観点でも台本が1つ要る。
  const suggestions = new FixedSuggestionRequests({
    show: [{ outcome: 'none' }],
    ...suggestionOptions,
  });

  // **既定は「取れなかった」を配る**（B-50c 設計 規則4）。門はサインイン済みになると必ず
  // 取りに行くので、補完が本題でない観点でも台本が1つ要る。**取れなくても登録は止まらない。**
  const ingredientNames = new FixedIngredientNameRequests({
    list: [{ outcome: 'failed' }],
    ...ingredientNameOptions,
  });

  render(
    <App
      session={session}
      listStockItems={requests.listStockItems}
      registerStockItem={requests.registerStockItem}
      deleteStockItem={requests.deleteStockItem}
      updateStockItem={requests.updateStockItem}
      showLatestSuggestion={suggestions.showLatestSuggestion}
      requestNewMeals={suggestions.requestNewMeals}
      listIngredientNames={ingredientNames.listIngredientNames}
    />,
  );

  return { session, requests, suggestions, ingredientNames };
}

/**
 * 状態の変化を配る（保存されたセッションの復元とサインアウトの再現）。
 *
 * **`act` で包む**（`support/dom/renderComponent.ts`）— 操作から始まらない更新なので、
 * 包まないと React が警告し、テストは描き直される前の木を見る。
 */
function emit(session: FixedSession, state: SessionState): void {
  act(() => {
    session.emit(state);
  });
}

/** 保留していた結末を解き、届いた更新を `act` の中で起こす（設計 規則7）。 */
async function settle(requests: FixedStockItemRequests): Promise<void> {
  await act(async () => {
    requests.settle();
  });
}

/** 提案の側（`FixedSuggestionRequests`）の保留を解く。上と同じ理由。 */
async function settleSuggestions(suggestions: FixedSuggestionRequests): Promise<void> {
  await act(async () => {
    suggestions.settle();
  });
}

/** 下タブ。3つ出ていればサインイン済みの画面である（設計 規則12）。 */
function tabs(): readonly HTMLElement[] {
  return screen.queryAllByRole('tab');
}

/** 入力の欄。1つだけ出ていればログインの画面である（設計 規則12）。 */
function textboxes(): readonly HTMLElement[] {
  return screen.queryAllByRole('textbox');
}

/**
 * 出ている案内。**数だけを見る**（設計 規則11）。
 *
 * **もろい引き方である。** 画面全体の `paragraph` を数えるため、**器が「選んだタブの中身だけを
 * 描く」ことに暗に頼っている**（`TabbedScreen.tsx` / B-38 設計 6章 規則6）— 献立タブと履歴タブも
 * 仮置きの `<p>` を持つので、3つとも描く形に変わると数が狂う。`passwordField` と同じ性質の
 * もろさなので、崩れた回に理由が読めるようここに書き残す。
 */
function notices(): readonly HTMLElement[] {
  return screen.queryAllByRole('paragraph');
}

/**
 * 押せる操作を**文書順**で引く。**先に件数を確かめる**（設計 7章 行2）— 崩れた回に別の操作を
 * 押してしまうと、テストは何が壊れたか読めない形で落ちる。**名札は見ない**（設計 規則2）。
 *
 * **下タブは混ざらない。** 帯のタブは `role="tab"` を明示しており、この問い合わせに
 * 引っかからない（先行 `PantryTab.test.tsx`）。
 */
function operationAt(index: number, expectedCount: number): HTMLElement {
  const operations = screen.getAllByRole('button');
  expect(operations).toHaveLength(expectedCount);

  const found = operations.at(index);
  if (found === undefined) throw new Error(`${index} 番目の操作が無い`);

  return found;
}

/** 在庫の一覧に出ている操作は2つ（登録を開く／ログアウト）である。 */
const LIST_OPERATION_COUNT = 2;
/** 登録の画面に出ている操作は4つ（閉じる／保存2つ／ログアウト）である。 */
const REGISTER_OPERATION_COUNT = 4;

function openRegisterOperation(): HTMLElement {
  return operationAt(0, LIST_OPERATION_COUNT);
}

function signOutOperation(): HTMLElement {
  return operationAt(1, LIST_OPERATION_COUNT);
}

function closeRegisterOperation(): HTMLElement {
  return operationAt(0, REGISTER_OPERATION_COUNT);
}

function saveAndCloseOperation(): HTMLElement {
  return operationAt(2, REGISTER_OPERATION_COUNT);
}

/**
 * 食材名の欄。**補完の `list` を持つため役割は `combobox` である**（B-50c）— 補完が0件の
 * 回も欄はこの役割のままである。
 */
function ingredientNameField(): HTMLElement {
  return screen.getByRole('combobox');
}

/** 一覧の1行。**削除はスワイプで届く**（FR-06 / B-23）ので、行そのものを引く。 */
function soleRow(): HTMLElement {
  const rows = screen.getAllByRole('listitem');
  if (rows.length !== 1) throw new Error('一覧に行が1つだけ出ている状態ではない');

  const [row] = rows;
  if (row === undefined) throw new Error('一覧に行が無い');

  return row;
}

/** 行を横になぞる。**判断は `SwipeGesture.ts` の持ち分**で、ここは入力を送るだけである。 */
function swipeSoleRow(): void {
  const row = soleRow();

  fireEvent.pointerDown(row, { pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(row, { pointerId: 1, clientX: 100, clientY: 0 });
}

/** 献立タブ。`TAB_ORDER` の先頭であり、**起動時に開かれている**（ADR-064 / `navigation/Tabs.ts`）。 */
function mealsTab(): HTMLElement {
  const [tab] = tabs();
  if (tab === undefined) throw new Error('献立タブが無い');

  return tab;
}

/** 在庫タブ。`TAB_ORDER` の2つめである。 */
function pantryTab(): HTMLElement {
  const tab = tabs().at(1);
  if (tab === undefined) throw new Error('在庫タブが無い');

  return tab;
}

/** 履歴タブ。`TAB_ORDER` の3つめである。 */
function historyTab(): HTMLElement {
  const tab = tabs().at(2);
  if (tab === undefined) throw new Error('履歴タブが無い');

  return tab;
}

/**
 * 在庫タブを開く。**起動時に開くのは献立タブである**（ADR-064）ため、在庫が本題の観点は
 * まずここを通る。器は選んだタブの中身しか描かない（B-38 設計 6章 規則6）。
 */
function openPantry(): void {
  fireEvent.click(pantryTab());
}

describe('門 App のセッションの出し分け', () => {
  it('セッションの状態が分かるまでは、入力の欄もタブも1つも出さない', () => {
    renderApp({ initialState: 'unknown' });

    // `Session.ts` 規則6 / ADR-046 結果4 / 設計 規則12: **`'unknown'` をログイン画面に倒さない** —
    // 倒すと、サインイン済みの利用者にログイン画面が一瞬見える。
    expect(tabs()).toHaveLength(0);
    expect(textboxes()).toHaveLength(0);
  });

  it('サインインしていないときはログインの画面を出す', () => {
    renderApp({ initialState: 'signedOut' });

    // ADR-046 決定2・結果4 / FR-25 / 設計 規則12。
    expect(tabs()).toHaveLength(0);
    expect(textboxes()).toHaveLength(1);
  });

  it('サインイン済みのときは下タブ3つの器を出す', async () => {
    renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] });

    // 取れた結末が届くまで待つ（待つ条件は**テストが渡した名称**である。設計 規則7）。
    openPantry();
    await screen.findByText(carrot.name);

    // B-38 / 要件 第7章 / 設計 規則12: 器を mount するのはこの枝だけである。
    expect(tabs()).toHaveLength(3);
  });

  it('セッションの復元が済んでサインイン済みになると、下タブ3つが出る', async () => {
    const { session } = renderApp({ initialState: 'unknown' }, { list: [loaded(carrot)] });

    expect(tabs()).toHaveLength(0);

    emit(session, 'signedIn');
    openPantry();
    await screen.findByText(carrot.name);

    // `Session.ts` 規則5・6: 購読の1度目で渡された状態のまま止まらず、変化を受けて切り替わる。
    expect(tabs()).toHaveLength(3);
  });

  it('サインアウトすると、ログインの画面へ戻る', async () => {
    const { session } = renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] });

    openPantry();
    await screen.findByText(carrot.name);
    emit(session, 'signedOut');

    // FR-25 / B-38 設計 規則9: 器ごと外れる（入り直すと既定のタブに戻る）。
    expect(tabs()).toHaveLength(0);
    expect(textboxes()).toHaveLength(1);
  });

  it('ログアウトの操作を押すと、ログインの画面へ戻る', async () => {
    renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] });

    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(signOutOperation());

    // FR-25 / ADR-046 結果4 / `Session.ts` 規則8: 手元のセッションは必ず捨てられ、門は
    // その変化を受けて画面を切り替える。**ログアウトを結線しているのは門である。**
    await waitFor(() => {
      expect(tabs()).toHaveLength(0);
    });
    expect(textboxes()).toHaveLength(1);
  });
});

describe('門 App が在庫を取りに行く条件', () => {
  it('サインインしていない間は、在庫一覧を取りに行かない', () => {
    const { requests } = renderApp({ initialState: 'signedOut' });

    // B-22 設計 規則10 / 設計 規則6: **件数を断定してよい唯一の行である** — 叩いても 401 が
    // 返るだけで、往復を1つ無駄にする。「起きないこと」は件数でしか観られない。
    expect(requests.listCount).toBe(0);
  });

  it('サインイン済みになると、サーバから取れた在庫品が一覧に出る', async () => {
    const { session } = renderApp({ initialState: 'unknown' }, { list: [loaded(carrot)] });

    emit(session, 'signedIn');

    // FR-04 / B-22 設計 規則10: 取りに行くのはサインイン済みのときだけ1度である。
    openPantry();
    expect(await screen.findByText(carrot.name)).not.toBeNull();
  });

  it('取りに行っている最中にサインアウトしても、ログインの画面へ戻る', async () => {
    const { session, requests } = renderApp(
      { initialState: 'signedIn' },
      { list: [{ heldUntilSettled: loaded(carrot) }] },
    );

    emit(session, 'signedOut');
    await settle(requests);

    // **この観点が見ているのは出し分けだけである**（設計 規則12）。サインアウトした枝では
    // 一覧そのものが描かれないため、**`App.tsx` の `active` の守りを外してもここは緑のまま**
    // になる — 規則10 を判別するのは次の観点のほうである。取り違えないよう書き分ける。
    expect(textboxes()).toHaveLength(1);
    expect(screen.queryByText(carrot.name)).toBeNull();
  });

  it('遅れて届いた古い取得は、後から取り直した一覧を上書きしない', async () => {
    const { session, requests } = renderApp(
      { initialState: 'signedIn' },
      { list: [{ heldUntilSettled: loaded(carrot) }, loaded(chineseCabbage)] },
    );

    // 1件目を取りに行ったまま、いったん出て入り直す。入り直した側の取得（台本の2件目）は
    // 保留が無いので先に届き、**古いほうが後から届く**形になる。
    emit(session, 'signedOut');
    emit(session, 'signedIn');
    openPantry();
    await screen.findByText(chineseCabbage.name);

    await settle(requests);

    // B-22 設計 規則10: **効果が解除されたら結果を捨てる。** 捨てないと、解除済みの取得が
    // 新しい一覧を上書きし、画面が古い在庫に戻る。**`active` の守りを外すとここが落ちる。**
    expect(screen.queryByText(carrot.name)).toBeNull();
    expect(screen.queryByText(chineseCabbage.name)).not.toBeNull();
  });
});

describe('門 App が在庫一覧を取り直す条件', () => {
  it('登録が通ると、一覧を取り直して新しい在庫品が出る', async () => {
    renderApp(
      { initialState: 'signedIn' },
      {
        list: [loaded(carrot), loaded(chineseCabbage)],
        register: [{ outcome: 'registered' }],
      },
    );

    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(openRegisterOperation());
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(saveAndCloseOperation());

    // FR-01 / FR-04 / B-24: **登録した在庫品を web で列に足さない** — 並び（期限の近い順）を
    // 決めるのはサーバであり、取り直した結果がそれである。
    expect(await screen.findByText(chineseCabbage.name)).not.toBeNull();
  });

  it('登録が断られた回は、一覧を取り直さない', async () => {
    renderApp(
      { initialState: 'signedIn' },
      {
        list: [loaded(carrot), loaded(chineseCabbage)],
        register: [{ outcome: 'rejected', rule: 'expiryDate.format' }],
      },
    );

    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(openRegisterOperation());
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(saveAndCloseOperation());

    // 断りが届いたことを待ってから閉じる（待つ条件に仮の文言を使わない。設計 規則7・11）。
    await waitFor(() => {
      expect(notices()).toHaveLength(1);
    });
    fireEvent.click(closeRegisterOperation());

    // B-24 / ADR-032 決定3: 在庫は1件も増えていないので、往復を1つ無駄にしない。
    expect(screen.queryByText(carrot.name)).not.toBeNull();
    expect(screen.queryByText(chineseCabbage.name)).toBeNull();
  });

  it('行を横になぞって消えたら、一覧を取り直す', async () => {
    renderApp(
      { initialState: 'signedIn' },
      {
        list: [loaded(carrot), loaded(chineseCabbage)],
        remove: [{ outcome: 'deleted' }],
      },
    );

    openPantry();
    await screen.findByText(carrot.name);
    swipeSoleRow();

    // FR-06 / ADR-050 決定3: **web で列から行を抜かない** — 取り直した結果が正である。
    expect(await screen.findByText(chineseCabbage.name)).not.toBeNull();
  });

  it('見つからないという断りも「すでに消えている」と読んで、一覧を取り直す', async () => {
    renderApp(
      { initialState: 'signedIn' },
      {
        list: [loaded(carrot), loaded(chineseCabbage)],
        remove: [{ outcome: 'rejected', rule: 'delete.notFound' }],
      },
    );

    openPantry();
    await screen.findByText(carrot.name);
    swipeSoleRow();

    // ADR-050 決定1・3: 利用者が求めたのは**その行が消えていること**である。
    // **取り直しはその読みの検めでもある** — 消えていなければ行がそのまま戻ってくる。
    expect(await screen.findByText(chineseCabbage.name)).not.toBeNull();
  });

  it('消せなかった回は、一覧を取り直さない', async () => {
    const { requests } = renderApp(
      { initialState: 'signedIn' },
      {
        list: [loaded(carrot), loaded(chineseCabbage)],
        remove: [{ outcome: 'failed' }],
      },
    );

    openPantry();
    await screen.findByText(carrot.name);
    swipeSoleRow();

    // 断りが届いたことを待つ（案内が出るのは `DeleteFailureNotice.ts` の読みの帰結である）。
    await waitFor(() => {
      expect(requests.deletedIds).toHaveLength(1);
      expect(notices()).toHaveLength(1);
    });

    // ADR-050 決定1 / FR-04: 一覧は変わっておらず、取り直すと往復を1つ無駄にするうえ、
    // その取得も失敗すれば断りが一覧全体の断りに置き換わってしまう。
    expect(screen.queryByText(carrot.name)).not.toBeNull();
    expect(screen.queryByText(chineseCabbage.name)).toBeNull();
  });
});

describe('門 App が保存済みの提案を取りに行く条件', () => {
  /** 献立1件だけの提案を組む。**当てるのは渡した名称だけである**（設計 規則6）。 */
  function suggesting(mealId: string, title: string): LatestSuggestionOutcome {
    return {
      outcome: 'suggested',
      pantryChanged: false,
      suggestion: {
        id: `suggestion-${mealId}`,
        generatedAt: '2026-09-20T09:00:00.000Z',
        entries: [
          {
            mealId,
            origin: 'generated',
            title,
            ingredients: [],
            steps: [],
            coverage: { covered: [], missing: [] },
          },
        ],
      },
    };
  }

  const GINGER_PORK = '豚こま肉と白菜の生姜焼き';
  /** 取り直していないことを観るための、2件目の台本に置く標本。 */
  const STIR_FRY = 'にんじんと卵の炒めもの';

  const suggestedMeal = suggesting('meal-1', GINGER_PORK);
  const anotherSuggestedMeal = suggesting('meal-2', STIR_FRY);

  it('サインインしていない間は、提案を取りに行かない', () => {
    // 叩いても 401 が返るだけである（先行 `listStockItems` 規則7 / 設計 規則6）。
    const { suggestions } = renderApp({ initialState: 'signedOut' }, {}, { show: [suggestedMeal] });

    expect(suggestions.showCount).toBe(0);
  });

  it('サインイン済みになると、献立タブを開かなくても提案が出ている', async () => {
    // **起動時に開くタブは献立である**（ADR-064）。取りに行く先は生成を呼ばない経路なので
    // （ADR-065 決定1）、開かれるのを待たずに取りに行ってよい。
    renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] }, { show: [suggestedMeal] });

    // 待つ条件は**テストが渡した名称**である（設計 規則7）。
    expect(await screen.findByText(GINGER_PORK)).not.toBeNull();
  });

  it('タブを移って戻っても提案を取り直さない', async () => {
    // 取り直すと往復が増える。**2件目の台本が出ないこと**で検める（設計 規則6）。
    const { suggestions } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedMeal, anotherSuggestedMeal] },
    );

    await screen.findByText(GINGER_PORK);

    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(mealsTab());
    await screen.findByText(GINGER_PORK);

    expect(screen.queryByText(STIR_FRY)).toBeNull();
    expect(suggestions.showCount).toBe(1);
  });

  it('サインアウトして入り直すと取り直し、前の提案を残さない', async () => {
    const { session } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedMeal, anotherSuggestedMeal] },
    );

    await screen.findByText(GINGER_PORK);

    emit(session, 'signedOut');
    emit(session, 'signedIn');

    // **前の世帯の提案を残さない**（NFR-09）。出るのは取り直した提案である。
    expect(await screen.findByText(STIR_FRY)).not.toBeNull();
    expect(screen.queryByText(GINGER_PORK)).toBeNull();
  });

  it('サインアウトしている間は、前の提案を画面に残さない', async () => {
    const { session } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedMeal] },
    );

    await screen.findByText(GINGER_PORK);
    emit(session, 'signedOut');

    expect(screen.queryByText(GINGER_PORK)).toBeNull();
  });
});

/**
 * 門が食材名を取りに行く条件（B-50c 設計 規則6・7）。
 *
 * **補完に何が出るかは `StockItemForm.test.tsx` の持ち分**であり、ここで二重に書かない。
 * 門の判断は「いつ取りに行くか」の1つだけである。
 */
describe('門 App が食材名を取りに行く条件', () => {
  const loadedNames = { outcome: 'loaded', ingredientNames: ['にんじん'] } as const;

  it('サインインしていない間は、食材名を取りに行かない', () => {
    // 叩いても 401 が返るだけである（先行 `listStockItems` 規則7 / 設計 規則6）。
    const { ingredientNames } = renderApp(
      { initialState: 'signedOut' },
      {},
      {},
      {
        list: [loadedNames],
      },
    );

    expect(ingredientNames.listCount).toBe(0);
  });

  it('食材名が取れなくても、在庫の一覧は出る', async () => {
    // FR-02 / FR-03 / 設計 規則4: 補完が取れないことは登録にも一覧にも及ばない。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {
        list: [{ outcome: 'failed' }],
      },
    );

    openPantry();

    expect(await screen.findByText(carrot.name)).not.toBeNull();
  });

  it('登録が通ると、食材名も取り直す', async () => {
    // 設計 規則6: 名称の出所は在庫品の名称である（ADR-063 決定2）ので、登録が通れば
    // 列も変わっている。**「保存してもう1件」で打つ次の1件に効く。**
    const { ingredientNames } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)], register: [{ outcome: 'registered' }] },
      {},
      { list: [loadedNames] },
    );

    openPantry();
    await screen.findByText(carrot.name);
    const before = ingredientNames.listCount;

    fireEvent.click(openRegisterOperation());
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(saveAndCloseOperation());

    await waitFor(() => {
      expect(ingredientNames.listCount).toBe(before + 1);
    });
  });
});

/**
 * 「新しい献立を求める」操作の配線（B-49b / FR-36 / S-5 / S-6 / ADR-065 決定4）。
 *
 * 操作そのものの出し分け（役割ごとの出す条件）は `MealsTab.test.tsx` の持ち分であり、
 * ここでは**門が送信中フラグ・失敗フラグを更新し、結果を反映し、在庫の変更後に取り直す**
 * ことだけを見る。**献立タブは起動時に開いている**（ADR-064）ので、タブを開く操作は要らない。
 */
describe('門 App の「新しい献立を求める」操作の配線', () => {
  const OLD_MEAL = '肉じゃが';
  const NEW_MEAL = '新しいご飯';

  /** 保存済みの提案（`show` の台本用）。**在庫が変わっている**ことにして手がかりの note を持たせる。 */
  function savedSuggestion(mealId: string, title: string): LatestSuggestionOutcome {
    return {
      outcome: 'suggested',
      pantryChanged: true,
      suggestion: {
        id: `suggestion-${mealId}`,
        generatedAt: '2026-09-20T09:00:00.000Z',
        entries: [
          {
            mealId,
            origin: 'generated',
            title,
            ingredients: [],
            steps: [],
            coverage: { covered: [], missing: [] },
          },
        ],
      },
    };
  }

  /** 「新しい献立を求める」が返す提案（`requestNewMeals` の台本用）。 */
  function newSuggestion(
    mealId: string,
    title: string,
  ): Extract<RequestNewMealsOutcome, { outcome: 'suggested' }> {
    return {
      outcome: 'suggested',
      suggestion: {
        id: `suggestion-${mealId}`,
        generatedAt: '2026-09-21T09:00:00.000Z',
        entries: [
          {
            mealId,
            origin: 'generated',
            title,
            ingredients: [],
            steps: [],
            coverage: { covered: [], missing: [] },
          },
        ],
      },
    };
  }

  /** 献立タブの唯一の操作（「新しい献立を求める」）。 */
  function requestNewMealsOperation(): HTMLElement {
    return screen.getByRole('button');
  }

  it('押している間は操作が押せず、結末が届くと押せるようになる', async () => {
    const { suggestions } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { requestNewMeals: [{ heldUntilSettled: newSuggestion('meal-new', NEW_MEAL) }] },
    );

    await screen.findByRole('button');
    fireEvent.click(requestNewMealsOperation());

    // `@testing-library/jest-dom` は入れない（依存の追加は止まる条件）ので、素の
    // `disabled` プロパティで見る。
    expect((requestNewMealsOperation() as HTMLButtonElement).disabled).toBe(true);

    await settleSuggestions(suggestions);

    expect((requestNewMealsOperation() as HTMLButtonElement).disabled).toBe(false);
  });

  it('送信中にもう一度押しても、2度目の要求を出さない', async () => {
    const { suggestions } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { requestNewMeals: [{ heldUntilSettled: newSuggestion('meal-new', NEW_MEAL) }] },
    );

    await screen.findByRole('button');
    fireEvent.click(requestNewMealsOperation());
    fireEvent.click(requestNewMealsOperation());

    // この観点だけ件数を断定してよい（検分の指示）。
    expect(suggestions.requestNewMealsCount).toBe(1);

    await settleSuggestions(suggestions);
  });

  it('新しい献立が届くと、画面が新しい献立に入れ替わり、在庫が変わっている手がかりは出ない', async () => {
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {
        show: [savedSuggestion('meal-old', OLD_MEAL)],
        requestNewMeals: [
          { outcome: 'suggested', suggestion: newSuggestion('meal-new', NEW_MEAL).suggestion },
        ],
      },
    );

    await screen.findByText(OLD_MEAL);
    const noteCountBefore = screen.getAllByRole('note').length;

    fireEvent.click(requestNewMealsOperation());

    await screen.findByText(NEW_MEAL);
    expect(screen.queryByText(OLD_MEAL)).toBeNull();

    // 規則4: 生成直後は `pantryChanged` を `false` に決め打つ。手がかりの note が1つ減る。
    expect(screen.getAllByRole('note').length).toBe(noteCountBefore - 1);
  });

  it('生成が失敗しても、画面の献立は前のまま残り、失敗の案内が出る', async () => {
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [savedSuggestion('meal-old', OLD_MEAL)], requestNewMeals: [{ outcome: 'failed' }] },
    );

    await screen.findByText(OLD_MEAL);
    fireEvent.click(requestNewMealsOperation());

    await waitFor(() => {
      expect(screen.getAllByRole('status')).toHaveLength(1);
    });
    expect(screen.queryByText(OLD_MEAL)).not.toBeNull();
  });

  it('在庫が足りない結末は、失敗にも提案にも畳まれない', async () => {
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {
        show: [savedSuggestion('meal-old', OLD_MEAL)],
        requestNewMeals: [{ outcome: 'insufficientStockItems' }],
      },
    );

    await screen.findByText(OLD_MEAL);
    fireEvent.click(requestNewMealsOperation());

    await waitFor(() => {
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });
    // B-49c で、この結末は案内を1つ持つようになった（`docs/screen-design.md` D-7）。
    // **失敗（S-6）の枝と見分けるのは `note` の件数である** — 失敗の案内は
    // 「新しい献立を求める」の面に出るため、待ち時間の手がかり（`note`）を必ず伴う。
    // S-4 の枝はその操作ごと出さないので `note` が1つも無い。
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryAllByRole('note')).toHaveLength(0);
  });

  it('生成の上限に達した結末も、失敗にも提案にも畳まれない', async () => {
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {
        show: [savedSuggestion('meal-old', OLD_MEAL)],
        requestNewMeals: [{ outcome: 'generationLimitReached' }],
      },
    );

    await screen.findByText(OLD_MEAL);
    fireEvent.click(requestNewMealsOperation());

    await waitFor(() => {
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });
    // S-4 と同じ理由で案内を1つ持つ。**こちらは操作を1つも出さない**ので
    // （在庫は原因ではない。NFR-C2 / ADR-049）、`button` が0件であることでも
    // 失敗の枝と見分けられる。
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryAllByRole('note')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('押し直すと、前回の失敗の案内は消える', async () => {
    const { suggestions } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {
        show: [savedSuggestion('meal-old', OLD_MEAL)],
        requestNewMeals: [
          { outcome: 'failed' },
          { heldUntilSettled: newSuggestion('meal-new', NEW_MEAL) },
        ],
      },
    );

    await screen.findByText(OLD_MEAL);
    fireEvent.click(requestNewMealsOperation());

    await waitFor(() => {
      expect(screen.getAllByRole('status')).toHaveLength(1);
    });

    fireEvent.click(requestNewMealsOperation());

    // 役割の割り当て（検分）: 送信中の案内と失敗の案内はどちらも role="status" で、
    // 同時には出ない（押した時点で失敗の案内を消す）。2回目を押した直後は送信中の案内
    // 1つだけになり、前回の失敗の案内と積み重ならない。
    expect(screen.getAllByRole('status')).toHaveLength(1);

    await settleSuggestions(suggestions);
  });

  it('在庫の登録が通ると、保存済みの提案を取り直す', async () => {
    renderApp(
      { initialState: 'signedIn' },
      {
        list: [loaded(carrot), loaded(chineseCabbage)],
        register: [{ outcome: 'registered' }],
      },
      { show: [savedSuggestion('meal-old', OLD_MEAL), savedSuggestion('meal-new', NEW_MEAL)] },
    );

    await screen.findByText(OLD_MEAL);

    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(openRegisterOperation());
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(saveAndCloseOperation());
    await screen.findByText(chineseCabbage.name);

    fireEvent.click(mealsTab());

    // B-49b 規則10: 登録が通った回に、保存済みの提案（台本の2件目）を取り直す。
    expect(await screen.findByText(NEW_MEAL)).not.toBeNull();
  });

  it('在庫の削除が通ると、保存済みの提案を取り直す', async () => {
    renderApp(
      { initialState: 'signedIn' },
      {
        list: [loaded(carrot), loaded(chineseCabbage)],
        remove: [{ outcome: 'deleted' }],
      },
      { show: [savedSuggestion('meal-old', OLD_MEAL), savedSuggestion('meal-new', NEW_MEAL)] },
    );

    await screen.findByText(OLD_MEAL);

    openPantry();
    await screen.findByText(carrot.name);
    swipeSoleRow();
    await screen.findByText(chineseCabbage.name);

    fireEvent.click(mealsTab());

    expect(await screen.findByText(NEW_MEAL)).not.toBeNull();
  });

  it('在庫の登録が断られた回は、提案を取り直さない', async () => {
    renderApp(
      { initialState: 'signedIn' },
      {
        list: [loaded(carrot), loaded(chineseCabbage)],
        register: [{ outcome: 'rejected', rule: 'expiryDate.format' }],
      },
      { show: [savedSuggestion('meal-old', OLD_MEAL), savedSuggestion('meal-new', NEW_MEAL)] },
    );

    await screen.findByText(OLD_MEAL);

    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(openRegisterOperation());
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(saveAndCloseOperation());

    await waitFor(() => {
      expect(notices()).toHaveLength(1);
    });
    fireEvent.click(closeRegisterOperation());

    fireEvent.click(mealsTab());

    expect(screen.queryByText(OLD_MEAL)).not.toBeNull();
    expect(screen.queryByText(NEW_MEAL)).toBeNull();
  });
});

/**
 * 選んでいるタブの結線（B-49c 2周目 / ADR-066 / `docs/screen-design.md` D-7）。
 *
 * **選んでいるタブは門が持つ**（ADR-066 決定2）。器は `selectedTab` / `onSelectTab` を
 * 受け取るだけで状態を持たず（同 決定1）、「在庫タブへ送る」という意味は `MealsTab` が持つ
 * （同 決定3）。ここで見るのは**門の側の3つ**だけである — 入ったときにどのタブが開いているか、
 * 画面からの求めでタブが移るか、移しても何も取り直さないか（同 結果3 / D-8）。
 *
 * タブの見せ方そのもの（`aria-selected` の移り方・見た目の手がかり）は
 * `TabbedScreen.test.tsx` の持ち分、S-4 / S-7 の枝の中身は `MealsTab.test.tsx` の持ち分であり、
 * **ここで二重に書かない。**
 */
describe('門 App のタブの結線', () => {
  /**
   * S-4（在庫が足りない）の画面まで進める。**経路は「新しい献立を求める」の結末**である
   * （保存済みの読み取りにこの結末は無い。ADR-065 決定3）。
   *
   * 待つ条件は**手がかり（`note`）が1つも無くなること**である — S-8 の枝は
   * 「新しい献立を求める」の面を持つので `note` を伴い、S-4 の枝はその操作ごと出さない
   * （D-7）。**仮の文言では待たない**（設計 規則7・11）。
   */
  async function renderAtInsufficientStockItems() {
    const app = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [{ outcome: 'none' }], requestNewMeals: [{ outcome: 'insufficientStockItems' }] },
    );

    fireEvent.click(await screen.findByRole('button'));
    await waitFor(() => {
      expect(screen.queryAllByRole('note')).toHaveLength(0);
    });

    return app;
  }

  /** 在庫タブへ送る操作。S-4 の枝が出す唯一の操作である（D-7 / B-49c 規則1・2）。 */
  function goToPantryOperation(): HTMLElement {
    return operationAt(0, 1);
  }

  it('サインイン済みになった直後に開いているのは献立タブである', async () => {
    renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] });

    await screen.findByRole('button');

    // ADR-064 / ADR-066 結果1: 既定のタブを決めるのは門である（器ではない）。
    expect(mealsTab().getAttribute('aria-selected')).toBe('true');
    expect(pantryTab().getAttribute('aria-selected')).not.toBe('true');
    expect(historyTab().getAttribute('aria-selected')).not.toBe('true');
  });

  it('在庫が足りない回の操作を押すと、在庫タブの中身が出る', async () => {
    await renderAtInsufficientStockItems();

    fireEvent.click(goToPantryOperation());

    // D-7 / ADR-066 決定2: 送る先は**在庫タブ**であり、一覧と登録の出し分けは
    // `PantryTab` が持つ（B-39 設計 規則1）。観るのは**テストが渡した名称**である。
    expect(await screen.findByText(carrot.name)).not.toBeNull();
  });

  it('在庫が足りない回の操作を押すと、選ばれている印が在庫タブへ移る', async () => {
    await renderAtInsufficientStockItems();

    fireEvent.click(goToPantryOperation());
    await screen.findByText(carrot.name);

    // ADR-066 決定2 / B-38 設計 6章 規則5: 帯の見えも一緒に移る — 中身だけが入れ替わると、
    // 利用者はいまどのタブに居るか読めない。
    expect(pantryTab().getAttribute('aria-selected')).toBe('true');
    expect(mealsTab().getAttribute('aria-selected')).not.toBe('true');
  });

  it('在庫タブへ送っても、保存済みの提案を取りに行き直さない', async () => {
    const { suggestions } = await renderAtInsufficientStockItems();
    const showsBefore = suggestions.showCount;

    fireEvent.click(goToPantryOperation());
    await screen.findByText(carrot.name);

    // ADR-066 結果3 / D-8 / B-49b 規則10: **タブを移すのは画面を切り替えるだけ**である。
    // 取り直すのは在庫の登録・削除が通った回だけで、その経路は既にある。
    expect(suggestions.showCount).toBe(showsBefore);
  });

  it('在庫タブへ送っても、在庫一覧を取りに行き直さない', async () => {
    const { requests } = await renderAtInsufficientStockItems();
    const listsBefore = requests.listCount;

    fireEvent.click(goToPantryOperation());
    await screen.findByText(carrot.name);

    // B-22 設計 規則11 / ADR-066 結果3: タブを移っても取得の効果は走り直さない。
    expect(requests.listCount).toBe(listsBefore);
  });

  it('在庫タブへ送った後に献立タブへ戻ると、在庫が足りない回の案内のままである', async () => {
    await renderAtInsufficientStockItems();

    fireEvent.click(goToPantryOperation());
    await screen.findByText(carrot.name);
    fireEvent.click(mealsTab());

    // ADR-066 結果3: 提案の状態は門が持っており、タブを往復しても変わらない —
    // 戻った先が「まだ提案が無い（S-8）」や失敗（S-6）に化けない。**見分けは件数で行う**
    // （設計 規則2・11）: S-4 の枝は操作1つと案内1つを持ち、手がかり（`note`）を持たない。
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryAllByRole('note')).toHaveLength(0);
  });

  it('サインアウトして入り直すと、開いているのは既定の献立タブに戻る', async () => {
    const { session } = renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] });

    await screen.findByRole('button');
    openPantry();
    await screen.findByText(carrot.name);

    emit(session, 'signedOut');
    emit(session, 'signedIn');
    await screen.findByRole('note');

    // ADR-066 結果1 / B-38 設計 6章 規則9: 状態を門へ持ち上げても、**入り直すと
    // `DEFAULT_TAB` へ戻る**ことは変えない（`docs/screen-design.md` 2.3 の `login --> meals`）。
    expect(mealsTab().getAttribute('aria-selected')).toBe('true');
  });
});

/**
 * 在庫の編集の結線（FR-05 / B-55 設計 4章・5章 / 6章 規則9 / B-22 規則3 / B-24 /
 * B-49b 規則10 / C-7）。
 *
 * **門の判断は「通った回に取り直すこと」の1つだけ**である（設計 規則9）。編集の画面の中身
 * （欄の値・送る中身・案内・閉じる条件）は `StockItemEditForm.test.tsx` と
 * `PantryTab.test.tsx` が、行のタップの読みは `SwipeGesture.test.ts` と
 * `PantryList.test.tsx` が既に押さえており、**ここで二重に書かない。**
 *
 * 観察はこの suite と同じ手がかりで行う（**仮の文言も記号も期待値に書かない**）。
 */
describe('在庫の編集（B-55）', () => {
  /** 編集の画面に出ている操作は3つ（閉じる／保存／ログアウト）である。下タブは `role="tab"` なので混ざらない。 */
  const EDIT_OPERATION_COUNT = 3;

  /** 打った分量。**テストが渡した値**なので、一覧に出ていないことを当ててよい（設計 規則6）。 */
  const EDITED_AMOUNT = '300g';

  function closeEditOperation(): HTMLElement {
    return operationAt(0, EDIT_OPERATION_COUNT);
  }

  function saveEditOperation(): HTMLElement {
    return operationAt(1, EDIT_OPERATION_COUNT);
  }

  /**
   * 行をタップする（設計 規則15）。**押下と離上を同じ座標に送る** — 動かしていないことが
   * タップである（判断は `SwipeGesture.ts` の持ち分で、ここは入力を送るだけである）。
   */
  function tapSoleRow(): void {
    const row = soleRow();

    fireEvent.pointerDown(row, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(row, { pointerId: 1, clientX: 0, clientY: 0 });
  }

  /** 編集の画面の分量の欄。**`textbox` はこれ1つだけである**（設計 規則1）。 */
  function editAmountField(): HTMLElement {
    return screen.getByRole('textbox');
  }

  /** 保存済みの提案（`show` の台本用）。**当てるのは渡した名称だけである**（設計 規則6）。 */
  function savedSuggestion(mealId: string, title: string): LatestSuggestionOutcome {
    return {
      outcome: 'suggested',
      pantryChanged: true,
      suggestion: {
        id: `suggestion-${mealId}`,
        generatedAt: '2026-09-20T09:00:00.000Z',
        entries: [
          {
            mealId,
            origin: 'generated',
            title,
            ingredients: [],
            steps: [],
            coverage: { covered: [], missing: [] },
          },
        ],
      },
    };
  }

  it('行をタップすると、編集の入力の欄が出る', async () => {
    renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] });

    openPantry();
    await screen.findByText(carrot.name);
    tapSoleRow();

    // FR-05 / 設計 5章: 更新の口が門から通っていることの検めである。編集の欄は分量
    // （`textbox`）と期限（`type="date"`）の2つで、名称の欄は無い（設計 規則1）。
    expect(textboxes()).toHaveLength(1);
    expect(screen.getAllByRole('button')).toHaveLength(EDIT_OPERATION_COUNT);
  });

  it('更新が通ると、一覧を取り直して新しい在庫品が出る', async () => {
    renderApp(
      { initialState: 'signedIn' },
      {
        list: [loaded(carrot), loaded(chineseCabbage)],
        update: [{ outcome: 'updated' }],
      },
    );

    openPantry();
    await screen.findByText(carrot.name);
    tapSoleRow();
    fireEvent.click(saveEditOperation());

    // FR-05 / 設計 規則9 / B-22 規則3: 通った回だけ門が取り直す（先行 B-24 / B-23）。
    expect(await screen.findByText(chineseCabbage.name)).not.toBeNull();
  });

  it('更新して閉じたあとの一覧に、打った分量は出ない', async () => {
    renderApp(
      { initialState: 'signedIn' },
      {
        list: [loaded(carrot), loaded(chineseCabbage)],
        update: [{ outcome: 'updated' }],
      },
    );

    openPantry();
    await screen.findByText(carrot.name);
    tapSoleRow();
    fireEvent.change(editAmountField(), { target: { value: EDITED_AMOUNT } });
    fireEvent.click(saveEditOperation());
    await screen.findByText(chineseCabbage.name);

    // 設計 規則9: **web で行を書き換えない** — 並び（期限の近い順）を決めるのはサーバであり、
    // 取り直した結果がそれである。一覧に出るのは台本の2件目のぶんだけである。
    expect(screen.queryByText(EDITED_AMOUNT)).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('更新が断られた回は、一覧を取り直さない', async () => {
    renderApp(
      { initialState: 'signedIn' },
      {
        list: [loaded(carrot), loaded(chineseCabbage)],
        update: [{ outcome: 'rejected', rule: 'update.notFound' }],
      },
    );

    openPantry();
    await screen.findByText(carrot.name);
    tapSoleRow();
    fireEvent.click(saveEditOperation());

    // 断りが届いたことを待ってから閉じる（待つ条件に仮の文言を使わない）。
    // **ADR-050 結果5** / 設計 規則10: 更新の `update.notFound` は「すでに消えている」と
    // 読まず、案内を出す。
    await waitFor(() => {
      expect(notices()).toHaveLength(1);
    });
    fireEvent.click(closeEditOperation());

    // 設計 規則9 / 10章: 在庫は1件も変わっていないので、往復を1つ無駄にしない。
    expect(screen.queryByText(carrot.name)).not.toBeNull();
    expect(screen.queryByText(chineseCabbage.name)).toBeNull();
  });

  it('更新が通ると、保存済みの提案も取り直す', async () => {
    const OLD_MEAL = '肉じゃが';
    const NEW_MEAL = '新しいご飯';

    renderApp(
      { initialState: 'signedIn' },
      {
        list: [loaded(carrot), loaded(chineseCabbage)],
        update: [{ outcome: 'updated' }],
      },
      { show: [savedSuggestion('meal-old', OLD_MEAL), savedSuggestion('meal-new', NEW_MEAL)] },
    );

    await screen.findByText(OLD_MEAL);

    openPantry();
    await screen.findByText(carrot.name);
    tapSoleRow();
    fireEvent.click(saveEditOperation());
    await screen.findByText(chineseCabbage.name);

    fireEvent.click(mealsTab());

    // B-49b 規則10 / C-7 / 設計 規則9: 在庫が変われば C-7 の一致が崩れ、`pantryChanged` の
    // 手がかりが古くなる。取り直しの数えは登録・削除と同じ1つに載る。
    expect(await screen.findByText(NEW_MEAL)).not.toBeNull();
  });
});
