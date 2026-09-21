// @vitest-environment jsdom
/**
 * ログイン／サインアップの画面 `SignInForm`（B-40 設計 6章 規則1〜14 / 7章 / ADR-052 /
 * `docs/testing.md` 4.1）。
 *
 * 資格情報を作れるかの判断は `SignInFormValues.test.ts` が既に押さえている。ここで確かめるのは
 * **切り出せないもの**だけ — 2欄に打った値がどちらの口へ届くか、送っている間に何が起きないか、
 * 案内が出る／消える／別のものになる、入力が残る、である。
 *
 * **仮の文言と記号を期待値に書かない**（ADR-052 結果2 / 設計 規則2）。見出しも2つの操作の名札も
 * 案内の文面も未確定であり（`docs/screen-design.md` 論点3）、留めると**文言を変えただけで
 * 赤くなる**。観察は次の3つだけで行う（設計 規則3）。
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
import { fireEvent, render, screen, waitFor } from '../../support/dom/renderComponent.js';
import { FixedSession } from '../../support/session/FixedSession.js';
import type { FixedSessionOptions } from '../../support/session/FixedSession.js';
import { SignInForm } from '../../../src/features/identity/SignInForm.js';

/**
 * 2欄に打つ標本。**互いに見分けのつく文字列にする**（先行 `SignInFormValues.test.ts`）—
 * 2欄を取り違えた実装が緑にならないため。
 */
const typedEmail = 'user@example.com';
const typedPassword = 'correct-horse';

function renderSignInForm(options: FixedSessionOptions = {}) {
  const session = new FixedSession(options);
  const rendered = render(
    <SignInForm
      onSignIn={(email, password) => session.signIn(email, password)}
      onSignUp={(email, password) => session.signUp(email, password)}
    />,
  );

  return { session, rendered };
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

  it('アカウントを作る操作を押すと、同じ2欄の値がサインアップの口へ届く', () => {
    const { session } = renderSignInForm({ signUp: ['signedIn'] });

    fillCredentials();
    fireEvent.click(signUpOperation());

    // FR-25 / ADR-046 決定2: 送る中身は2つの操作で同じであり、**違うのは届く口だけ**である。
    // ログインの口には1件も届かない（届いていればこの配列に現れる）。
    expect(session.receivedCredentials).toEqual([
      { operation: 'signUp', email: 'user@example.com', password: 'correct-horse' },
    ]);
  });

  it('パスワードを打たないままログインの操作を押しても、どちらの口へも何も届かない', () => {
    const { session } = renderSignInForm();

    fireEvent.change(emailField(), { target: { value: typedEmail } });
    fireEvent.click(signInOperation());

    // ADR-046 決定2 / B-35 設計 規則4: 往復しても必ず断られるものは手前で止める。
    // **`disabled` 属性を断定しない**（設計 規則8）— 観るのは「口へ届かないこと」である。
    expect(session.receivedCredentials).toEqual([]);
  });

  it('送っている間にアカウントを作る操作を押しても、口へ届くのは1件だけである', async () => {
    const { session } = renderSignInForm({ signIn: [{ heldUntilSettled: 'rejected' }] });

    fillCredentials();
    fireEvent.click(signInOperation());

    // 前提: 1件は届き、結末はまだ返っていない（保留のまま）。
    expect(session.receivedCredentials).toHaveLength(1);

    fireEvent.click(signUpOperation());

    // FR-25 / ADR-007 の構え / 設計 規則7: 送っている間はどちらの操作も効かない。
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

  it('ログインの断りとアカウントを作る断りでは、出る案内が違う', async () => {
    const signInRejected = renderSignInForm({ signIn: ['rejected'] });

    fillCredentials();
    fireEvent.click(signInOperation());
    const signInNotice = await waitForSoleNotice();
    signInRejected.rendered.unmount();

    renderSignInForm({ signUp: ['rejected'] });

    fillCredentials();
    fireEvent.click(signUpOperation());
    const signUpNotice = await waitForSoleNotice();

    // 設計 規則11 / ADR-046: **どちらの操作が断られたのかが読めること**を、2回の描画の
    // 文字列が一致しないことで観る。**文面そのものは期待値に書かない。**
    expect(signUpNotice).not.toBe(signInNotice);
  });

  it('確認のメールが要る結末では、断りとは違う案内が出る', async () => {
    const confirmationRequired = renderSignInForm({ signUp: ['confirmationRequired'] });

    fillCredentials();
    fireEvent.click(signUpOperation());
    const confirmationNotice = await waitForSoleNotice();
    confirmationRequired.rendered.unmount();

    renderSignInForm({ signUp: ['rejected'] });

    fillCredentials();
    fireEvent.click(signUpOperation());
    const rejectedNotice = await waitForSoleNotice();

    // `Session.ts` `SignUpOutcome` / B-35 設計 規則9: 確認のメールは断りではない。
    // どちらも案内は1つで、**同じ文字列にはならない**（設計 規則11）。
    expect(confirmationNotice).not.toBe(rejectedNotice);
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
});
