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
import type { MealSummaryOutput, StockItemDto } from '@fridge-to-meal/contract';
import { act, fireEvent, render, screen, waitFor, within } from './support/dom/renderComponent.js';
import { installPointerCapture } from './support/dom/pointerCapture.js';
import { FixedSession } from './support/session/FixedSession.js';
import type { FixedSessionOptions } from './support/session/FixedSession.js';
import { FixedStockItemRequests } from './support/server/FixedStockItemRequests.js';
import type { FixedStockItemRequestsOptions } from './support/server/FixedStockItemRequests.js';
import { FixedSuggestionRequests } from './support/server/FixedSuggestionRequests.js';
import type { FixedSuggestionRequestsOptions } from './support/server/FixedSuggestionRequests.js';
import { FixedMealRequests } from './support/server/FixedMealRequests.js';
import type { FixedMealRequestsOptions } from './support/server/FixedMealRequests.js';
import { FixedIngredientNameRequests } from './support/server/FixedIngredientNameRequests.js';
import type { FixedIngredientNameRequestsOptions } from './support/server/FixedIngredientNameRequests.js';
import { App } from '../src/App.js';
import type { SessionState } from '../src/session/Session.js';
import type { StockItemsOutcome } from '../src/server/StockItemRequests.js';
import type { MealListOutcome, MealOutcome } from '../src/server/MealRequests.js';
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
  mealOptions: FixedMealRequestsOptions = {},
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

  // **台本は渡された観点だけが持つ。** 献立詳細は開かれるまで取りに行かないので
  // （B-53 規則1）、詳細が本題でない観点では呼ばれる口が1つも無い。
  //
  // **ただし履歴は既定で「取れなかった」を配る**（B-54b 規則12）。門はサインイン済みになると
  // 必ず取りに行くので、履歴が本題でない観点でも台本が1つ要る。
  const meals = new FixedMealRequests({ list: [{ outcome: 'failed' }], ...mealOptions });

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
      showMeal={meals.showMeal}
      addCookingRecord={meals.addCookingRecord}
      listMeals={meals.listMeals}
    />,
  );

  return { session, requests, suggestions, ingredientNames, meals };
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

/**
 * 在庫の一覧に出ている操作は1つ（登録を開く）である。**ログアウトは在庫タブに置かない**
 * （B-56c 規則12 — ログアウトへの経路は設定画面の1つだけ）。
 */
const LIST_OPERATION_COUNT = 1;
/** 登録の画面に出ている操作は3つ（閉じる／保存2つ）である（B-56c 規則12）。 */
const REGISTER_OPERATION_COUNT = 3;

