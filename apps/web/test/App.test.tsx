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
 * - **操作** … 帯（`navigation`）の外の `button` を**文書順の位置**で引き、**先に件数を確かめる**
 *   （帯には「設定」の `button` が常にある。B-60 規則4）
 *
 * **`vi.fn()` で呼び出し回数を数えない**（`docs/testing.md` 2章 / 設計 規則5）。差し替えは
 * `FixedSession` と `FixedStockItemRequests` である。**素で描く**（`<StrictMode>` を被せない。
 * 設計 規則13）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CookedMealSummaryOutput,
  SeenMealSummaryOutput,
  StockItemDto,
} from '@fridge-to-meal/contract';
import { act, fireEvent, render, screen, waitFor, within } from './support/dom/renderComponent.js';
import { installPointerCapture } from './support/dom/pointerCapture.js';
import { pressOperation } from './support/dom/pressOperation.js';
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
import { FixedHouseholdDataRequests } from './support/server/FixedHouseholdDataRequests.js';
import type { FixedHouseholdDataRequestsOptions } from './support/server/FixedHouseholdDataRequests.js';
import { FixedConnectivity } from './support/connectivity/FixedConnectivity.js';
import { FixedBackNavigation } from './support/backNavigation/FixedBackNavigation.js';
import type { FixedConnectivityOptions } from './support/connectivity/FixedConnectivity.js';
import { App } from '../src/App.js';
import { BackNavigationProvider } from '../src/backNavigation/BackHandler.js';
import type { SessionState } from '../src/session/Session.js';
import type { ConnectivityState } from '../src/connectivity/Connectivity.js';
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
  return { id, name, ingredientId: null, amount: null, expiryDate: null, useForMeals: true };
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
  householdDataOptions: FixedHouseholdDataRequestsOptions = {},
  connectivityOptions: FixedConnectivityOptions = {},
  backNavigation?: FixedBackNavigation,
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

  // **既定は台本を持たない**（B-56f）。削除は確認を経なければ送られないので（規則4）、削除が
  // 本題でない観点では呼ばれる口が無い。呼ばれたら落ちる。
  const householdData = new FixedHouseholdDataRequests(householdDataOptions);

  // **既定は接続している状態**（B-70）。接続が本題でない観点は、これまでどおり何も止まらない。
  const connectivity = new FixedConnectivity(connectivityOptions);

  const app = (
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
      deleteHouseholdData={householdData.deleteHouseholdData}
      connectivity={connectivity}
    />
  );

  // 端末の戻るを観る観点（B-75）だけが継ぎ目を渡し、provider で包む。**渡さない観点は
  // 素で描く** — provider の無い木でも描けること（B-75 規則10）に頼っている。
  render(
    backNavigation === undefined ? (
      app
    ) : (
      <BackNavigationProvider backNavigation={backNavigation}>{app}</BackNavigationProvider>
    ),
  );

  return { session, requests, suggestions, ingredientNames, meals, householdData, connectivity };
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
 * 見出しの行の歯車（B-60 設計 6章 規則12・13）として数えるもの。**帯（`navigation`）の外にあり、
 * 名前が `設定` の `button`** である — 帯の「設定」も同じ名前を持つため、置き場で絞る（同 8章）。
 * 名前は原本から取った文言で仮ではない（ADR-074 決定1）。
 */
function headerSettingsButtons(): HTMLElement[] {
  const navigation = screen.queryByRole('navigation');

  return screen
    .queryAllByRole('button', { name: '設定' })
    .filter((operation) => navigation === null || !navigation.contains(operation));
}

/** 見出しの行の歯車。**先に1つだけであることを確かめる。** */
function headerSettings(): HTMLElement {
  const gears = headerSettingsButtons();
  expect(gears).toHaveLength(1);

  const [gear] = gears;
  if (gear === undefined) throw new Error('見出しの歯車が無い');

  return gear;
}

/**
 * 帯（`navigation`）の外にある操作を**文書順**で引く（B-60）。帯には「設定」の `button` が
 * 常にあるので（B-60 規則4）、画面の中身の操作を数えるときは帯の外に絞る。**見出しの歯車も
 * 数えない**（`headerSettingsButtons`。B-60 規則12）— 一覧の先頭に結末によらず置かれるので、
 * 数えると画面ごとの操作の数と位置が崩れる。**帯が無い画面（ログインの画面）では、画面の
 * すべての操作である。**
 */
function contentOperations(): HTMLElement[] {
  const navigation = screen.queryByRole('navigation');
  const gears = headerSettingsButtons();

  return screen
    .queryAllByRole('button')
    .filter((operation) => navigation === null || !navigation.contains(operation))
    .filter((operation) => !gears.includes(operation));
}

/**
 * 帯の外の操作が**ちょうど1つ**出るのを待って返す（`screen.findByRole('button')` を帯の外に
 * 絞ったもの。複数あるうちは待ち続ける点も同じ）。
 */
async function findSoleContentOperation(): Promise<HTMLElement> {
  return waitFor(() => {
    const [operation, ...rest] = contentOperations();
    if (operation === undefined || rest.length > 0) {
      throw new Error('帯の外の操作がちょうど1つ出ている状態ではない');
    }

    return operation;
  });
}

/**
 * 帯の「設定」（B-60 規則4・7）。**帯（`navigation`）の中で名前で引く** — 見出しの歯車も同じ名前
 * 「設定」を持つため、置き場で絞る（B-60 設計 8章）。文言は原本から取ったもので仮ではない
 * （ADR-074 決定1）。
 */
function navigationSettings(): HTMLElement {
  return within(screen.getByRole('navigation')).getByRole('button', { name: '設定' });
}

/**
 * 押せる操作を**文書順**で引く。**先に件数を確かめる**（設計 7章 行2）— 崩れた回に別の操作を
 * 押してしまうと、テストは何が壊れたか読めない形で落ちる。**名札は見ない**（設計 規則2）。
 *
 * **下タブは混ざらない。** 帯のタブは `role="tab"` を明示しており、この問い合わせに
 * 引っかからない（先行 `PantryTab.test.tsx`）。**帯の「設定」も混ざらない** — 帯の外に絞って
 * 引く（`contentOperations`。B-60）。
 */
function operationAt(index: number, expectedCount: number): HTMLElement {
  const operations = contentOperations();
  expect(operations).toHaveLength(expectedCount);

  const found = operations.at(index);
  if (found === undefined) throw new Error(`${index} 番目の操作が無い`);

  return found;
}

/**
 * 在庫の一覧に出ている操作は、行ごとの `…` を除けば1つ（登録を開く）である。**ログアウトは
 * 在庫タブに置かない**（B-56c 規則12 — ログアウトへの経路は設定画面の1つだけ）。行ごとの `…`
 * は `aria-expanded` を持つ開閉ボタンであり（B-69 設計 規則3）、数えるときはそれで除く。
 */
const LIST_OPERATION_COUNT = 1;

/** 行ごとの `…`（B-69 設計 規則3）を除いた、在庫の一覧の操作を文書順に。 */
function listOperations(): readonly HTMLElement[] {
  return contentOperations().filter((button) => !button.hasAttribute('aria-expanded'));
}

/** 行ごとの `…`（B-69 設計 規則3）を文書順に。 */
function rowOperationToggles(): readonly HTMLElement[] {
  return contentOperations().filter((button) => button.hasAttribute('aria-expanded'));
}

function openRegisterOperation(): HTMLElement {
  const operations = listOperations();
  expect(operations).toHaveLength(LIST_OPERATION_COUNT);

  const [found] = operations;
  if (found === undefined) throw new Error('登録を開く操作が無い');

  return found;
}

/**
 * 登録・編集の画面の操作は**名前で引く**（B-65b）。パネルを出している間も一覧の側（`食材を追加`・
 * 行の `…`）が木に残り、`戻る` の隣に `閉じる` も並ぶので、文書順の位置では引けない。名前は原本から
 * 取った文言で仮ではない（ADR-074 決定1）。
 */
