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
import { App } from '../src/App.js';
import type { SessionState } from '../src/session/Session.js';
import type { StockItemsOutcome } from '../src/server/StockItemRequests.js';

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
) {
  const session = new FixedSession(sessionOptions);
  const requests = new FixedStockItemRequests(requestOptions);

  render(
    <App
      session={session}
      listStockItems={requests.listStockItems}
      registerStockItem={requests.registerStockItem}
      deleteStockItem={requests.deleteStockItem}
    />,
  );

  return { session, requests };
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

/** 食材名の欄。登録の画面の `textbox` の先頭である（期限は `type="date"` で入らない）。 */
function ingredientNameField(): HTMLElement {
  const [field] = textboxes();
  if (field === undefined) throw new Error('食材名の欄が無い');

  return field;
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
    await screen.findByText(carrot.name);

    // B-38 / 要件 第7章 / 設計 規則12: 器を mount するのはこの枝だけである。
    expect(tabs()).toHaveLength(3);
  });

  it('セッションの復元が済んでサインイン済みになると、下タブ3つが出る', async () => {
    const { session } = renderApp({ initialState: 'unknown' }, { list: [loaded(carrot)] });

    expect(tabs()).toHaveLength(0);

    emit(session, 'signedIn');
    await screen.findByText(carrot.name);

    // `Session.ts` 規則5・6: 購読の1度目で渡された状態のまま止まらず、変化を受けて切り替わる。
    expect(tabs()).toHaveLength(3);
  });

  it('サインアウトすると、ログインの画面へ戻る', async () => {
    const { session } = renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] });

    await screen.findByText(carrot.name);
    emit(session, 'signedOut');

    // FR-25 / B-38 設計 規則9: 器ごと外れる（入り直すと既定のタブに戻る）。
    expect(tabs()).toHaveLength(0);
    expect(textboxes()).toHaveLength(1);
  });

  it('ログアウトの操作を押すと、ログインの画面へ戻る', async () => {
    renderApp({ initialState: 'signedIn' }, { list: [loaded(carrot)] });

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
