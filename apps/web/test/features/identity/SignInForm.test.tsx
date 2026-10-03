// @vitest-environment jsdom
/**
 * ログイン／サインアップの画面 `SignInForm`（B-40 設計 6章 規則1〜14 / 7章 / ADR-052 /
 * `docs/testing.md` 4.1）。
 *
 * 資格情報を作れるかの判断は `SignInFormValues.test.ts` が既に押さえている。ここで確かめるのは
 * **切り出せないもの**だけ — 2欄に打った値がどちらの口へ届くか、送っている間に何が起きないか、
 * 案内が出る／消える／別のものになる、入力が残る、である。
 *
 * **ADR-074 で文言の正は `docs/design/` に移った。** B-40 の時点では見出しも2つの操作の名札も
 * 案内の文面も未確定だったため（ADR-052 結果2 / 設計 規則2）、既存の行は文言を期待値に書かず
 * **位置で引くまま**残す。**新しい行（B-68）は名札で引く** — 見出し・欄・操作の名札とロゴの文字は
 * `docs/design/` の原本の文言である。既存の行の観察は次の3つだけで行う（設計 規則3）。
 *
 * - **口へ何が届いたか** … `FixedSession.receivedCredentials`（テストが打った値）
 * - **案内** … `queryAllByRole('paragraph')` の**数**と、2回の描画の**文字列が一致しないこと**
 *   （設計 規則11。**文面そのものは期待値に書かない**）
 * - **どの操作を押すか** … `getAllByRole('button')` を**文書順の位置**で引く（`operations`）
 *
 * **`vi.fn()` で呼び出し回数を数えない**（`docs/testing.md` 2章 / 設計 規則5）。届いたことも
 * 届いていないことも `FixedSession` が持つ配列の中身で見る。
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '../../support/dom/renderComponent.js';
import { FixedSession } from '../../support/session/FixedSession.js';
import type { FixedSessionOptions } from '../../support/session/FixedSession.js';
import { SignInForm } from '../../../src/features/identity/SignInForm.js';

/**
 * 2欄に打つ標本。**互いに見分けのつく文字列にする**（先行 `SignInFormValues.test.ts`）—
 * 2欄を取り違えた実装が緑にならないため。
 */
const typedEmail = 'user@example.com';
const typedPassword = 'correct-horse';

function renderSignInForm(options: FixedSessionOptions = {}, returnedFromSignUp = false) {
  const session = new FixedSession(options);
  // 作成画面へ移る口が押された回を、押された順に記録する（`vi.fn()` で数えない。`docs/testing.md` 2章）。
  const openedSignUp: true[] = [];
  const rendered = render(
    <SignInForm
      onSignIn={(email, password) => session.signIn(email, password)}
      onOpenSignUp={() => openedSignUp.push(true)}
      returnedFromSignUp={returnedFromSignUp}
    />,
  );

  return { session, rendered, openedSignUp };
}

/**
 * メールの欄。`textbox` になるのはこの1つだけである（パスワードの欄は `type="password"` で
 * この役割に写らない）。**先に件数を確かめる**（設計 7章 行2）。
 */
function emailField(): HTMLElement {
  const textboxes = screen.getAllByRole('textbox');
  if (textboxes.length !== 1) throw new Error('メールの欄が1つだけ出ている状態ではない');

  return screen.getByRole('textbox');
}

/**
 * パスワードの欄。**この suite で唯一もろい引き方である**（設計 規則10）。
 *
 * `input[type="password"]` は ARIA の役割に写らないため `textbox` で引けず、ラベルの文言は
 * 仮である（規則2）。そこで**値が空の入力が1つだけになった状態**で引く — メールを先に
 * 埋めておくことが前提である。欄が増えたり順が変わったりすると、この引き方は壊れる。
 */
function passwordField(): HTMLElement {
  return screen.getByDisplayValue('');
}

/** 2欄を打つ。パスワードは最後に引く（`passwordField` の前提）。 */
function fillCredentials(): void {
  fireEvent.change(emailField(), { target: { value: typedEmail } });
  fireEvent.change(passwordField(), { target: { value: typedPassword } });
}

/**
 * 押せる操作を**文書順**で返す（設計 規則10）。
 *
 * この画面の操作は2つで、**先頭がログイン（`<form>` の submit）・2つ目がアカウントを作る**
 * である。**この数を先に確かめる** — 崩れた回に別の操作を押してしまうと、テストは
 * 「届いていない」ではなく別の理由で落ち、何が壊れたか読めなくなる。**名札は見ない**（規則2）。
 */
function operations(): readonly HTMLElement[] {
  const found = screen.getAllByRole('button');
  expect(found).toHaveLength(2);

  return found;
}

function operationAt(index: number): HTMLElement {
  const found = operations().at(index);
  if (found === undefined) throw new Error(`${index} 番目の操作が無い`);

  return found;
}

/** ログインの操作。文書順の先頭である。 */
function signInOperation(): HTMLElement {
  return operationAt(0);
}

/** アカウントを作る操作。文書順の2つ目である。 */
function signUpOperation(): HTMLElement {
  return operationAt(1);
}