function namedOperation(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

/** 保存せずに閉じる操作（アイコンの `戻る`。B-65 規則2）。 */
function closeRegisterOperation(): HTMLElement {
  return namedOperation('戻る');
}

function saveAndStayOperation(): HTMLElement {
  return namedOperation('保存してもう1件');
}

function saveAndCloseOperation(): HTMLElement {
  return namedOperation('保存して閉じる');
}

/**
 * 食材名の欄。**`role="combobox"` を明示しているため役割は `combobox` である**（B-50c /
 * B-66 設計 規則13）— 補完が0件の回も欄はこの役割のままである。
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

/**
 * 行を消す — **なぞる → 現れた削除を押す → 確認の削除を押す**の3つを1つにしたもの
 * （FR-06 / B-69 設計 規則1・6・11）。なぞっただけでは消えない。
 *
 * **判断は `SwipeGesture.ts` と `PantryList` の持ち分**で、ここは入力を送るだけである。
 * 現れた削除は行の中の `aria-expanded` を持たない button、確認の削除は `role="dialog"` の中の
 * 2つめの button である（同 規則8）。
 */
function deleteSoleRow(): void {
  const row = soleRow();

  fireEvent.pointerDown(row, { pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(row, { pointerId: 1, clientX: 100, clientY: 0 });

  const revealed = within(soleRow())
    .getAllByRole('button')
    .filter((button) => !button.hasAttribute('aria-expanded'));
  expect(revealed).toHaveLength(1);
  const [revealedDelete] = revealed;
  if (revealedDelete === undefined) throw new Error('行に削除が現れていない');
  pressOperation(revealedDelete);

  const confirmation = within(screen.getByRole('dialog')).getAllByRole('button');
  expect(confirmation).toHaveLength(2);
  const confirmDelete = confirmation.at(1);
  if (confirmDelete === undefined) throw new Error('確認に削除が無い');
  pressOperation(confirmDelete);
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

  it('行の削除を確かめて消えたら、一覧を取り直す', async () => {
    renderApp(
      { initialState: 'signedIn' },
      {
        list: [loaded(carrot), loaded(chineseCabbage)],
        remove: [{ outcome: 'deleted' }],
      },
    );

    openPantry();
    await screen.findByText(carrot.name);
    deleteSoleRow();

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
    deleteSoleRow();

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
    deleteSoleRow();

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
  afterEach(() => {
    vi.useRealTimers();
  });

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
    const operations = contentOperations();
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

    await findSoleContentOperation();
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

    await findSoleContentOperation();
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

    // B-62 規則9: 失敗の帯の文言は原本の「案内の帯」から取ったもので、待つ条件に使ってよい。
    await screen.findByText('献立を作れませんでした。もう一度お試しください', { exact: false });
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
    expect(contentOperations()).toHaveLength(0);
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

  it('生成中に在庫タブへ移って戻っても、生成中のまま見える', async () => {
    // B-62 規則12 / D-6 / NFR-04: 器は選んでいないタブを木から外すので、送信中かどうかは門が持つ。
    const { suggestions } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { requestNewMeals: [{ heldUntilSettled: newSuggestion('meal-new', NEW_MEAL) }] },
    );

    await findSoleContentOperation();
    fireEvent.click(requestNewMealsOperation());
    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(mealsTab());

    expect(screen.getByText('考えています…')).not.toBeNull();
    expect(screen.queryByText(/秒$/)).toBeNull();

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
    deleteSoleRow();
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
   * 待つ条件は**S-4 の主文が出ること**である（B-62 規則14）。文言は原本 `MealScreen` の
   * state=short から取ったもので、仮ではない（ADR-074）。
   */
  async function renderAtInsufficientStockItems() {
    const app = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [{ outcome: 'none' }], requestNewMeals: [{ outcome: 'insufficientStockItems' }] },
    );

    fireEvent.click(await findSoleContentOperation());
    await screen.findByText('冷蔵庫にあるものを');

    return app;
  }

  /** 在庫タブへ送る操作。S-4 の枝が出す唯一の操作である（D-7 / B-49c 規則1・2）。 */
  function goToPantryOperation(): HTMLElement {
    return operationAt(0, 1);
  }

  it('サインイン済みになった直後に開いているのは献立タブである', async () => {
    renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] });

    await findSoleContentOperation();

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
    expect(contentOperations()).toHaveLength(1);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryAllByRole('note')).toHaveLength(0);
  });

  it('サインアウトして入り直すと、開いているのは既定の献立タブに戻る', async () => {
    const { session } = renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] });

    await findSoleContentOperation();
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
   * 編集の画面に出ている操作は、保存せずに閉じる2つ（`戻る` / `閉じる`。B-65b 規則9）を除けば
   * 保存の1つである。下タブは `role="tab"` なので混ざらない。**ログアウトは置かない**（B-56c 規則12。
   * 編集の画面の規則12 はこの件数で押さえる）。一覧の側はパネルを出している間も木に残るが
   * `inert` の中にあるので（B-65b 規則1・3）、数えない。
   */
  const EDIT_SAVE_OPERATION_COUNT = 1;

  /** 帯の外・`inert` の外にある操作のうち、保存せずに閉じる2つを除いたもの。 */
  function editPanelOperations(): readonly HTMLElement[] {
    const closes = [
      ...screen.queryAllByRole('button', { name: '戻る' }),
      ...screen.queryAllByRole('button', { name: '閉じる' }),
    ];

    return contentOperations()
      .filter((operation) => operation.closest('[inert]') === null)
      .filter((operation) => !closes.includes(operation));
  }

  /** 打った分量。**テストが渡した値**なので、一覧に出ていないことを当ててよい（設計 規則6）。 */
  const EDITED_AMOUNT = '300g';

  function closeEditOperation(): HTMLElement {
    return namedOperation('戻る');
  }

  function saveEditOperation(): HTMLElement {
    return namedOperation('保存');
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
    expect(editPanelOperations()).toHaveLength(EDIT_SAVE_OPERATION_COUNT);
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
    deleteSoleRow();

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

  /** 以前見た献立1件。**日時はどれも同じ日に置く** — 日の見出しはここの本題でない（ADR-083 決定2）。 */
  function seenOf(mealId: string, title: string): SeenMealSummaryOutput {
    return { mealId, title, ingredientCount: 2, generatedAt: '2026-10-03T03:00:00.000Z' };
  }

  /** 作った献立1件。日時の置き方は `seenOf` と同じ。 */
  function cookedOf(mealId: string, title: string): CookedMealSummaryOutput {
    return { mealId, title, ingredientCount: 2, cookedAt: '2026-10-03T03:30:00.000Z' };
  }

  const mealA = seenOf('meal-a', NIKUJAGA);
  const mealB = seenOf('meal-b', GINGER_PORK);
  const mealC = cookedOf('meal-c', STIR_FRY);
  /** 記録が通って「作った」へ移った献立 A（ADR-068 決定3）。 */
  const cookedMealA = cookedOf('meal-a', NIKUJAGA);

  function listed(
    seen: readonly SeenMealSummaryOutput[],
    cooked: readonly CookedMealSummaryOutput[] = [],
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
    return contentOperations().filter((button) => button.hasAttribute('aria-pressed'));
  }

  /** 押されていない側の列へ切り替える。**先に1つだけであることを確かめる。** */
  function switchColumn(): void {
    const toggles = screen.getAllByRole('button', { pressed: false });
    expect(toggles).toHaveLength(1);

    const [toggle] = toggles;
    if (toggle === undefined) throw new Error('押されていない切り替えが無い');

    fireEvent.click(toggle);
  }

  /** 日の見出し（`aria-expanded` を持つ操作。B-74 設計 規則10）を文書順に。 */
  function dayHeaders(): readonly HTMLElement[] {
    return contentOperations().filter((button) => button.hasAttribute('aria-expanded'));
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
    // 規則12 / FR-28・29: 記録で献立は「以前見た」から「作った」へ移る（ADR-068 決定3）。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA]), listed([], [cookedMealA])],
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

  it('調理記録が通ると、その献立は作った列に出る', async () => {
    // 規則12 / FR-29
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA]), listed([], [cookedMealA])],
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
      { list: [listed([mealA]), listed([seenOf('meal-n', NEW_MEAL), mealA])] },
    );

    await findSoleContentOperation();
    fireEvent.click(contentOperations().at(-1) as HTMLElement);
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
    fireEvent.click(contentOperations().at(-1) as HTMLElement);
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
    fireEvent.click(contentOperations().at(-1) as HTMLElement);
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
    fireEvent.click(contentOperations().at(-1) as HTMLElement);
    // B-62 規則9: 失敗の帯の文言（原本の「案内の帯」）で待つ。
    await screen.findByText('献立を作れませんでした。もう一度お試しください', { exact: false });

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
        list: [listed([seenOf('m1', NIKUJAGA)])],
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
        list: [listed([seenOf('m2', NIKUJAGA)])],
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
        list: [listed([seenOf('m2', NIKUJAGA)])],
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
        list: [listed([seenOf('m1', NIKUJAGA)])],
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

  it('作った側を選んでから別のタブへ移って戻ると、以前見た献立の列に戻る', async () => {
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

  it('履歴で日を畳んでから別のタブへ移って戻ると、すべての日が開いている', async () => {
    // B-74 設計 規則12 / ADR-083 決定4: 開閉は `HistoryTab` が持ち、保存しない。器は選んだタブ
    // しか描かないので、タブを移ると初めに戻る。日の見出しは日付の字面でなく `aria-expanded` で
    // 引く — 日付は端末の時刻帯で決まり、ここの本題ではない。
    const otherDayMealB: SeenMealSummaryOutput = {
      ...mealB,
      generatedAt: '2026-10-01T03:00:00.000Z',
    };
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      {
        list: [listed([mealA, otherDayMealB])],
      },
    );

    openHistory();
    await screen.findByText(NIKUJAGA);
    const [firstDay] = dayHeaders();
    if (firstDay === undefined) throw new Error('日の見出しが無い');
    fireEvent.click(firstDay);
    expect(firstDay.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(mealsTab());
    openHistory();
    await screen.findByText(NIKUJAGA);

    expect(dayHeaders().map((header) => header.getAttribute('aria-expanded'))).toEqual([
      'true',
      'true',
    ]);
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
 * **仮の文言を期待値に書かない**（設計 10章 前提4）。入口は帯の「設定」と見出しの歯車で、
 * どちらも原本から取った名前 `設定` で引く（B-60 規則4・12 / ADR-074 決定1）。設定画面の操作は
 * 文書順の位置で引く（閉じる・ログアウト・アカウントとデータの削除の順。B-56f 規則11）。
 */
describe('門 App の設定', () => {
  const NIKUJAGA = '肉じゃが';
  const GINGER_PORK = '豚こま肉と白菜の生姜焼き';
  const STIR_FRY = 'にんじんと卵の炒めもの';
  /** 献立タブのカードに出る名称。 */
  const SUGGESTED = '提案の献立';
  /** 献立詳細に出る名称（カードの名称と見分ける）。 */
  const DETAIL = '詳細の献立';

  /**
   * 確認の前に設定画面に出ている操作は3つ（閉じる／ログアウト／アカウントとデータの削除）である
   * （B-56f 規則11。B-56c 規則6 の「2つ」を置き換えた）。
   */
  const SETTINGS_OPERATION_COUNT = 3;
  /** 確認が出ている間の操作は4つ（閉じる／ログアウト／確かめる／やめる）である（B-56f 規則11）。 */
  const CONFIRMING_OPERATION_COUNT = 4;

  /** 以前見た献立1件。**日時はどれも同じ日に置く** — 日の見出しはここの本題でない（ADR-083 決定2）。 */
  function seenOf(mealId: string, title: string): SeenMealSummaryOutput {
    return { mealId, title, ingredientCount: 2, generatedAt: '2026-10-03T03:00:00.000Z' };
  }

  /** 作った献立1件。日時の置き方は `seenOf` と同じ。 */
  function cookedOf(mealId: string, title: string): CookedMealSummaryOutput {
    return { mealId, title, ingredientCount: 2, cookedAt: '2026-10-03T03:30:00.000Z' };
  }

  const mealA = seenOf('meal-a', NIKUJAGA);
  const mealB = seenOf('meal-b', GINGER_PORK);
  const mealC = cookedOf('meal-c', STIR_FRY);

  function listed(
    seen: readonly SeenMealSummaryOutput[],
    cooked: readonly CookedMealSummaryOutput[] = [],
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

  function openHistory(): void {
    fireEvent.click(historyTab());
  }

  /** 履歴タブで行が出るのを待ってから、帯の「設定」を押す（B-60 規則7）。 */
  async function openSettingsFromHistory(): Promise<void> {
    openHistory();
    await screen.findByText(NIKUJAGA);
    fireEvent.click(navigationSettings());
  }

  function closeSettingsOperation(): HTMLElement {
    return operationAt(0, SETTINGS_OPERATION_COUNT);
  }

  function signOutOperation(): HTMLElement {
    return operationAt(1, SETTINGS_OPERATION_COUNT);
  }

  /** 確認の前の3番目の操作（アカウントとデータの削除。B-56f 規則11）。 */
  function deleteOperation(): HTMLElement {
    return operationAt(2, SETTINGS_OPERATION_COUNT);
  }

  /** 確認が出ている間の3番目の操作（確かめる。B-56f 規則11）。 */
  function confirmDeletionOperation(): HTMLElement {
    return operationAt(2, CONFIRMING_OPERATION_COUNT);
  }

  /** 確認が出ている間の先頭の操作（閉じる。B-56f 規則11）。 */
  function closeWhileConfirmingOperation(): HTMLElement {
    return operationAt(0, CONFIRMING_OPERATION_COUNT);
  }

  /** 押されていない側の列へ切り替える。**先に1つだけであることを確かめる。** */
  function switchColumn(): void {
    const toggles = screen.getAllByRole('button', { pressed: false });
    expect(toggles).toHaveLength(1);

    const [toggle] = toggles;
    if (toggle === undefined) throw new Error('押されていない切り替えが無い');

    fireEvent.click(toggle);
  }

  it('帯の「設定」を押すと、献立タブの中身の代わりに設定画面が出る', async () => {
    // B-60 規則7: 設定は4つ目の行き先であり、選んでいたタブの中身と入れ替わる。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne('meal-s', SUGGESTED)] },
      {},
      { list: [listed([mealA])] },
    );

    await screen.findByText(SUGGESTED);
    fireEvent.click(navigationSettings());

    expect(screen.queryByText(SUGGESTED)).toBeNull();
    expect(contentOperations()).toHaveLength(SETTINGS_OPERATION_COUNT);
  });

  it.each<[string, () => Promise<void>, string]>([
    [
      '献立',
      async () => {
        await screen.findByText(SUGGESTED);
      },
      SUGGESTED,
    ],
    [
      '在庫',
      async () => {
        openPantry();
        await screen.findByText(carrot.name);
      },
      carrot.name,
    ],
    [
      '履歴',
      async () => {
        openHistory();
        await screen.findByText(NIKUJAGA);
      },
      NIKUJAGA,
    ],
  ])(
    '見出しの歯車を押すと、タブの中身の代わりに設定画面が出る（%s）',
    async (_label, showTab, shownInTab) => {
      // B-60 規則12 / 規則7: 3つのタブの見出しの歯車は、帯の「設定」と同じ行き先を開く。
      renderApp(
        { initialState: 'signedIn' },
        { list: [loaded(carrot)] },
        { show: [suggestedOne('meal-s', SUGGESTED)] },
        {},
        { list: [listed([mealA])] },
      );

      await showTab();
      fireEvent.click(headerSettings());

      expect(screen.queryByText(shownInTab)).toBeNull();
      expect(contentOperations()).toHaveLength(SETTINGS_OPERATION_COUNT);
    },
  );

  it('設定を開いている間は、どのタブも選ばれていると読めない', async () => {
    // B-60 規則7（原本 `TabBar active="none"`）。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
    );

    await openSettingsFromHistory();

    expect(tabs().filter((tab) => tab.getAttribute('aria-selected') === 'true')).toHaveLength(0);
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

  it('履歴が取れなかった回も、見出しの歯車から設定を開いてログアウトできる', async () => {
    // B-60 規則12 / B-56c 規則2 / FR-25: 履歴が取れなくてもログアウトへ届かなくなってはならない。
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
    // 取れなかった結末を画面へ流す（読み込み中にも歯車はあるが、本題は取れなかった回である）。
    await act(async () => {});
    fireEvent.click(headerSettings());
    fireEvent.click(signOutOperation());

    await waitFor(() => {
      expect(tabs()).toHaveLength(0);
    });
  });

  it('在庫タブから設定を開いて閉じると、在庫の一覧に戻る', async () => {
    // B-60 規則9 / ADR-066: 閉じると開く前に選んでいたタブに戻る。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
    );

    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(navigationSettings());
    fireEvent.click(closeSettingsOperation());

    expect(await screen.findByText(carrot.name)).not.toBeNull();
  });

  it('献立詳細を開いたまま設定を開いて閉じると、詳細に戻る', async () => {
    // B-60 規則9: 開閉で開いている献立（`openMeal`）を変えない。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne('meal-s', SUGGESTED)] },
      {},
      { list: [listed([mealA])], show: [offlineShownMeal('meal-s', DETAIL)] },
    );

    const card = (await screen.findAllByRole('listitem'))[0];
    if (card === undefined) throw new Error('カードが1枚も無い');
    fireEvent.click(within(card).getByRole('button'));
    await screen.findByText(DETAIL);
    fireEvent.click(navigationSettings());
    fireEvent.click(closeSettingsOperation());

    expect(await screen.findByText(DETAIL)).not.toBeNull();
  });

  it('作った側を選んでから設定を開いて閉じると、履歴は以前見た列に戻る', async () => {
    // B-60 規則10 / B-38 規則6: 設定を開くと選んでいたタブの中身は木から外れ、列の選択は
    // タブを移ったときと同じく初期（以前見た）に戻る（B-56c 規則8 の置き換え）。
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
    fireEvent.click(navigationSettings());
    fireEvent.click(closeSettingsOperation());

    expect(await screen.findByText(NIKUJAGA)).not.toBeNull();
    expect(screen.queryByText(STIR_FRY)).toBeNull();
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

  it('設定を開いたまま在庫タブを押すと、設定を閉じて在庫の一覧を出す', async () => {
    // B-60 規則8: 設定を開いている間にタブを押すと、設定を閉じてそのタブを出す
    // （B-56c 規則9「タブを移っても閉じない」の置き換え）。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
    );

    await openSettingsFromHistory();
    openPantry();

    expect(await screen.findByText(carrot.name)).not.toBeNull();
    expect(listOperations()).toHaveLength(LIST_OPERATION_COUNT);
  });

  it('設定を開いたまま、開く前に選んでいたタブを押しても、設定を閉じてそのタブの中身を出す', async () => {
    // B-60 規則8: 押したのが開く前に選んでいたタブでも同じ。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      { show: [suggestedOne('meal-s', SUGGESTED)] },
      {},
      { list: [listed([mealA])] },
    );

    await screen.findByText(SUGGESTED);
    fireEvent.click(navigationSettings());
    fireEvent.click(mealsTab());

    expect(await screen.findByText(SUGGESTED)).not.toBeNull();
  });

  it('設定を開いている間に帯の「設定」をもう一度押しても、設定のままである', async () => {
    // B-60 規則11: 開いているときに帯の「設定」を押しても何も変わらない。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
    );

    await openSettingsFromHistory();
    fireEvent.click(navigationSettings());

    expect(contentOperations()).toHaveLength(SETTINGS_OPERATION_COUNT);
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

  it('取得が届く前に設定を開いても、届いたあと設定は閉じない', async () => {
    // B-60 規則11 / B-56c 規則11: 結末が届いても設定を閉じない（取り直しでも同じ）。
    const { requests, suggestions, meals } = renderApp(
      { initialState: 'signedIn' },
      { list: [{ heldUntilSettled: loaded(carrot) }] },
      { show: [{ heldUntilSettled: suggestedOne('meal-s', SUGGESTED) }] },
      {},
      { list: [{ heldUntilSettled: listed([mealA]) }] },
    );

    fireEvent.click(navigationSettings());
    await settle(requests);
    await settleSuggestions(suggestions);
    await act(async () => {
      meals.settle();
    });

    expect(contentOperations()).toHaveLength(SETTINGS_OPERATION_COUNT);
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

  it('在庫の一覧に出る操作は、登録を開くものと行ごとの操作だけである', async () => {
    // 規則12 / ADR-046 結果4 の暫定を解く: 在庫タブにログアウトを置かない。
    // B-69 設計 規則3: 行ごとの `…`（`aria-expanded` を持つ）が行の数だけ足される。
    renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] });

    openPantry();
    await screen.findByText(carrot.name);

    expect(listOperations()).toHaveLength(1);
    expect(rowOperationToggles()).toHaveLength(1);
  });

  it('在庫の登録の画面に出る操作は、閉じる2つと保存2つの4つだけである', async () => {
    // 規則12: 登録の画面にもログアウトを置かない。
    // B-65b 規則1・3・9: 一覧の側は `inert` の中に残るので数えず、パネルの `戻る`・`閉じる`・保存2つを数える。
    renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] });

    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(screen.getByRole('button', { name: '食材を追加' }));

    expect(
      contentOperations().filter((operation) => operation.closest('[inert]') === null),
    ).toHaveLength(4);
  });
  it('削除を確かめて通ると、ログインの画面へ戻る', async () => {
    // B-56f 規則7 / ADR-071 結果2 / `Session.ts` 規則8: 消えた回は門がすぐにサインアウトし、
    // 門の状態が signedOut に移ってログインの画面が出る。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
      { delete: [{ outcome: 'deleted' }] },
    );

    await openSettingsFromHistory();
    fireEvent.click(deleteOperation());
    fireEvent.click(confirmDeletionOperation());

    await waitFor(() => {
      expect(tabs()).toHaveLength(0);
    });
    expect(textboxes()).toHaveLength(1);
  });

  it('削除を確かめて失敗すると、サインアウトせず設定画面に留まる', async () => {
    // B-56f 規則8 / 7章 / ADR-073 結果3: 失敗の回はサインアウトせず設定も閉じず、案内を出す。
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
      { delete: [{ outcome: 'failed' }] },
    );

    await openSettingsFromHistory();
    fireEvent.click(deleteOperation());
    fireEvent.click(confirmDeletionOperation());
    await act(async () => {});

    expect(tabs()).toHaveLength(3);
    expect(contentOperations()).toHaveLength(CONFIRMING_OPERATION_COUNT);
    expect(screen.queryAllByRole('status')).toHaveLength(1);
  });

  it('確認を出したまま設定を閉じて開き直すと、確認は出ていない', async () => {
    // B-56f 規則5・11: 確認中の閉じるは設定ごと閉じ、確認の状態は `SettingsScreen` が持つ
    // （門は持たない）。閉じても削除は送られない（規則4）。
    const { householdData } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
      { delete: [{ outcome: 'deleted' }] },
    );

    await openSettingsFromHistory();
    fireEvent.click(deleteOperation());
    fireEvent.click(closeWhileConfirmingOperation());
    await screen.findByText(NIKUJAGA);
    fireEvent.click(navigationSettings());

    expect(contentOperations()).toHaveLength(SETTINGS_OPERATION_COUNT);
    expect(householdData.deleteCount).toBe(0);
  });

  /**
   * 削除を送っている間の帯（B-60b 設計 6章 規則1〜5）。**送っている間は帯の3つのタブも帯の
   * 「設定」も効かない** — B-56f 規則6（結末が届く前に画面を離れて失敗の案内を失わない）を
   * 帯へ及ぼす。送っている間は `heldUntilSettled` で保留し、`settle` で解く（先行
   * `requestNewMeals`）。止めたことは `disabled` と画面の見えで観る（`vi.fn()` を使わない）。
   */

  /** 世帯のデータの削除の保留を解く（先行 `settleSuggestions`）。 */
  async function settleHouseholdData(householdData: FixedHouseholdDataRequests): Promise<void> {
    await act(async () => {
      householdData.settle();
    });
  }

  /** 設定を開いて削除を確かめる（確認を出してから確かめる。B-56f 規則4）。 */
  async function confirmDeletionFromHistory(): Promise<void> {
    await openSettingsFromHistory();
    fireEvent.click(deleteOperation());
    fireEvent.click(confirmDeletionOperation());
  }

  it('削除を送っている間は、帯の3つのタブが押せない', async () => {
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
      { delete: [{ heldUntilSettled: { outcome: 'failed' } }] },
    );

    await confirmDeletionFromHistory();

    // B-60b 規則1: 門が送っている間を持ち、器の帯を止める。
    expect(tabs().map((tab) => (tab as HTMLButtonElement).disabled)).toEqual([true, true, true]);
  });

  it('削除を送っている間は、帯の「設定」が押せない', async () => {
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
      { delete: [{ heldUntilSettled: { outcome: 'failed' } }] },
    );

    await confirmDeletionFromHistory();

    // B-60b 規則1: 帯の「設定」も止める。
    expect((navigationSettings() as HTMLButtonElement).disabled).toBe(true);
  });

  it('削除を送っている間に在庫タブを押しても、設定画面のままである', async () => {
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
      { delete: [{ heldUntilSettled: { outcome: 'failed' } }] },
    );

    await confirmDeletionFromHistory();
    openPantry();

    // B-60b 規則1 / B-56f 規則6: 押しても設定は閉じない（確認が出たままの操作の数で観る）。
    expect(contentOperations()).toHaveLength(CONFIRMING_OPERATION_COUNT);
  });

  it('削除が失敗した回、送っている間にタブを押しても設定に留まり、失敗の案内が出る', async () => {
    const { householdData } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
      { delete: [{ heldUntilSettled: { outcome: 'failed' } }] },
    );

    await confirmDeletionFromHistory();
    openPantry();
    await settleHouseholdData(householdData);
    await act(async () => {});

    // B-60b 規則1・2 / B-56f 規則8 / `docs/screen-design.md` 8章: 失敗した回は設定画面に留まり、
    // 原因を断定しない案内を出す。**これが失われていたのが B-60b の不具合の本体である。**
    expect(screen.queryAllByRole('status')).toHaveLength(1);
    expect(contentOperations()).toHaveLength(CONFIRMING_OPERATION_COUNT);
  });

  it('削除が失敗したあとは、帯のタブがまた押せる', async () => {
    const { householdData } = renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
      { delete: [{ heldUntilSettled: { outcome: 'failed' } }] },
    );

    await confirmDeletionFromHistory();
    await settleHouseholdData(householdData);
    await act(async () => {});

    // B-60b 規則2・4: 結末が届いたら帯を戻す。下ろし忘れると帯が効かないまま残る。
    expect(tabs().map((tab) => (tab as HTMLButtonElement).disabled)).toEqual([false, false, false]);
  });

  it('削除が失敗したあとに在庫タブを押すと、設定を閉じて在庫の一覧を出す', async () => {
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
      { delete: [{ outcome: 'failed' }] },
    );

    await confirmDeletionFromHistory();
    await act(async () => {});
    openPantry();

    // B-60b 規則2 / B-60 規則8: 結末が届いたあとは、タブで設定を閉じてそのタブを出す。
    expect(await screen.findByText(carrot.name)).not.toBeNull();
    expect(listOperations()).toHaveLength(LIST_OPERATION_COUNT);
  });

  it('削除の確認を出しているだけの間は、在庫タブを押すと設定を閉じて在庫の一覧を出す', async () => {
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
    );

    await openSettingsFromHistory();
    fireEvent.click(deleteOperation());
    openPantry();

    // B-60b 規則5: 帯を止めるのは送っている間だけで、確認を出しているだけの間は止めない。
    expect(await screen.findByText(carrot.name)).not.toBeNull();
    expect(listOperations()).toHaveLength(LIST_OPERATION_COUNT);
  });

  it('接続が切れている間も、設定を開いたまま在庫タブを押すと設定を閉じて在庫の一覧を出す', async () => {
    renderApp(
      { initialState: 'signedIn' },
      { list: [loaded(carrot)] },
      {},
      {},
      { list: [listed([mealA])] },
      {},
      { initialState: 'offline' },
    );

    await openSettingsFromHistory();
    openPantry();

    // B-60b 規則5 / B-70: オフラインは閲覧と遷移を止めない。帯も止めない。
    expect(await screen.findByText(carrot.name)).not.toBeNull();
    expect(listOperations()).toHaveLength(LIST_OPERATION_COUNT);
  });
});