function openRegisterOperation(): HTMLElement {
  return operationAt(0, LIST_OPERATION_COUNT);
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

  /**
   * 「新しい献立を求める」操作。**末尾の1つである**（D-4）— カード1枚ごとに詳細を開く操作が
   * 1つ在るので（B-53）、`getByRole('button')` では引けない。**名札は見ない**（設計 規則2）。
   */
  function requestNewMealsOperation(): HTMLElement {
    const operations = screen.getAllByRole('button');
    const operation = operations.at(-1);
    if (operation === undefined) throw new Error('操作が1つも無い');

    return operation;
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
  /**
   * 編集の画面に出ている操作は2つ（閉じる／保存）である。下タブは `role="tab"` なので混ざらない。
   * **ログアウトは置かない**（B-56c 規則12。編集の画面の規則12 はこの件数で押さえる）。
   */
  const EDIT_OPERATION_COUNT = 2;

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

/**
 * 献立詳細を開く・閉じる・記録する（B-53 設計 規則1・17〜19）。
 *
 * 詳細の中の描画（材料の並び・印・注意表示・操作の位置）は `MealDetail.test.tsx` が、
 * カードの中の開く操作は `MealsTab.test.tsx` が既に押さえている。**ここで確かめるのは
 * 門が持つ3つだけ**である — 開かれたら取りに行くこと、いつ閉じるか、いつ取り直すか。
 */
describe('門 App の献立詳細', () => {
  /** 提案が1件出ている状態。**カードの中の開く操作を押せる。** */
  function suggestedOne(title = '肉じゃが'): LatestSuggestionOutcome {
    return {
      outcome: 'suggested',
      pantryChanged: false,
      suggestion: {
        id: 'suggestion-1',
        generatedAt: '2026-09-20T09:00:00.000Z',
        entries: [
          {
            mealId: 'meal-1',
            origin: 'reused',
            title,
            ingredients: [],
            steps: [],
            coverage: { covered: [], missing: [] },
          },
        ],
      },
    };
  }

  /** 取れた献立1件。**名称はテストが渡したものを観る**（設計 規則6）。 */
  function shownMeal(title: string): MealOutcome {
    return {
      outcome: 'shown',
      meal: {
        mealId: 'meal-1',
        title,
        ingredients: [{ name: 'にんじん', kind: 'main', amount: null }],
        steps: [],
        coverage: {
          covered: [{ name: 'にんじん', kind: 'main', amount: null, expiryDate: null }],
          missing: [],
        },
        cooked: false,
      },
    };
  }

  /** カードの中の開く操作。**カード1枚の回はカードの中の1つだけ**である（B-53）。 */
  async function openMealOperation(): Promise<HTMLElement> {
    const card = (await screen.findAllByRole('listitem'))[0];
    if (card === undefined) throw new Error('カードが1枚も無い');

    return within(card).getByRole('button');
  }

  /**
   * 詳細に出ている操作は2つ（閉じる／これを作った）である。**名札は見ない**（設計 規則2）。
   * 「新しい献立を求める」は詳細を出している間は出ない（`MealsTab` の持ち分）。
   */
  const DETAIL_OPERATION_COUNT = 2;

  function closeMealDetailOperation(): HTMLElement {
    return operationAt(0, DETAIL_OPERATION_COUNT);
  }

  function cookedOperation(): HTMLElement {
    return operationAt(1, DETAIL_OPERATION_COUNT);
  }

  /** 献立の側（`FixedMealRequests`）の保留を解く。 */
  async function settleMeals(meals: FixedMealRequests): Promise<void> {
    await act(async () => {
      meals.settle();
    });
  }

  it('カードの開く操作を押すと、その献立を取りに行って詳細を出す', async () => {
    // 規則1: **開くたびに取りに行く。** カードが持っている提案の1件を描き回さない —
    // 充足は開いた時点の在庫で算出されたものでなければならない（FR-32 / ADR-009）。
    const { meals } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne()] },
      {},
      { show: [shownMeal('詳細の献立')] },
    );

    fireEvent.click(await openMealOperation());

    expect(await screen.findByText('詳細の献立')).not.toBeNull();
    expect(meals.shownMealIds).toEqual(['meal-1']);
  });

  it('詳細を開くまでは、献立1件を取りに行かない', async () => {
    // **画面を出すだけでは取りに行かない**（規則1）。台本を渡していない口が呼ばれたら落ちる。
    const { meals } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne()] },
    );

    await openMealOperation();

    expect(meals.shownMealIds).toEqual([]);
  });

  it('タブを移っても詳細は閉じない', async () => {
    // 先行「取り直しても登録の画面は閉じない」（B-39）。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne()] },
      {},
      { show: [shownMeal('詳細の献立')] },
    );

    fireEvent.click(await openMealOperation());
    await screen.findByText('詳細の献立');

    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(mealsTab());

    expect(await screen.findByText('詳細の献立')).not.toBeNull();
  });

  it('サインアウトすると詳細は閉じる', async () => {
    // NFR-09: 前の世帯の献立を残さない（先行 `App.tsx` の提案のリセット）。
    const { session } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne()] },
      {},
      { show: [shownMeal('詳細の献立')] },
    );

    fireEvent.click(await openMealOperation());
    await screen.findByText('詳細の献立');

    emit(session, 'signedOut');
    emit(session, 'signedIn');

    await waitFor(() => {
      expect(screen.queryByText('詳細の献立')).toBeNull();
    });
  });

  it('在庫の削除が通ると、開いている詳細も取り直す', async () => {
    // FR-32: 充足が変わっている。読み取り専用の `GET` なので費用も枠も使わない（規則19）。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot), loaded()], remove: [{ outcome: 'deleted' }] },
      { show: [suggestedOne()] },
      {},
      { show: [shownMeal('前の詳細'), shownMeal('取り直した詳細')] },
    );

    fireEvent.click(await openMealOperation());
    await screen.findByText('前の詳細');

    openPantry();
    await screen.findByText(carrot.name);
    swipeSoleRow();

    // 消えたと読めたら一覧を取り直す（B-23 / ADR-050）。2件目の台本は空なので、行が
    // 消えたことが取り直しの合図である。
    await waitFor(() => {
      expect(screen.queryByText(carrot.name)).toBeNull();
    });

    fireEvent.click(mealsTab());

    expect(await screen.findByText('取り直した詳細')).not.toBeNull();
  });

  it('記録の操作を押すと、開いている献立に記録を足す', async () => {
    const { meals } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne()] },
      {},
      { show: [shownMeal('詳細の献立')], addCookingRecord: [{ outcome: 'recorded' }] },
    );

    fireEvent.click(await openMealOperation());
    await screen.findByText('詳細の献立');

    fireEvent.click(cookedOperation());

    await waitFor(() => {
      expect(meals.recordedMealIds).toEqual(['meal-1']);
    });
  });

  it('記録が通っても献立の中身は取り直さず、詳細は開いたままである', async () => {
    // C-3 / C-8 / 規則11: 献立は記録で変わらず、在庫も減らない。
    const { meals } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne()] },
      {},
      { show: [shownMeal('詳細の献立')], addCookingRecord: [{ outcome: 'recorded' }] },
    );

    fireEvent.click(await openMealOperation());
    await screen.findByText('詳細の献立');

    fireEvent.click(cookedOperation());
    await waitFor(() => {
      expect(meals.recordedMealIds).toEqual(['meal-1']);
    });

    expect(screen.queryByText('詳細の献立')).not.toBeNull();
    expect(meals.shownMealIds).toEqual(['meal-1']);
  });

  it('記録を送っている間は、2度目の記録を送らない', async () => {
    // 先行 `handleRequestNewMeals`。**同じ記録が2件入ることを門の側でも止める。**
    const { meals } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne()] },
      {},
      {
        show: [shownMeal('詳細の献立')],
        addCookingRecord: [{ heldUntilSettled: { outcome: 'recorded' } }],
      },
    );

    fireEvent.click(await openMealOperation());
    await screen.findByText('詳細の献立');

    fireEvent.click(cookedOperation());
    fireEvent.click(cookedOperation());
    await settleMeals(meals);

    expect(meals.recordedMealIds).toEqual(['meal-1']);
  });

  it('記録が断られても詳細は閉じない', async () => {
    // 閉じると、断りの案内を読む前に画面が変わる（規則13 / S-6 の構え）。
    const { meals } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne()] },
      {},
      {
        show: [shownMeal('詳細の献立')],
        addCookingRecord: [{ outcome: 'rejected', rule: 'addCookingRecord.mealNotFound' }],
      },
    );

    fireEvent.click(await openMealOperation());
    await screen.findByText('詳細の献立');

    fireEvent.click(cookedOperation());
    await waitFor(() => {
      expect(meals.recordedMealIds).toEqual(['meal-1']);
    });

    expect(screen.queryByText('詳細の献立')).not.toBeNull();
  });

  it('別の献立を開き直すと、前の記録の結末は残らない', async () => {
    // 記録の案内は「いまの1回」の結末である（規則12）。開き直した先に持ち越すと、
    // 記録していない献立に記録の案内が出る。
    const { meals } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne()] },
      {},
      {
        show: [shownMeal('詳細の献立'), shownMeal('開き直した詳細')],
        addCookingRecord: [{ outcome: 'recorded' }],
      },
    );

    fireEvent.click(await openMealOperation());
    await screen.findByText('詳細の献立');

    fireEvent.click(cookedOperation());
    await waitFor(() => {
      expect(meals.recordedMealIds).toEqual(['meal-1']);
    });
    const noticesWhileRecorded = screen.queryAllByRole('status').length;

    // 閉じてから開き直す。
    fireEvent.click(closeMealDetailOperation());
    fireEvent.click(await openMealOperation());
    await screen.findByText('開き直した詳細');

    expect(screen.queryAllByRole('status').length).toBeLessThan(noticesWhileRecorded);
  });

  it('詳細を閉じるとカードの一覧に戻る', async () => {
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne('肉じゃが')] },
      {},
      { show: [shownMeal('詳細の献立')] },
    );

    fireEvent.click(await openMealOperation());
    await screen.findByText('詳細の献立');

    fireEvent.click(closeMealDetailOperation());

    expect(await screen.findByText('肉じゃが')).not.toBeNull();
  });
});