/** 出ている案内。**数だけを見る**（設計 規則11）。 */
function notices(): readonly HTMLElement[] {
  return screen.queryAllByRole('paragraph');
}

/**
 * 出ている案内の文字列。**期待値に書くためではなく、2回の描画を突き合わせるためだけに読む**
 * （設計 規則11）。同時に出る案内は1つまでである。
 */
function soleNoticeText(): string {
  const [notice, ...rest] = notices();
  if (notice === undefined || rest.length > 0) {
    throw new Error('案内が1つだけ出ている状態ではない');
  }

  return notice.textContent ?? '';
}

/** 出ている案内の要素。B-68 の行が class と記号を見るために使う。同時に出る案内は1つまでである。 */
function soleNotice(): HTMLElement {
  const [notice, ...rest] = notices();
  if (notice === undefined || rest.length > 0) {
    throw new Error('案内が1つだけ出ている状態ではない');
  }

  return notice;
}

/** 断り（などの案内）が届くまで待つ。**待つ条件に仮の文言を使わない**（設計 規則7・11）。 */
async function waitForSoleNotice(): Promise<string> {
  await waitFor(() => {
    expect(notices()).toHaveLength(1);
  });

  return soleNoticeText();
}

describe('ログインの画面 SignInForm', () => {
  it('ログインの操作を押すと、打ったメールとパスワードがサインインの口へ届く', () => {
    const { session } = renderSignInForm({ signIn: ['signedIn'] });

    fillCredentials();
    fireEvent.click(signInOperation());

    // FR-25 / ADR-046 決定2: 値は**加工されずに**届く（前後の空白も落とさない）。
    expect(session.receivedCredentials).toEqual([
      { operation: 'signIn', email: 'user@example.com', password: 'correct-horse' },
    ]);
  });

  it('アカウントを作る操作を押すと作成画面へ移り、どちらの口へも何も届かない', () => {
    const { session, openedSignUp } = renderSignInForm();

    fillCredentials();
    fireEvent.click(signUpOperation());

    // B-73 設計 6章 規則16 / ADR-081: ログインの画面からはアカウントを作らない。打った値も運ばない。
    expect(openedSignUp).toEqual([true]);
    expect(session.receivedCredentials).toEqual([]);
  });

  it('欄が空のままでもアカウントを作る操作で作成画面へ移れる', () => {
    const { openedSignUp } = renderSignInForm();

    fireEvent.click(signUpOperation());

    // B-73 設計 6章 規則16: 入力の有無では止めない。
    expect(openedSignUp).toEqual([true]);
  });

  it('作成画面から戻った直後はアカウントを作る操作に焦点がある', () => {
    renderSignInForm({}, true);

    // B-73 設計 6章 規則15 / 先行 B-65b: 閉じた画面を開いた操作へ焦点を戻す。
    expect(document.activeElement).toBe(signUpOperation());
  });

  it('パスワードを打たないままログインの操作を押しても、どちらの口へも何も届かない', () => {
    const { session } = renderSignInForm();

    fireEvent.change(emailField(), { target: { value: typedEmail } });
    fireEvent.click(signInOperation());

    // ADR-046 決定2 / B-35 設計 規則4: 往復しても必ず断られるものは手前で止める。
    // **`disabled` 属性を断定しない**（設計 規則8）— 観るのは「口へ届かないこと」である。
    expect(session.receivedCredentials).toEqual([]);
  });

  it('送っている間にアカウントを作る操作を押しても、作成画面へは移らない', async () => {
    const { session, openedSignUp } = renderSignInForm({
      signIn: [{ heldUntilSettled: 'rejected' }],
    });

    fillCredentials();
    fireEvent.click(signInOperation());

    // 前提: 1件は届き、結末はまだ返っていない（保留のまま）。
    expect(session.receivedCredentials).toHaveLength(1);

    fireEvent.click(signUpOperation());

    // FR-25 / ADR-007 の構え / 設計 規則7 / B-73 規則16: 送っている間はどちらの操作も効かない
    // — 移ると結末の案内が出ないまま捨てられる。
    expect(openedSignUp).toEqual([]);
    expect(session.receivedCredentials).toEqual([
      { operation: 'signIn', email: 'user@example.com', password: 'correct-horse' },
    ]);

    // 保留を解いてから終える — 届いた更新を `act` の中で起こすためである。
    session.settle();
    await waitForSoleNotice();
  });

  it('ログインが断られると案内が1つ出る', async () => {
    const { session } = renderSignInForm({ signIn: ['rejected'] });

    fillCredentials();

    // 押す前には案内が出ていない（出ていたら「断りで出た」と読めない）。
    expect(notices()).toHaveLength(0);

    fireEvent.click(signInOperation());

    // ADR-046 / 設計 規則11: 断りは案内1つで伝える。**文面は見ない**（未確定である）。
    await waitFor(() => {
      expect(notices()).toHaveLength(1);
    });
    expect(session.receivedCredentials).toHaveLength(1);
  });

  it('サインインが通った回は案内を出さない', async () => {
    const { session } = renderSignInForm({ signIn: ['signedIn'] });

    fillCredentials();
    fireEvent.click(signInOperation());

    // 結末が届いたことは**テストが打った値の記録**で待つ（設計 規則7）。
    await waitFor(() => {
      expect(session.receivedCredentials).toHaveLength(1);
    });

    // `Session.ts` 規則6 / B-35 設計 規則9: 通った回は何も出さない — 画面を切り替えるのは門である。
    expect(notices()).toHaveLength(0);
  });

  it('次の操作を始めると、前に出ていた案内が消える', async () => {
    const { session } = renderSignInForm({
      signIn: ['rejected', { heldUntilSettled: 'rejected' }],
    });

    fillCredentials();
    fireEvent.click(signInOperation());
    await waitForSoleNotice();

    fireEvent.click(signInOperation());

    // 設計 規則11 / B-35 設計 規則10: 新しい操作を始めたら前の案内を消す。**同時に出る案内は
    // 1つまでである**ため、古い断りが残っていると、いまの結末がどれか読めなくなる。
    expect(notices()).toHaveLength(0);

    session.settle();
    await waitForSoleNotice();
  });

  it('断られても、打った2欄の値は欄に残る', async () => {
    renderSignInForm({ signIn: ['rejected'] });

    fillCredentials();
    fireEvent.click(signInOperation());
    await waitForSoleNotice();

    // NFR-15 の構え / B-35 設計 規則10: 打ち直しを強いない。**当てるのはテストが打った値**である。
    expect(screen.queryByDisplayValue('user@example.com')).not.toBeNull();
    expect(screen.queryByDisplayValue('correct-horse')).not.toBeNull();
  });

  it('断られたあと、もう一度ログインの操作を押すと2件目が口へ届く', async () => {
    const { session } = renderSignInForm({ signIn: ['rejected', 'signedIn'] });

    fillCredentials();
    fireEvent.click(signInOperation());
    await waitForSoleNotice();

    fireEvent.click(signInOperation());

    // FR-25 / ADR-007: 自動で送り直さない代わりに、**利用者の操作でいつでも送り直せる。**
    await waitFor(() => {
      expect(session.receivedCredentials).toHaveLength(2);
    });
  });

  // ---- B-68: 構造（デザイン 14 / ADR-074）。見た目の値は見ず、class は互いに比べる（ADR-055 決定1・3）。

  it('画面の上にロゴ「fridge to meal」が出る', () => {
    renderSignInForm();

    // B-68 設計 6章 規則2 / ADR-074: ロゴは原本の文字1つ。
    expect(screen.getByText('fridge to meal')).not.toBeNull();
  });

  it('見出しは「ログイン」の1つだけで、階層1である', () => {
    renderSignInForm();

    // B-68 設計 6章 規則3: 門の signedOut 枝でこの画面だけが描かれ、上位の見出しが無いので h1 にする。
    // ロゴを見出しにすると2つになる（規則2）。
    const headings = screen.getAllByRole('heading');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toBe(screen.getByRole('heading', { level: 1, name: 'ログイン' }));
  });

  it('2つの欄は「メールアドレス」と「パスワード」の名札で引ける', () => {
    renderSignInForm();

    // B-68 設計 6章 規則4: 欄の見出しを span に分けても、<label> が欄を包む形を保ち名札を失わない。
    expect(screen.getByRole('textbox', { name: 'メールアドレス' })).not.toBeNull();
    expect(screen.getByLabelText('パスワード')).not.toBeNull();
  });

  it('操作は「ログイン」「アカウントを作る」の順に並ぶ', () => {
    renderSignInForm();

    // B-68 設計 6章 規則6 / 2026-10-02 のユーザー決定: アカウントを作るはログインの下に残す。
    expect(screen.getAllByRole('button')).toEqual([
      screen.getByRole('button', { name: 'ログイン' }),
      screen.getByRole('button', { name: 'アカウントを作る' }),
    ]);
  });

  it('ログインとアカウントを作るには違う class が当たり、どちらも空ではない', () => {
    renderSignInForm();

    const signIn = screen.getByRole('button', { name: 'ログイン' });
    const signUp = screen.getByRole('button', { name: 'アカウントを作る' });

    // B-68 設計 6章 規則6・7: 主と副は見た目の役割が違い、それを別の class で表す。
    // **class が空のまま「違う」を満たす実装をここで落とす**（先行 TabbedScreen.test.tsx）。
    expect(signIn.className).not.toBe(signUp.className);
    expect(signIn.className).not.toBe('');
    expect(signUp.className).not.toBe('');
  });

  it('断りの案内に添える記号 ! は読み上げに出ない', async () => {
    renderSignInForm({ signIn: ['rejected'] });

    fillCredentials();
    fireEvent.click(signInOperation());
    await waitForSoleNotice();

    const mark = within(soleNotice()).getByText('!');

    // B-68 設計 6章 規則9 / NFR-17: 色だけで分けないために記号を添え、読み上げでは文を変えない。
    // ARIA の約束（aria-hidden）を見る手段がほかに無いため、この1行だけ DOM を辿る。
    expect(mark.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