/**
 * 接続状態（B-70 設計 6章 規則1〜14 / 7章 / FR-41 / `docs/screen-design.md` 9章 / ADR-016 /
 * ADR-066）。
 *
 * **帯は文言 `オフラインです` で引く。** ADR-074 で文言の正は `docs/design/`（「案内の帯」）に
 * 移り、この文言は仮ではない（検分で決めた。`docs/testing.md` 4.1 の「仮の文言を期待値に
 * 書かない」には当たらない）。
 *
 * 接続状態は `FixedConnectivity` の `initialState` と `emit` で与え、emit は `act` で包む
 * （先行 `emit(session, …)`）。**止めたことは `disabled` と差し替えが受け取った記録で観る**
 * （`vi.fn()` を使わない。`docs/testing.md` 2章）。
 */

/** 帯の文言（`docs/design/README.md`「案内の帯」/ ADR-074）。 */
const OFFLINE_BANNER = 'オフラインです';

const OFFLINE_NIKUJAGA = '肉じゃが';
const OFFLINE_STIR_FRY = 'にんじんと卵の炒めもの';
/** 献立タブのカードに出る名称。 */
const OFFLINE_SUGGESTED = '提案の献立';
/** 取り直したことを観るための、提案の2件目の台本に置く名称。 */
const OFFLINE_ANOTHER_SUGGESTED = '別の提案の献立';
/** 「新しい献立を求める」で届く献立の名称。 */
const OFFLINE_NEW_MEAL = '新しいご飯';
/** 詳細に出る名称。**カードの名称と別にしておく** — どちらが出ているかを見分ける。 */
const OFFLINE_DETAIL = '詳細の献立';