/**
 * 門 App の履歴タブ（B-54b 3周目 / 設計 6章 規則6・9〜15 / 7章 行2）。
 *
 * **列の見せ方そのもの**（1列ずつ・並び・件数・案内の出し分け）は `HistoryTab.test.tsx` の
 * 持ち分であり、ここで二重に書かない。門の判断は**いつ履歴を取りに行くか**と、
 * **開いた献立をどのタブに描き、閉じたらどこへ戻すか**である。
 *
 * **取り直したかどうかは画面で検める** — 台本の2件目の名称が出れば取り直している。
 * 件数（`listCount`）を観るのは「サインイン前は取りに行かない」の1件だけである。
 */
describe('門 App の履歴タブ', () => {
  const NIKUJAGA = '肉じゃが';
  const GINGER_PORK = '豚こま肉と白菜の生姜焼き';
  const STIR_FRY = 'にんじんと卵の炒めもの';
  const NEW_MEAL = '新しいご飯';
  /** 詳細に出る名称。**行の名称と別にしておく** — 行と詳細のどちらが出ているかを見分ける。 */
  const DETAIL = '詳細の献立';
  /** 献立タブのカードに出る名称。 */
  const SUGGESTED = '提案の献立';
  /** 取り直していないことを観るための、提案の2件目の台本に置く名称。 */
  const ANOTHER_SUGGESTED = '別の提案の献立';

  function summaryOf(mealId: string, title: string): MealSummaryOutput {
    return { mealId, title, ingredientCount: 2 };
  }

  const mealA = summaryOf('meal-a', NIKUJAGA);
  const mealB = summaryOf('meal-b', GINGER_PORK);
  const mealC = summaryOf('meal-c', STIR_FRY);

  function listed(
    seen: readonly MealSummaryOutput[],
    cooked: readonly MealSummaryOutput[] = [],
  ): MealListOutcome {
    return { outcome: 'loaded', meals: { seen: [...seen], cooked: [...cooked] } };
  }

  /** 取れた献立1件。**材料を持たせない** — 名称以外の文字が画面に混ざらないようにする。 */
  function shownMealOf(mealId: string, title: string): MealOutcome {
    return {
      outcome: 'shown',
      meal: {
        mealId,
        title,
        ingredients: [],
        steps: [],
        coverage: { covered: [], missing: [] },
        cooked: false,
      },
    };
  }

  /** 提案が1件出ている状態。**カードの中の開く操作を押せる。** */
  function suggestedOne(mealId: string, title: string): LatestSuggestionOutcome {
    return {
      outcome: 'suggested',
      pantryChanged: false,
      suggestion: {
        id: `suggestion-${mealId}`,
        generatedAt: '2026-09-20T09:00:00.000Z',
        entries: [
          {
            mealId,
            origin: 'reused',
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
  function newSuggestion(mealId: string, title: string): RequestNewMealsOutcome {
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

  function openHistory(): void {
    fireEvent.click(historyTab());
  }

  /** 名称で行を引き、その行の開く操作を押す。**行の中の操作は1つだけ**である（規則8）。 */
  async function openHistoryRow(title: string): Promise<void> {
    await screen.findByText(title);
    const row = screen
      .getAllByRole('listitem')
      .find((item) => within(item).queryByText(title) !== null);
    if (row === undefined) throw new Error(`${title} の行が無い`);

    fireEvent.click(within(row).getByRole('button'));
  }

  /** 献立タブのカードの開く操作を押す。**カード1枚の回はカードの中の1つだけ**である（B-53）。 */
  async function openCard(): Promise<void> {
    const card = (await screen.findAllByRole('listitem'))[0];
    if (card === undefined) throw new Error('カードが1枚も無い');

    fireEvent.click(within(card).getByRole('button'));
  }

  /** 列の切り替え（`aria-pressed` を持つ操作）。読み込み中と取れなかった回には出ない。 */
  function columnToggles(): readonly HTMLElement[] {
    return screen.queryAllByRole('button').filter((button) => button.hasAttribute('aria-pressed'));
  }

  /** 押されていない側の列へ切り替える。**先に1つだけであることを確かめる。** */
  function switchColumn(): void {
    const toggles = screen.getAllByRole('button', { pressed: false });
    expect(toggles).toHaveLength(1);

    const [toggle] = toggles;
    if (toggle === undefined) throw new Error('押されていない切り替えが無い');

    fireEvent.click(toggle);
  }

  /** 詳細に出ている操作は2つ（閉じる／これを作った）である（B-53）。 */
  const DETAIL_OPERATION_COUNT = 2;

  function closeDetailOperation(): HTMLElement {
    return operationAt(0, DETAIL_OPERATION_COUNT);
  }

  function cookedOperation(): HTMLElement {
    return operationAt(1, DETAIL_OPERATION_COUNT);
  }

  /** 記録の結末が届いたこと（案内が1つ出る）を待つ。**文言は見ない。** */
  async function waitForRecordNotice(): Promise<void> {
    await waitFor(() => {
      expect(screen.getAllByRole('status')).toHaveLength(1);
    });
  }

  /** 献立の側（`FixedMealRequests`）の保留を解く。 */
  async function settleMeals(meals: FixedMealRequests): Promise<void> {
    await act(async () => {
      meals.settle();
    });
  }

  // --- 取りに行く時機（規則12・14・15） ---

  it('サインインしていない間は、履歴を取りに行かない', () => {
    // 規則12: 叩いても 401 が返るだけである。**件数を断定するのはこの1件だけ。**
    const { meals } = renderApp(
      { initialState: 'signedOut' },
      {},
      {},
      {},
      {
        list: [listed([mealA])],
      },
    );

    expect(meals.listCount).toBe(0);
  });

  it('サインイン済みになると、履歴タブを開けばサーバから取れた行が出ている', async () => {
    // 規則12 / FR-28
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA])],
      },
    );

    openHistory();

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
  });

  it('履歴タブを出て戻っても、履歴を取り直さない', async () => {
    // 規則12: タブの移動では取り直さない。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA]), listed([mealB])],
      },
    );

    openHistory();
    await screen.findByText(NIKUJAGA);
    openPantry();
    await screen.findByText(carrot.name);
    openHistory();

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
    expect(screen.queryByText(GINGER_PORK)).toBeNull();
  });

  it('履歴から開いた詳細を閉じても、履歴を取り直さない', async () => {
    // 規則12: 詳細の開閉では取り直さない。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA]), listed([mealB])],
        show: [shownMealOf('meal-a', DETAIL)],
      },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    fireEvent.click(closeDetailOperation());

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
    expect(screen.queryByText(GINGER_PORK)).toBeNull();
  });

  it('在庫の登録が通っても、履歴を取り直さない', async () => {
    // 規則12: 在庫の登録・更新・削除では献立は増えも減りもしない（登録で代表する）。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot), loaded(chineseCabbage)], register: [{ outcome: 'registered' }] },
      {},
      {},
      { list: [listed([mealA]), listed([mealB])] },
    );

    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(openRegisterOperation());
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(saveAndCloseOperation());
    await screen.findByText(chineseCabbage.name);

    openHistory();

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
    expect(screen.queryByText(GINGER_PORK)).toBeNull();
  });

  it('調理記録が通ると、その献立は以前見た列から消える', async () => {
    // 規則12 / FR-28・29: 記録で献立は「以前見た」から「つくった」へ移る（ADR-068 決定3）。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA]), listed([], [mealA])],
        show: [shownMealOf('meal-a', DETAIL)],
        addCookingRecord: [{ outcome: 'recorded' }],
      },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    fireEvent.click(cookedOperation());
    await waitForRecordNotice();
    fireEvent.click(closeDetailOperation());

    // 切り替えが出ている＝取れた一覧を描いている（読み込み中には出ない）。
    await waitFor(() => {
      expect(columnToggles()).toHaveLength(2);
      expect(screen.queryByText(NIKUJAGA)).toBeNull();
    });
  });

  it('調理記録が通ると、その献立はつくった列に出る', async () => {
    // 規則12 / FR-29
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA]), listed([], [mealA])],
        show: [shownMealOf('meal-a', DETAIL)],
        addCookingRecord: [{ outcome: 'recorded' }],
      },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    fireEvent.click(cookedOperation());
    await waitForRecordNotice();
    fireEvent.click(closeDetailOperation());
    await waitFor(() => {
      expect(columnToggles()).toHaveLength(2);
      expect(screen.queryByText(NIKUJAGA)).toBeNull();
    });

    switchColumn();

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
  });

  it('調理記録が断られた回は、履歴を取り直さない', async () => {
    // 規則12: 取り直すのは通った回だけである。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA]), listed([mealB])],
        show: [shownMealOf('meal-a', DETAIL)],
        addCookingRecord: [{ outcome: 'rejected', rule: 'addCookingRecord.mealNotFound' }],
      },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    fireEvent.click(cookedOperation());
    await waitForRecordNotice();
    fireEvent.click(closeDetailOperation());

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
    expect(screen.queryByText(GINGER_PORK)).toBeNull();
  });

  it('調理記録が通っても、在庫一覧を取り直さない', async () => {
    // 規則13 / C-8: 「作った」を記録しても在庫は減らない。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot), loaded(chineseCabbage)] },
      {},
      {},
      {
        list: [listed([mealA])],
        show: [shownMealOf('meal-a', DETAIL)],
        addCookingRecord: [{ outcome: 'recorded' }],
      },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    fireEvent.click(cookedOperation());
    await waitForRecordNotice();

    openPantry();

    expect(await screen.findByText(carrot.name)).not.toBeNull();
    expect(screen.queryByText(chineseCabbage.name)).toBeNull();
  });

  it('調理記録が通っても、保存済みの提案を取り直さない', async () => {
    // 規則13: 取り直すのは履歴だけである。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne('meal-s', SUGGESTED), suggestedOne('meal-t', ANOTHER_SUGGESTED)] },
      {},
      {
        list: [listed([mealA])],
        show: [shownMealOf('meal-a', DETAIL)],
        addCookingRecord: [{ outcome: 'recorded' }],
      },
    );

    await screen.findByText(SUGGESTED);
    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    fireEvent.click(cookedOperation());
    await waitForRecordNotice();

    fireEvent.click(mealsTab());

    expect(await screen.findByText(SUGGESTED)).not.toBeNull();
    expect(screen.queryByText(ANOTHER_SUGGESTED)).toBeNull();
  });

  it('履歴から開いた詳細で記録が通っても、詳細は開いたままである', async () => {
    // 規則13 / B-53 規則11: 履歴を取り直しても詳細は閉じない。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA])],
        show: [shownMealOf('meal-a', DETAIL)],
        addCookingRecord: [{ outcome: 'recorded' }],
      },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    fireEvent.click(cookedOperation());
    await waitForRecordNotice();

    expect(screen.queryByText(DETAIL)).not.toBeNull();
    expect(screen.queryByText(NIKUJAGA)).toBeNull();
  });

  it('新しい献立が届くと、履歴を取り直して新しい献立が以前見た列に出る', async () => {
    // 規則12 / FR-28: 生成された献立は、表示された時点で「以前見た献立」になる。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { requestNewMeals: [newSuggestion('meal-n', NEW_MEAL)] },
      {},
      { list: [listed([mealA]), listed([summaryOf('meal-n', NEW_MEAL), mealA])] },
    );

    await screen.findByRole('button');
    fireEvent.click(screen.getAllByRole('button').at(-1) as HTMLElement);
    await screen.findByText(NEW_MEAL);

    openHistory();

    expect(await screen.findByText(NEW_MEAL)).not.toBeNull();
  });

  it('在庫が足りない結末では、履歴を取り直さない', async () => {
    // 規則12 / 設計 10章 前提4: 生成が起きず献立は増えない。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {
        show: [suggestedOne('meal-s', SUGGESTED)],
        requestNewMeals: [{ outcome: 'insufficientStockItems' }],
      },
      {},
      { list: [listed([mealA]), listed([mealB])] },
    );

    await screen.findByText(SUGGESTED);
    fireEvent.click(screen.getAllByRole('button').at(-1) as HTMLElement);
    await waitFor(() => {
      expect(screen.queryByText(SUGGESTED)).toBeNull();
    });

    openHistory();

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
    expect(screen.queryByText(GINGER_PORK)).toBeNull();
  });

  it('生成の上限に達した結末では、履歴を取り直さない', async () => {
    // 規則12 / 設計 10章 前提4
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {
        show: [suggestedOne('meal-s', SUGGESTED)],
        requestNewMeals: [{ outcome: 'generationLimitReached' }],
      },
      {},
      { list: [listed([mealA]), listed([mealB])] },
    );

    await screen.findByText(SUGGESTED);
    fireEvent.click(screen.getAllByRole('button').at(-1) as HTMLElement);
    await waitFor(() => {
      expect(screen.queryByText(SUGGESTED)).toBeNull();
    });

    openHistory();

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
    expect(screen.queryByText(GINGER_PORK)).toBeNull();
  });

  it('新しい献立を求めて失敗した回は、履歴を取り直さない', async () => {
    // 規則12 / 設計 10章 前提4
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne('meal-s', SUGGESTED)], requestNewMeals: [{ outcome: 'failed' }] },
      {},
      { list: [listed([mealA]), listed([mealB])] },
    );

    await screen.findByText(SUGGESTED);
    fireEvent.click(screen.getAllByRole('button').at(-1) as HTMLElement);
    await waitFor(() => {
      expect(screen.getAllByRole('status')).toHaveLength(1);
    });

    openHistory();

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
    expect(screen.queryByText(GINGER_PORK)).toBeNull();
  });

  it('取り直している間は、前の行を出さない', async () => {
    // 規則14: 効果の頭で「読み込み中」にする（先行 B-22 規則10）。
    const { meals } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA]), { heldUntilSettled: listed([mealB]) }],
        show: [shownMealOf('meal-a', DETAIL)],
        addCookingRecord: [{ outcome: 'recorded' }],
      },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    fireEvent.click(cookedOperation());
    await waitForRecordNotice();
    fireEvent.click(closeDetailOperation());

    expect(screen.queryByText(NIKUJAGA)).toBeNull();
    expect(screen.queryByText(GINGER_PORK)).toBeNull();

    await settleMeals(meals);
  });

  it('遅れて届いた古い取得は、後から取り直した履歴を上書きしない', async () => {
    // 規則14: 効果が解除されたら結果を捨てる。
    const { session, meals } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [{ heldUntilSettled: listed([mealA]) }, listed([mealB])] },
    );

    emit(session, 'signedOut');
    emit(session, 'signedIn');
    openHistory();
    await screen.findByText(GINGER_PORK);

    await settleMeals(meals);

    expect(screen.queryByText(GINGER_PORK)).not.toBeNull();
    expect(screen.queryByText(NIKUJAGA)).toBeNull();
  });

  it('サインアウトしている間は、前の世帯の行を画面に残さない', async () => {
    // 規則15 / NFR-09 / C-9
    const { session } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA])],
      },
    );

    openHistory();
    await screen.findByText(NIKUJAGA);
    emit(session, 'signedOut');

    expect(screen.queryByText(NIKUJAGA)).toBeNull();
  });

  it('サインアウトして入り直すと取り直し、前の世帯の行を出さない', async () => {
    // 規則15 / NFR-09 / C-9
    const { session } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA]), listed([mealB])],
      },
    );

    openHistory();
    await screen.findByText(NIKUJAGA);
    emit(session, 'signedOut');
    emit(session, 'signedIn');
    openHistory();

    expect(await screen.findByText(GINGER_PORK)).not.toBeNull();
    expect(screen.queryByText(NIKUJAGA)).toBeNull();
  });

  // --- 詳細の出どころと戻り先（規則6・9〜11、7章 行2） ---

  it('履歴の行の開く操作を押すと、その献立を取りに行って履歴タブに詳細を出す', async () => {
    // 規則8・11 / FR-30
    const { meals } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([summaryOf('m1', NIKUJAGA)])],
        show: [shownMealOf('m1', DETAIL)],
      },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);

    expect(await screen.findByText(DETAIL)).not.toBeNull();
    expect(meals.shownMealIds).toEqual(['m1']);
  });

  it('履歴から開いた詳細を閉じると、履歴の一覧に戻る', async () => {
    // 規則9 / 画面設計 2.3: 戻り先は開いたタブの一覧である。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA])],
        show: [shownMealOf('meal-a', DETAIL)],
      },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    fireEvent.click(closeDetailOperation());

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
  });

  it('履歴から開いた詳細は、献立タブには出ない', async () => {
    // 規則9: 詳細は出どころのタブにだけ描く。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne('meal-s', SUGGESTED)] },
      {},
      { list: [listed([mealA])], show: [shownMealOf('meal-a', DETAIL)] },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    fireEvent.click(mealsTab());

    expect(await screen.findByText(SUGGESTED)).not.toBeNull();
    expect(screen.queryByText(DETAIL)).toBeNull();
  });

  it('履歴から開いた詳細は、タブを移って戻っても開いたままである', async () => {
    // 規則9 / ADR-066: 開いた献立は門が持つ。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne('meal-s', SUGGESTED)] },
      {},
      { list: [listed([mealA])], show: [shownMealOf('meal-a', DETAIL)] },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    fireEvent.click(mealsTab());
    await screen.findByText(SUGGESTED);
    openHistory();

    expect(await screen.findByText(DETAIL)).not.toBeNull();
  });

  it('献立タブから開いた詳細は、履歴タブには出ない', async () => {
    // 規則9
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne('meal-s', SUGGESTED)] },
      {},
      { list: [listed([mealA])], show: [shownMealOf('meal-s', DETAIL)] },
    );

    await openCard();
    await screen.findByText(DETAIL);
    openHistory();

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
    expect(screen.queryByText(DETAIL)).toBeNull();
  });

  it('献立タブで詳細を開いたまま履歴から別の献立を開くと、献立タブにはカードが出る', async () => {
    // 規則10: 開いている献立は1つで、出どころごと置き換わる。
    const MEALS_TAB_DETAIL = '献立タブの詳細';
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne('m1', SUGGESTED)] },
      {},
      {
        list: [listed([summaryOf('m2', NIKUJAGA)])],
        show: [shownMealOf('m1', MEALS_TAB_DETAIL), shownMealOf('m2', DETAIL)],
      },
    );

    await openCard();
    await screen.findByText(MEALS_TAB_DETAIL);
    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    fireEvent.click(mealsTab());

    expect(await screen.findByText(SUGGESTED)).not.toBeNull();
    expect(screen.queryByText(MEALS_TAB_DETAIL)).toBeNull();
  });

  it('献立タブで記録したあと履歴から別の献立を開くと、前の記録の結末は残らない', async () => {
    // 規則10 / 先行 B-53 規則12: 記録の案内は「いまの1回」の結末である。
    const MEALS_TAB_DETAIL = '献立タブの詳細';
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne('m1', SUGGESTED)] },
      {},
      {
        list: [listed([summaryOf('m2', NIKUJAGA)])],
        show: [shownMealOf('m1', MEALS_TAB_DETAIL), shownMealOf('m2', DETAIL)],
        addCookingRecord: [{ outcome: 'recorded' }],
      },
    );

    await openCard();
    await screen.findByText(MEALS_TAB_DETAIL);
    fireEvent.click(cookedOperation());
    await waitForRecordNotice();
    const noticesWhileRecorded = screen.queryAllByRole('status').length;

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);

    expect(screen.queryAllByRole('status').length).toBeLessThan(noticesWhileRecorded);
  });

  it('履歴から開いた詳細で記録の操作を押すと、その献立に記録を足す', async () => {
    // 規則11 / FR-22: 献立タブから開いたものと同じ口で記録する。
    const { meals } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([summaryOf('m1', NIKUJAGA)])],
        show: [shownMealOf('m1', DETAIL)],
        addCookingRecord: [{ outcome: 'recorded' }],
      },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    fireEvent.click(cookedOperation());

    await waitFor(() => {
      expect(meals.recordedMealIds).toEqual(['m1']);
    });
  });

  it('履歴から同じ献立を開き直すと、取り直した詳細が出る', async () => {
    // 規則11 / FR-32: 充足は開いた時点の在庫で算出されたものでなければならない。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA])],
        show: [shownMealOf('meal-a', '前の詳細'), shownMealOf('meal-a', '取り直した詳細')],
      },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText('前の詳細');
    fireEvent.click(closeDetailOperation());
    await openHistoryRow(NIKUJAGA);

    expect(await screen.findByText('取り直した詳細')).not.toBeNull();
  });

  it('履歴から開いた献立が断られても、閉じると履歴の一覧に戻る', async () => {
    // 7章 行2 / B-53: 断られた回も閉じる操作は残る。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA])],
        show: [{ outcome: 'rejected', rule: 'showMeal.mealNotFound' }],
      },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await waitFor(() => {
      expect(screen.getAllByRole('status')).toHaveLength(1);
    });
    // 断られた回の詳細に出ている操作は「閉じる」の1つだけである（記録の操作は取れた枝にだけ）。
    fireEvent.click(operationAt(0, 1));

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
  });

  it('サインアウトすると、履歴から開いた詳細も閉じる', async () => {
    // 規則15 / NFR-09
    const { session } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA])],
        show: [shownMealOf('meal-a', DETAIL)],
      },
    );

    openHistory();
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    emit(session, 'signedOut');
    emit(session, 'signedIn');
    openHistory();

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
    expect(screen.queryByText(DETAIL)).toBeNull();
  });

  it('つくった側を選んでから別のタブへ移って戻ると、以前見た献立の列に戻る', async () => {
    // 規則6: 器は選んだタブしか描かないので、列の選択はタブを移ると初期に戻る。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA], [mealC])],
      },
    );

    openHistory();
    await screen.findByText(NIKUJAGA);
    switchColumn();
    await screen.findByText(STIR_FRY);
    fireEvent.click(mealsTab());
    openHistory();

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
    expect(screen.queryByText(STIR_FRY)).toBeNull();
  });
});