/** 出ている帯。 */
function offlineBanners(): readonly HTMLElement[] {
  return screen.queryAllByText(OFFLINE_BANNER);
}

/** 帯がちょうど1つ出ていることを確かめてから、それを返す。 */
function soleOfflineBanner(): HTMLElement {
  const found = offlineBanners();
  expect(found).toHaveLength(1);

  const [banner] = found;
  if (banner === undefined) throw new Error('帯が無い');

  return banner;
}

/**
 * 接続状態の変化を配る。**`act` で包む**（先行 `emit`）— 操作から始まらない更新なので、
 * 包まないとテストは描き直される前の木を見る。
 */
function emitConnectivity(connectivity: FixedConnectivity, state: ConnectivityState): void {
  act(() => {
    connectivity.emit(state);
  });
}

type OfflineRenderOptions = {
  readonly session?: FixedSessionOptions;
  readonly requests?: FixedStockItemRequestsOptions;
  readonly suggestions?: FixedSuggestionRequestsOptions;
  readonly meals?: FixedMealRequestsOptions;
  readonly householdData?: FixedHouseholdDataRequestsOptions;
  /** 購読を始めた時点の接続状態。既定は接続している状態。 */
  readonly connectivity?: ConnectivityState;
};

/**
 * 門を描く。**既定はサインイン済みで、在庫は `carrot` 1件**である — 接続状態の観点の多くは
 * サインイン済みの画面で観るため、本題でない台本をここに寄せる。
 */
function renderAppWith(options: OfflineRenderOptions = {}) {
  return renderApp(
    options.session ?? { initialState: 'signedIn' },
    options.requests ?? { list: [loaded(carrot)] },
    options.suggestions ?? {},
    {},
    options.meals ?? {},
    options.householdData ?? {},
    options.connectivity === undefined ? {} : { initialState: options.connectivity },
  );
}

/** 提案が1件出ている状態。**カードの中の開く操作を押せる。** */
function offlineSuggestedOne(mealId: string, title: string): LatestSuggestionOutcome {
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
function offlineNewSuggestion(mealId: string, title: string): RequestNewMealsOutcome {
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

/** 取れた献立1件。**材料を持たせない** — 名称以外の文字が画面に混ざらないようにする。 */
function offlineShownMeal(mealId: string, title: string): MealOutcome {
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

function offlineListed(
  seen: readonly SeenMealSummaryOutput[],
  cooked: readonly CookedMealSummaryOutput[] = [],
): MealListOutcome {
  return { outcome: 'loaded', meals: { seen: [...seen], cooked: [...cooked] } };
}

const offlineMealA: SeenMealSummaryOutput = {
  mealId: 'meal-a',
  title: OFFLINE_NIKUJAGA,
  ingredientCount: 2,
  generatedAt: '2026-10-03T03:00:00.000Z',
};
const offlineMealC: CookedMealSummaryOutput = {
  mealId: 'meal-c',
  title: OFFLINE_STIR_FRY,
  ingredientCount: 2,
  cookedAt: '2026-10-03T03:30:00.000Z',
};

/** 「新しい献立を求める」操作。**末尾の1つである**（D-4）。 */
function lastOperation(): HTMLButtonElement {
  const operation = contentOperations().at(-1);
  if (operation === undefined) throw new Error('操作が1つも無い');

  return operation as HTMLButtonElement;
}

/** 献立タブのカードの開く操作を押す。**カード1枚の回はカードの中の1つだけ**である（B-53）。 */
async function openOfflineCard(): Promise<void> {
  const card = (await screen.findAllByRole('listitem'))[0];
  if (card === undefined) throw new Error('カードが1枚も無い');

  fireEvent.click(within(card).getByRole('button'));
}

/** 詳細に出ている操作は2つ（閉じる／これを作った）である（B-53）。 */
const OFFLINE_DETAIL_OPERATION_COUNT = 2;

/** 確認の前に設定画面に出ている操作は3つ（閉じる／ログアウト／アカウントとデータの削除）。 */
const OFFLINE_SETTINGS_OPERATION_COUNT = 3;
/** 確認が出ている間の操作は4つ（閉じる／ログアウト／確かめる／やめる）。 */
const OFFLINE_CONFIRMING_OPERATION_COUNT = 4;

/** 履歴タブで行が出るのを待ってから、帯の「設定」を押す（B-60 規則7）。 */
async function openOfflineSettings(): Promise<void> {
  fireEvent.click(historyTab());
  await screen.findByText(OFFLINE_NIKUJAGA);
  fireEvent.click(navigationSettings());
}

describe('門 App のオフラインの帯', () => {
  it('サインイン済みで接続が切れていると、帯を1つ出す', async () => {
    renderAppWith({ connectivity: 'offline' });

    await findSoleContentOperation();

    // 規則4 / `docs/screen-design.md` 9章: 帯は1つで、`role="status"` で読み上げに伝える。
    expect(offlineBanners()).toHaveLength(1);
    expect(
      screen
        .getAllByRole('status')
        .filter((status) => status.textContent?.includes(OFFLINE_BANNER) === true),
    ).toHaveLength(1);
  });

  it('接続しているときは帯を出さない', async () => {
    renderAppWith({ connectivity: 'online' });

    await findSoleContentOperation();

    // 規則4。
    expect(offlineBanners()).toHaveLength(0);
  });

  it('接続が戻ると帯は消える', async () => {
    const { connectivity } = renderAppWith({ connectivity: 'offline' });

    await findSoleContentOperation();
    emitConnectivity(connectivity, 'online');

    // 規則4: `online` に戻れば消す。
    expect(offlineBanners()).toHaveLength(0);
  });

  it('接続が切れると、表示中の画面に帯が出る', async () => {
    const { connectivity } = renderAppWith({ connectivity: 'online' });

    await findSoleContentOperation();
    emitConnectivity(connectivity, 'offline');

    // 規則1・3・4: 門が購読して状態を持ち、変化を受けて帯を出す。
    expect(offlineBanners()).toHaveLength(1);
  });

  it('帯は下タブより前に出る', async () => {
    renderAppWith({ connectivity: 'offline' });

    await findSoleContentOperation();
    const banner = soleOfflineBanner();

    // 規則4: 帯は `<main>` の最初の子で、器より前にある。**class は辿らず文書順で観る。**
    // 器の中身（`tabpanel`）も下タブ（`tablist`）も、帯より後ろに来る。
    expect(
      banner.compareDocumentPosition(screen.getByRole('tabpanel')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('ログインの画面でも、接続が切れていれば帯を出す', () => {
    renderAppWith({ session: { initialState: 'signedOut' }, connectivity: 'offline' });

    // 規則5: 帯はサインイン済みの画面とログインの画面の両方に出す。
    expect(offlineBanners()).toHaveLength(1);
    expect(textboxes()).toHaveLength(1);
  });

  it('セッションが分からない間は、接続が切れていても帯を出さない', () => {
    renderAppWith({ session: { initialState: 'unknown' }, connectivity: 'offline' });

    // 規則5 / ADR-046 結果4: `unknown` の間は今どおり何も出さない。
    expect(offlineBanners()).toHaveLength(0);
    expect(tabs()).toHaveLength(0);
    expect(textboxes()).toHaveLength(0);
  });

  it('接続が切れたままサインアウトすると、ログインの画面でも帯が出たままである', async () => {
    const { session } = renderAppWith({ connectivity: 'offline' });

    await findSoleContentOperation();
    emit(session, 'signedOut');

    // 規則3: 接続状態は門が持ち、セッションと一緒に捨てない。
    expect(textboxes()).toHaveLength(1);
    expect(offlineBanners()).toHaveLength(1);
  });

  it('接続が切れていても、サインイン済みになれば在庫一覧を取りに行き、取れた在庫品が出る', async () => {
    renderAppWith({ connectivity: 'offline' });

    openPantry();

    // 規則6 / 7章 行2: 閲覧は止めない。取得は走り、結末は既存のまま扱う。
    expect(await screen.findByText(carrot.name)).not.toBeNull();
  });

  it('接続していると読める間に取得が失敗しても、帯は出さない', async () => {
    renderAppWith({ requests: { list: [{ outcome: 'failed' }] }, connectivity: 'online' });

    openPantry();
    await act(async () => {});

    // 規則2 / 7章 行3: `onLine` が真でも届かないことはあり、その回は既存の失敗のまま。
    // 継ぎ目は見分けない。
    expect(offlineBanners()).toHaveLength(0);
  });
});

describe('門 App の接続が切れている間の献立の操作', () => {
  it('接続が切れると、「新しい献立を求める」が押せない', async () => {
    const { connectivity } = renderAppWith({
      suggestions: { show: [offlineSuggestedOne('meal-1', OFFLINE_SUGGESTED)] },
    });

    await screen.findByText(OFFLINE_SUGGESTED);
    emitConnectivity(connectivity, 'offline');

    // 規則7: 門から `MealsTab` へ `offline` が配られている。
    expect(lastOperation().disabled).toBe(true);
  });

  it('接続が戻ると、「新しい献立を求める」がまた押せる', async () => {
    const { connectivity } = renderAppWith({
      suggestions: { show: [offlineSuggestedOne('meal-1', OFFLINE_SUGGESTED)] },
      connectivity: 'offline',
    });

    await screen.findByText(OFFLINE_SUGGESTED);
    emitConnectivity(connectivity, 'online');

    // 規則14: 戻ったら止めた操作は押せるようになる。
    expect(lastOperation().disabled).toBe(false);
  });

  it('接続が戻っても、新しい献立の要求を自分では送らない', async () => {
    const { connectivity, suggestions } = renderAppWith({
      suggestions: {
        show: [offlineSuggestedOne('meal-1', OFFLINE_SUGGESTED)],
        requestNewMeals: [offlineNewSuggestion('meal-new', OFFLINE_NEW_MEAL)],
      },
      connectivity: 'offline',
    });

    await screen.findByText(OFFLINE_SUGGESTED);
    emitConnectivity(connectivity, 'online');
    await act(async () => {});

    // 規則14 / ADR-016: 保留・再送をしない。**起きないことは件数でしか観られない**
    // （C-15 と同じ構え。`docs/testing.md` 2章）。
    expect(suggestions.requestNewMealsCount).toBe(0);
  });

  it('接続が戻っても、在庫一覧を取りに行き直さない', async () => {
    const { connectivity, requests } = renderAppWith({
      requests: { list: [loaded(carrot), loaded(chineseCabbage)] },
    });

    openPantry();
    await screen.findByText(carrot.name);
    emitConnectivity(connectivity, 'offline');
    emitConnectivity(connectivity, 'online');
    await act(async () => {});

    // 規則14 / NFR-07 の構え: 復帰時に自動で取り直さない。
    expect(requests.listCount).toBe(1);
  });

  it('接続が戻っても、保存済みの提案を取りに行き直さない', async () => {
    const { connectivity, suggestions } = renderAppWith({
      suggestions: {
        show: [
          offlineSuggestedOne('meal-1', OFFLINE_SUGGESTED),
          offlineSuggestedOne('meal-2', OFFLINE_ANOTHER_SUGGESTED),
        ],
      },
    });

    await screen.findByText(OFFLINE_SUGGESTED);
    emitConnectivity(connectivity, 'offline');
    emitConnectivity(connectivity, 'online');
    await act(async () => {});

    // 規則14。
    expect(suggestions.showCount).toBe(1);
  });

  it('新しい献立を送っている間に接続が切れても、届いた献立に入れ替わる', async () => {
    const { connectivity, suggestions } = renderAppWith({
      suggestions: {
        show: [offlineSuggestedOne('meal-1', OFFLINE_SUGGESTED)],
        requestNewMeals: [{ heldUntilSettled: offlineNewSuggestion('meal-new', OFFLINE_NEW_MEAL) }],
      },
    });

    await screen.findByText(OFFLINE_SUGGESTED);
    fireEvent.click(lastOperation());
    emitConnectivity(connectivity, 'offline');
    await settleSuggestions(suggestions);

    // 規則13 / ADR-016: 送っている途中の要求は取り消さず、結末の扱いは今のまま。
    expect(await screen.findByText(OFFLINE_NEW_MEAL)).not.toBeNull();
    expect(screen.queryByText(OFFLINE_SUGGESTED)).toBeNull();
  });

  it('接続が切れると、開いている献立詳細の「これを作った」が押せない', async () => {
    const { connectivity } = renderAppWith({
      suggestions: { show: [offlineSuggestedOne('meal-1', OFFLINE_SUGGESTED)] },
      meals: { show: [offlineShownMeal('meal-1', OFFLINE_DETAIL)] },
    });

    await openOfflineCard();
    await screen.findByText(OFFLINE_DETAIL);
    emitConnectivity(connectivity, 'offline');

    // 規則8: 門から `MealDetail` へ `offline` が配られている。
    expect((operationAt(1, OFFLINE_DETAIL_OPERATION_COUNT) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('門 App の接続が切れている間も止めない閲覧と遷移', () => {
  it('接続が切れていても、タブを移れる', async () => {
    renderAppWith({ connectivity: 'offline' });

    fireEvent.click(pantryTab());

    // 規則6: タブの移動は止めない。
    expect(await screen.findByText(carrot.name)).not.toBeNull();
  });

  it('接続が切れていても、カードから献立詳細を開ける', async () => {
    const { meals } = renderAppWith({
      suggestions: { show: [offlineSuggestedOne('meal-1', OFFLINE_SUGGESTED)] },
      meals: { show: [offlineShownMeal('meal-1', OFFLINE_DETAIL)] },
      connectivity: 'offline',
    });

    await openOfflineCard();

    // 規則6: 詳細を開くのは閲覧であり、献立1件を取りに行く。
    expect(await screen.findByText(OFFLINE_DETAIL)).not.toBeNull();
    expect(meals.shownMealIds).toEqual(['meal-1']);
  });

  it('接続が切れていても、献立詳細を閉じるとカードの一覧に戻る', async () => {
    renderAppWith({
      suggestions: { show: [offlineSuggestedOne('meal-1', OFFLINE_SUGGESTED)] },
      meals: { show: [offlineShownMeal('meal-1', OFFLINE_DETAIL)] },
      connectivity: 'offline',
    });

    await openOfflineCard();
    await screen.findByText(OFFLINE_DETAIL);
    fireEvent.click(operationAt(0, OFFLINE_DETAIL_OPERATION_COUNT));

    // 規則6・8: 閉じる操作は止めない。
    expect(await screen.findByText(OFFLINE_SUGGESTED)).not.toBeNull();
  });

  it('接続が切れていても、履歴の列を切り替えられる', async () => {
    renderAppWith({
      meals: { list: [offlineListed([offlineMealA], [offlineMealC])] },
      connectivity: 'offline',
    });

    fireEvent.click(historyTab());
    await screen.findByText(OFFLINE_NIKUJAGA);
    const toggles = screen.getAllByRole('button', { pressed: false });
    expect(toggles).toHaveLength(1);
    fireEvent.click(toggles[0] as HTMLElement);

    // 規則6: 列の切り替えは閲覧である。
    expect(await screen.findByText(OFFLINE_STIR_FRY)).not.toBeNull();
  });

  it('接続が切れていても、設定画面を開ける', async () => {
    renderAppWith({
      meals: { list: [offlineListed([offlineMealA])] },
      connectivity: 'offline',
    });

    await openOfflineSettings();

    // 規則6: 設定を開くのは遷移である。
    expect(contentOperations()).toHaveLength(OFFLINE_SETTINGS_OPERATION_COUNT);
    expect(screen.queryByText(OFFLINE_NIKUJAGA)).toBeNull();
  });

  it('接続が切れていても、設定画面を閉じて履歴に戻れる', async () => {
    renderAppWith({
      meals: { list: [offlineListed([offlineMealA])] },
      connectivity: 'offline',
    });

    await openOfflineSettings();
    fireEvent.click(operationAt(0, OFFLINE_SETTINGS_OPERATION_COUNT));

    // 規則6。
    expect(await screen.findByText(OFFLINE_NIKUJAGA)).not.toBeNull();
  });
});

describe('門 App の接続が切れている間の在庫と設定の操作', () => {
  /** 行をタップする。**押下と離上を同じ座標に送る**（先行 `在庫の編集（B-55）`）。 */
  function tapSoleRow(): void {
    const row = soleRow();

    fireEvent.pointerDown(row, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(row, { pointerId: 1, clientX: 0, clientY: 0 });
  }

  it('接続が切れていても、在庫の登録の画面を開ける', async () => {
    renderAppWith({ connectivity: 'offline' });

    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(openRegisterOperation());

    // 規則6: 登録の画面を開くのは遷移である。食材名の欄は `role="combobox"` を明示しているので `combobox`。
    expect(ingredientNameField()).not.toBeNull();
  });

  it('接続が切れると、登録の画面の保存が2つとも押せない', async () => {
    const { connectivity } = renderAppWith();

    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(openRegisterOperation());
    fireEvent.change(ingredientNameField(), { target: { value: 'ねぎ' } });
    emitConnectivity(connectivity, 'offline');

    // 規則9: 門 → `PantryTab` → `StockItemForm` へ `offline` が素通しされている。
    expect((saveAndStayOperation() as HTMLButtonElement).disabled).toBe(true);
    expect((saveAndCloseOperation() as HTMLButtonElement).disabled).toBe(true);
  });

  it('接続が切れると、編集の画面の保存が押せない', async () => {
    const { connectivity } = renderAppWith();

    openPantry();
    await screen.findByText(carrot.name);
    tapSoleRow();
    emitConnectivity(connectivity, 'offline');

    // 規則10: 門 → `PantryTab` → `StockItemEditForm` へ `offline` が素通しされている。
    // 名札 `保存` は原本から取った文言（ADR-074）。一覧の側も木に残るので位置では引かない（B-65b）。
    expect((namedOperation('保存') as HTMLButtonElement).disabled).toBe(true);
  });

  it('接続が切れている間は、行の削除を確かめても削除が送られない', async () => {
    // 削除の台本は渡しておく — 送られた回も最後まで通り、落ちるのは記録の断定だけになる
    // （`docs/testing.md` 2章「用意した生成結果をわざと渡す」と同じ構え）。
    const { requests } = renderAppWith({
      requests: { list: [loaded(carrot), loaded(carrot)], remove: [{ outcome: 'deleted' }] },
      connectivity: 'offline',
    });

    openPantry();
    await screen.findByText(carrot.name);
    deleteSoleRow();
    await act(async () => {});

    // 規則11: 門 → `PantryTab` → `PantryList` へ `offline` が素通しされ、確認の削除が押せない（B-69）。
    expect(requests.deletedIds).toEqual([]);
    expect(screen.queryByText(carrot.name)).not.toBeNull();
  });

  it('接続が切れると、設定の確認の中の削除の操作が押せない', async () => {
    const { connectivity, householdData } = renderAppWith({
      meals: { list: [offlineListed([offlineMealA])] },
      householdData: { delete: [{ outcome: 'failed' }] },
    });

    await openOfflineSettings();
    fireEvent.click(operationAt(2, OFFLINE_SETTINGS_OPERATION_COUNT));
    emitConnectivity(connectivity, 'offline');
    const confirm = operationAt(2, OFFLINE_CONFIRMING_OPERATION_COUNT) as HTMLButtonElement;
    fireEvent.click(confirm);
    await act(async () => {});

    // 規則12: 門 → `SettingsScreen` へ `offline` が配られ、削除は送られない。
    expect(confirm.disabled).toBe(true);
    expect(householdData.deleteCount).toBe(0);
  });
});

/**
 * 端末の「戻る」（B-75 設計 6章 規則2〜5 / ADR-084 / ADR-064 / ADR-066 結果1）。
 *
 * 継ぎ目は記憶上の `FixedBackNavigation` に差し替えて provider で包み、`pressBack()` で
 * 「利用者が戻るを押した」ことにする。**受け取ったかどうかは `pressBack()` の戻り値**
 * （受け取らない＝アプリを離れる。規則3）、閉じた先は**選ばれているタブ**（`aria-selected`）と
 * **テストが渡した名称**で観る。
 */
describe('門 App の端末の戻る', () => {
  const NIKUJAGA = '肉じゃが';
  /** 献立タブのカードに出る名称。 */
  const SUGGESTED = '提案の献立';
  /** 献立詳細に出る名称（カード・行の名称と見分ける）。 */
  const DETAIL = '詳細の献立';

  const mealA: SeenMealSummaryOutput = {
    mealId: 'meal-a',
    title: NIKUJAGA,
    ingredientCount: 2,
    generatedAt: '2026-09-20T09:00:00.000Z',
  };

  /** 献立タブにカード1枚・履歴に1行・開けば詳細が出る門を、継ぎ目つきで描く。 */
  function renderAppWithBack(
    sessionOptions: FixedSessionOptions = { initialState: 'signedIn' },
    detailMealId = 'meal-s',
  ): FixedBackNavigation {
    const backNavigation = new FixedBackNavigation();
    renderApp(
      sessionOptions,
      { list: [loaded(carrot)] },
      { show: [offlineSuggestedOne('meal-s', SUGGESTED)] },
      {},
      { list: [offlineListed([mealA])], show: [offlineShownMeal(detailMealId, DETAIL)] },
      {},
      {},
      backNavigation,
    );

    return backNavigation;
  }

  /** 戻るを押す。口が呼ばれたら `true`（`act` で包む。口は画面の状態を変える）。 */
  function pressBack(backNavigation: FixedBackNavigation): boolean {
    let received = false;
    act(() => {
      received = backNavigation.pressBack();
    });

    return received;
  }

  /** 献立タブのカードの開く操作を押す。**カード1枚の回はカードの中の1つだけ**である（B-53）。 */
  async function openCard(): Promise<void> {
    const card = (await screen.findAllByRole('listitem'))[0];
    if (card === undefined) throw new Error('カードが1枚も無い');

    fireEvent.click(within(card).getByRole('button'));
  }

  /** 履歴の行を名称で引き、その行の開く操作を押す。**行の中の操作は1つだけ**である。 */
  async function openHistoryRow(title: string): Promise<void> {
    await screen.findByText(title);
    const row = screen
      .getAllByRole('listitem')
      .find((item) => within(item).queryByText(title) !== null);
    if (row === undefined) throw new Error(`${title} の行が無い`);

    fireEvent.click(within(row).getByRole('button'));
  }

  it('ログインの画面では、戻るを受け取らない', async () => {
    const backNavigation = renderAppWithBack({ initialState: 'signedOut' });
    await act(async () => {});

    // 規則3: ログインの画面で戻るとアプリを離れる（番兵を置かない）。
    expect(pressBack(backNavigation)).toBe(false);
  });

  it('何も開いていない献立タブでは、戻るを受け取らない', async () => {
    const backNavigation = renderAppWithBack();
    await screen.findByText(SUGGESTED);

    // 規則3 / ADR-064: 既定のタブで何も開いていなければアプリを離れる。
    expect(pressBack(backNavigation)).toBe(false);
  });

  it('在庫タブで戻ると、献立タブが選ばれる', async () => {
    const backNavigation = renderAppWithBack();
    openPantry();
    await screen.findByText(carrot.name);

    pressBack(backNavigation);

    // 規則2・4 / ADR-064: 既定でないタブ → 献立タブ。
    expect(mealsTab().getAttribute('aria-selected')).toBe('true');
  });

  it('履歴で開いた詳細は、献立タブを経て履歴に戻ったあとの戻るで閉じ、履歴タブのままである', async () => {
    const backNavigation = renderAppWithBack({ initialState: 'signedIn' }, 'meal-a');
    fireEvent.click(historyTab());
    await openHistoryRow(NIKUJAGA);
    await screen.findByText(DETAIL);
    fireEvent.click(mealsTab());
    await screen.findByText(SUGGESTED);
    fireEvent.click(historyTab());
    await screen.findByText(DETAIL);

    pressBack(backNavigation);

    // 規則4 / 設計 10章 前提3: 詳細とタブの口が同じ描画で登録されても、閉じるのは詳細である。
    expect([screen.queryByText(DETAIL), historyTab().getAttribute('aria-selected')]).toEqual([
      null,
      'true',
    ]);
  });

  it('献立タブで開いた詳細は、在庫タブから戻ったときには閉じず、献立タブで詳細が出る', async () => {
    const backNavigation = renderAppWithBack();
    await openCard();
    await screen.findByText(DETAIL);
    openPantry();
    await screen.findByText(carrot.name);

    pressBack(backNavigation);

    // 規則5: 見えていない献立詳細は閉じない。戻るで閉じるのは在庫タブ（→ 献立タブ）である。
    expect([mealsTab().getAttribute('aria-selected'), screen.queryByText(DETAIL) === null]).toEqual(
      ['true', false],
    );
  });

  it('在庫タブで設定を開いて戻ると、在庫タブに戻る', async () => {
    const backNavigation = renderAppWithBack();
    openPantry();
    await screen.findByText(carrot.name);
    fireEvent.click(navigationSettings());

    pressBack(backNavigation);

    // 規則2・5 / B-60 規則9: 設定 → 開く前のタブ。設定を開いている間はタブの口を外している。
    expect(pantryTab().getAttribute('aria-selected')).toBe('true');
  });

  it('詳細を開いたまま設定を開いて戻ると、詳細に戻る', async () => {
    const backNavigation = renderAppWithBack();
    await openCard();
    await screen.findByText(DETAIL);
    fireEvent.click(navigationSettings());

    pressBack(backNavigation);

    // 規則2 / B-60 規則9: 設定 → 開く前のタブ（詳細を含む）。
    expect(await screen.findByText(DETAIL)).not.toBeNull();
  });
});