/**
 * 門 `App` の設定（B-56c 設計 6章 規則1・8〜13 / 7章 / ADR-066）。
 *
 * 設定画面の中の判断（操作が2つ・確認を挟まない・送っている間）は `SettingsScreen.test.tsx`、
 * 入口の置き方と描き分けは `HistoryTab.test.tsx` が押さえており、**ここで二重に書かない。**
 * ここで観るのは門の結線だけ — 設定を開いているかを門が持つこと、ログアウトへの経路が
 * 設定画面の1つだけであること、である。
 *
 * **仮の文言を期待値に書かない**（設計 10章 前提4）。入口は「`aria-pressed` を持たず、
 * `listitem` の中にも無い `button`」で引き、設定画面の2つの操作は文書順の位置で引く
 * （閉じるが先・ログアウトが後。設計 規則6）。
 */
describe('門 App の設定', () => {
  const NIKUJAGA = '肉じゃが';
  const GINGER_PORK = '豚こま肉と白菜の生姜焼き';
  const STIR_FRY = 'にんじんと卵の炒めもの';
  const NEW_MEAL = '新しいご飯';
  /** 献立タブのカードに出る名称。 */
  const SUGGESTED = '提案の献立';

  /** 設定画面に出ている操作は2つ（閉じる／ログアウト）である（設計 規則6）。 */
  const SETTINGS_OPERATION_COUNT = 2;

  function summaryOf(mealId: string, title: string): MealSummaryOutput {
    return { mealId, title, ingredientCount: 2 };
  }

  const mealA = summaryOf('meal-a', NIKUJAGA);
  const mealB = summaryOf('meal-b', GINGER_PORK);
  const mealC = summaryOf('meal-c', STIR_FRY);

  function listed(
    seen: readonly MealSummaryOutput[],
    cooked: readonly MealSummaryOutput[] = [],
  ): MealListOutcome {
    return { outcome: 'loaded', meals: { seen: [...seen], cooked: [...cooked] } };
  }

  /** 提案が1件出ている状態。 */
  function suggestedOne(mealId: string, title: string): LatestSuggestionOutcome {
    return {
      outcome: 'suggested',
      pantryChanged: false,
      suggestion: {
        id: `suggestion-${mealId}`,
        generatedAt: '2026-09-20T09:00:00.000Z',
        entries: [
          {
            mealId,
            origin: 'reused',
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
  function newSuggestion(mealId: string, title: string): RequestNewMealsOutcome {
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

  function openHistory(): void {
    fireEvent.click(historyTab());
  }

  /**
   * 設定への入口。**`aria-pressed` を持たず、`listitem` の中にも無い `button`** である
   * （B-56c 規則4）。**先に1つだけであることを確かめる。**
   */
  function settingsEntry(): HTMLElement {
    const entries = screen
      .queryAllByRole('button')
      .filter((button) => !button.hasAttribute('aria-pressed') && button.closest('li') === null);
    expect(entries).toHaveLength(1);

    const [entry] = entries;
    if (entry === undefined) throw new Error('設定への入口が無い');

    return entry;
  }

  /** 履歴タブで行が出るのを待ってから、設定への入口を押す。 */
  async function openSettingsFromHistory(): Promise<void> {
    openHistory();
    await screen.findByText(NIKUJAGA);
    fireEvent.click(settingsEntry());
  }

  function closeSettingsOperation(): HTMLElement {
    return operationAt(0, SETTINGS_OPERATION_COUNT);
  }

  function signOutOperation(): HTMLElement {
    return operationAt(1, SETTINGS_OPERATION_COUNT);
  }

  /** 押されていない側の列へ切り替える。**先に1つだけであることを確かめる。** */
  function switchColumn(): void {
    const toggles = screen.getAllByRole('button', { pressed: false });
    expect(toggles).toHaveLength(1);

    const [toggle] = toggles;
    if (toggle === undefined) throw new Error('押されていない切り替えが無い');

    fireEvent.click(toggle);
  }

  it('履歴タブの入口を押すと、履歴の行の代わりに設定画面が出る', async () => {
    // 規則1 / `docs/screen-design.md` 2.1: 入口は履歴タブの右上にある。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA])],
      },
    );

    await openSettingsFromHistory();

    expect(screen.queryByText(NIKUJAGA)).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(SETTINGS_OPERATION_COUNT);
  });

  it('設定画面のログアウトを押すと、ログインの画面へ戻る', async () => {
    // 規則12 / FR-25 / `docs/screen-design.md` 2.1 / 設計 7章 行1 / `Session.ts` 規則8:
    // ログアウトへの経路は設定画面の1つだけである。手元のセッションは必ず捨てられ、門は
    // その変化を受けて画面を切り替える。**ログアウトを結線しているのは門である。**
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA])],
      },
    );

    await openSettingsFromHistory();
    fireEvent.click(signOutOperation());

    await waitFor(() => {
      expect(tabs()).toHaveLength(0);
    });
    expect(textboxes()).toHaveLength(1);
  });

  it('履歴が取れなかった回も、設定を開いてログアウトできる', async () => {
    // 規則2 / 設計 7章 行2 / FR-25: 履歴が取れなくてもログアウトへ届かなくなってはならない。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [{ outcome: 'failed' }],
      },
    );

    openHistory();
    // 取れなかった結末を画面へ流す（読み込み中にも入口はあるが、本題は取れなかった回である）。
    await act(async () => {});
    fireEvent.click(settingsEntry());
    fireEvent.click(signOutOperation());

    await waitFor(() => {
      expect(tabs()).toHaveLength(0);
    });
  });

  it('設定を閉じると、履歴の行が出る', async () => {
    // 規則8: 閉じると履歴タブの一覧へ戻る。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA])],
      },
    );

    await openSettingsFromHistory();
    fireEvent.click(closeSettingsOperation());

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
  });

  it('つくった側を選んでから設定を開いて閉じると、つくった列のままである', async () => {
    // 規則8 / B-54b 規則6: 設定を出している間も `HistoryTab` は mount されたままである。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA], [mealC])],
      },
    );

    openHistory();
    await screen.findByText(NIKUJAGA);
    switchColumn();
    await screen.findByText(STIR_FRY);
    fireEvent.click(settingsEntry());
    fireEvent.click(closeSettingsOperation());

    expect(await screen.findByText(STIR_FRY)).not.toBeNull();
    expect(screen.queryByText(NIKUJAGA)).toBeNull();
  });

  it('設定を開いて閉じても、履歴を取り直さない', async () => {
    // 規則11: 設定を開いても閉じても何も取りに行かない（履歴で代表する）。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA]), listed([mealB])],
      },
    );

    await openSettingsFromHistory();
    fireEvent.click(closeSettingsOperation());

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
    expect(screen.queryByText(GINGER_PORK)).toBeNull();
  });

  it('設定を開いたままタブを移って戻っても、設定のままである', async () => {
    // 規則9 / ADR-066: 設定を開いているかは門が持ち、タブの移動では閉じない。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA])],
      },
    );

    await openSettingsFromHistory();
    openPantry();
    await screen.findByText(carrot.name);
    openHistory();

    expect(screen.queryByText(NIKUJAGA)).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(SETTINGS_OPERATION_COUNT);
  });

  it('設定を開いたまま献立タブへ移ると、献立タブには設定を出さない', async () => {
    // 規則1 / `docs/screen-design.md` 2.1: 設定を描くのは履歴タブだけである。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne('meal-s', SUGGESTED)] },
      {},
      { list: [listed([mealA])] },
    );

    await openSettingsFromHistory();
    fireEvent.click(mealsTab());

    expect(await screen.findByText(SUGGESTED)).not.toBeNull();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('サインアウトして入り直すと、設定は閉じて履歴の行が出る', async () => {
    // 規則10 / ADR-066 結果1 / NFR-09: 門は signedOut の間も生きているので、明示的に閉じる。
    const { session } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA]), listed([mealA])],
      },
    );

    await openSettingsFromHistory();
    emit(session, 'signedOut');
    emit(session, 'signedIn');
    openHistory();

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
  });

  it('設定を開いている間に新しい献立が届いて履歴を取り直しても、設定は閉じない', async () => {
    // 規則11: 取り直しでは設定を閉じない。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { requestNewMeals: [newSuggestion('meal-n', NEW_MEAL)] },
      {},
      { list: [listed([mealA]), listed([mealB])] },
    );

    await openSettingsFromHistory();
    fireEvent.click(mealsTab());
    await screen.findByRole('button');
    // 「新しい献立を求める」は献立タブの末尾の操作である（D-4）。
    fireEvent.click(screen.getAllByRole('button').at(-1) as HTMLElement);
    await screen.findByText(NEW_MEAL);
    openHistory();
    await act(async () => {});

    expect(screen.getAllByRole('button')).toHaveLength(SETTINGS_OPERATION_COUNT);
    expect(screen.queryByText(NIKUJAGA)).toBeNull();
    expect(screen.queryByText(GINGER_PORK)).toBeNull();
  });

  it('設定を開いている間に在庫の登録が通って一覧を取り直しても、設定は閉じない', async () => {
    // 規則11: 取り直しでは設定を閉じない。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot), loaded(chineseCabbage)], register: [{ outcome: 'registered' }] },
      {},
      {},
      { list: [listed([mealA])] },
    );

    await openSettingsFromHistory();
    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(openRegisterOperation());
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    fireEvent.click(saveAndCloseOperation());
    await screen.findByText(chineseCabbage.name);
    openHistory();

    expect(screen.getAllByRole('button')).toHaveLength(SETTINGS_OPERATION_COUNT);
    expect(screen.queryByText(NIKUJAGA)).toBeNull();
  });

  it('設定を開いている間も、下タブ3つは出ている', async () => {
    // 規則13 / NFR-14: 下タブの帯は出したまま。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA])],
      },
    );

    await openSettingsFromHistory();

    expect(tabs()).toHaveLength(3);
  });

  it('在庫の一覧に出る操作は、登録を開く1つだけである', async () => {
    // 規則12 / ADR-046 結果4 の暫定を解く: 在庫タブにログアウトを置かない。
    renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] });

    openPantry();
    await screen.findByText(carrot.name);

    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('在庫の登録の画面に出る操作は、閉じると保存2つの3つだけである', async () => {
    // 規則12: 登録の画面にもログアウトを置かない。
    renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] });

    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement);

    expect(screen.getAllByRole('button')).toHaveLength(3);
  });
});
