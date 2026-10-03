// @vitest-environment jsdom
/**
 * アカウント作成の画面 `SignUpForm`（B-73 設計 6章 規則7〜17 / ADR-081 / `docs/testing.md` 4.1）。
 *
 * 書式と長さの判断は `SignUpFormValues.test.ts`、断りの種別分けは `SignUpOutcomes.test.ts` が
 * 押さえている。ここで確かめるのは**切り出せないもの**だけ — 理由がいつ出て欄とどう結ばれるか、
 * 焦点、口へ何が届くか、結末ごとの案内、戻る操作である。
 *
 * 口へ届いたものは `FixedSession.receivedCredentials` で、戻る操作が押されたことはテストの配列で
 * 見る（`vi.fn()` で数えない。`docs/testing.md` 2章）。
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../support/dom/renderComponent.js';
import { FixedSession } from '../../support/session/FixedSession.js';
import type { FixedSessionOptions } from '../../support/session/FixedSession.js';
import { SignUpForm } from '../../../src/features/identity/SignUpForm.js';

const typedEmail = 'user@example.com';
const typedPassword = 'correct-horse';

function renderSignUpForm(options: FixedSessionOptions = {}) {
  const session = new FixedSession(options);
  const wentBack: true[] = [];
  const rendered = render(
    <SignUpForm
      onSignUp={(email, password) => session.signUp(email, password)}
      onBackToSignIn={() => wentBack.push(true)}
    />,
  );

  return { session, rendered, wentBack };
}

function emailField(): HTMLElement {
  return screen.getByRole('textbox', { name: 'メールアドレス' });
}

function passwordField(): HTMLElement {
  return screen.getByLabelText('パスワード');
}

function submitOperation(): HTMLElement {
  return screen.getByRole('button', { name: 'アカウントを作る' });
}

function backOperation(): HTMLElement {
  return screen.getByRole('button', { name: 'ログイン画面へ戻る' });
}

function fill(email: string, password: string): void {
  fireEvent.change(emailField(), { target: { value: email } });
  fireEvent.change(passwordField(), { target: { value: password } });
}

/** 欄に結ばれた理由の文。結ばれていなければ null。 */
function describedTextOf(field: HTMLElement): string | null {
  const id = field.getAttribute('aria-describedby');
  if (id === null) return null;

  return document.getElementById(id)?.textContent ?? null;
}

/** 出ている案内（段落）。 */
function notices(): readonly HTMLElement[] {
  return screen.queryAllByRole('paragraph');
}

async function waitForSoleNoticeText(): Promise<string> {
  await waitFor(() => {
    expect(notices()).toHaveLength(1);
  });

  return notices()[0]?.textContent ?? '';
}

describe('アカウント作成の画面 SignUpForm', () => {
  it('見出しは「アカウントを作る」の1つだけで、階層1である', () => {
    renderSignUpForm();

    // B-73 設計 6章 規則12・17: ログインの画面（デザイン 14）に揃える。
    const headings = screen.getAllByRole('heading');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toBe(screen.getByRole('heading', { level: 1, name: 'アカウントを作る' }));
  });

  it('画面の上にロゴ「fridge to meal」が出る', () => {
    renderSignUpForm();

    expect(screen.getByText('fridge to meal')).not.toBeNull();
  });

  it('操作は「アカウントを作る」「ログイン画面へ戻る」の順に並ぶ', () => {
    renderSignUpForm();

    expect(screen.getAllByRole('button')).toEqual([submitOperation(), backOperation()]);
  });

  it('開いた直後はメールの欄に焦点がある', () => {
    renderSignUpForm();

    // B-73 設計 6章 規則15。
    expect(document.activeElement).toBe(emailField());
  });

  it('開いた直後は理由を出さず、欄を不正としない', () => {
    renderSignUpForm();

    // B-73 設計 6章 規則8: 理由は初めて送ろうとした回以後だけ出す。
    expect(emailField().getAttribute('aria-invalid')).toBeNull();
    expect(passwordField().getAttribute('aria-invalid')).toBeNull();
    expect(describedTextOf(emailField())).toBeNull();
    // パスワードの欄は理由の代わりに決まりの文へ結ばれている。
    expect(describedTextOf(passwordField())).toBe('8 文字以上');
  });

  it('打っている途中でも、送ろうとする前は理由を出さない', () => {
    renderSignUpForm();

    fill('user@', 'short');

    expect(describedTextOf(emailField())).toBeNull();
    // パスワードの欄は理由の代わりに決まりの文へ結ばれている。
    expect(describedTextOf(passwordField())).toBe('8 文字以上');
  });

  it('空のまま送ろうとすると、口へは何も届かず2欄に理由が結ばれる', () => {
    const { session } = renderSignUpForm();

    fireEvent.click(submitOperation());

    // B-73 設計 6章 規則7〜9: 主の操作は空でも押せ、押すと理由が出る。
    expect(session.receivedCredentials).toEqual([]);
    expect(emailField().getAttribute('aria-invalid')).toBe('true');
    expect(passwordField().getAttribute('aria-invalid')).toBe('true');
    expect(describedTextOf(emailField())).not.toBeNull();
    expect(describedTextOf(passwordField())).not.toBeNull();
  });

  it('通らなかった回は最初の不正な欄に焦点を移す', () => {
    renderSignUpForm();

    fill(typedEmail, 'short');
    fireEvent.click(submitOperation());

    // B-73 設計 6章 規則9: メールは正しいので、パスワードの欄へ移る。
    expect(document.activeElement).toBe(passwordField());
    expect(emailField().getAttribute('aria-invalid')).toBeNull();
    expect(describedTextOf(emailField())).toBeNull();
  });

  it('2欄とも不正ならメールの欄に焦点を移す', () => {
    renderSignUpForm();

    fill('user@', 'short');
    passwordField().focus();
    fireEvent.click(submitOperation());

    expect(document.activeElement).toBe(emailField());
  });

  it('理由ごとに違う文が出る', () => {
    renderSignUpForm();

    fill('user@', '');
    fireEvent.click(submitOperation());
    const malformed = describedTextOf(emailField());
    const emptyPassword = describedTextOf(passwordField());

    fill('', 'short');
    const emptyEmail = describedTextOf(emailField());
    const tooShort = describedTextOf(passwordField());

    fill(typedEmail, 'a'.repeat(73));
    const tooLong = describedTextOf(passwordField());

    // B-73 設計 6章 規則8: 理由は今の値で都度判定する。文面は互いに違う。
    expect(new Set([malformed, emptyEmail]).size).toBe(2);
    expect(new Set([emptyPassword, tooShort, tooLong]).size).toBe(3);
  });

  it('送ろうとした後に直すと、その欄の理由が消える', () => {
    renderSignUpForm();

    fill('user@', 'short');
    fireEvent.click(submitOperation());
    fireEvent.change(emailField(), { target: { value: typedEmail } });

    expect(emailField().getAttribute('aria-invalid')).toBeNull();
    expect(describedTextOf(emailField())).toBeNull();
    expect(passwordField().getAttribute('aria-invalid')).toBe('true');
  });

  it('2欄が規則を満たせば、打った値がサインアップの口へ届く', () => {
    const { session } = renderSignUpForm({ signUp: ['signedIn'] });

    fill(typedEmail, typedPassword);
    fireEvent.click(submitOperation());

    expect(session.receivedCredentials).toEqual([
      { operation: 'signUp', email: 'user@example.com', password: 'correct-horse' },
    ]);
  });

  it('サインアップが通った回は案内を出さない', async () => {
    const { session } = renderSignUpForm({ signUp: ['signedIn'] });

    fill(typedEmail, typedPassword);
    fireEvent.click(submitOperation());
    await waitFor(() => {
      expect(session.receivedCredentials).toHaveLength(1);
    });

    // B-73 設計 6章 規則10: 画面を切り替えるのは門である。
    expect(notices()).toHaveLength(0);
  });

  it('送っている間は、主の操作も戻る操作も効かない', async () => {
    const { session, wentBack } = renderSignUpForm({
      signUp: [{ heldUntilSettled: 'rejected' }],
    });

    fill(typedEmail, typedPassword);
    // 送っている間は主の操作の名札が `送っています…` に変わるので、押す前に引いておく（規則7）。
    const submit = submitOperation();
    const back = backOperation();
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(back);

    // B-73 設計 6章 規則7・13: 結末の届く前に閉じると、案内が出ないまま捨てられる。
    expect(session.receivedCredentials).toHaveLength(1);
    expect(wentBack).toEqual([]);

    session.settle();
    await waitForSoleNoticeText();
  });

  it('断りの種別ごとに違う案内が出て、入力は欄に残る', async () => {
    const texts: string[] = [];
    for (const outcome of [
      'weakPassword',
      'invalidEmail',
      'alreadyRegistered',
      'rejected',
    ] as const) {
      const { rendered } = renderSignUpForm({ signUp: [outcome] });
      fill(typedEmail, typedPassword);
      fireEvent.click(submitOperation());
      texts.push(await waitForSoleNoticeText());

      // B-35 規則10: 打ち直しを強いない。
      expect(screen.queryByDisplayValue('user@example.com')).not.toBeNull();
      expect(screen.queryByDisplayValue('correct-horse')).not.toBeNull();
      rendered.unmount();
    }

    // B-73 設計 6章 規則11 / ADR-081: サーバの断りを種別ごとの文言で知らせる。
    expect(new Set(texts).size).toBe(4);
  });

  it('次に送ると、前に出ていた断りの案内が消える', async () => {
    const { session } = renderSignUpForm({
      signUp: ['rejected', { heldUntilSettled: 'rejected' }],
    });

    fill(typedEmail, typedPassword);
    fireEvent.click(submitOperation());
    await waitForSoleNoticeText();

    fireEvent.click(submitOperation());
    expect(notices()).toHaveLength(0);

    session.settle();
    await waitForSoleNoticeText();
  });

  it('確認のメールが要る結末では、フォームが完了の案内とログイン画面へ戻る操作1つに置き換わる', async () => {
    const { wentBack } = renderSignUpForm({ signUp: ['confirmationRequired'] });

    fill(typedEmail, typedPassword);
    fireEvent.click(submitOperation());

    const done = await screen.findByText(/確認のメールを送りました/);

    // B-73 設計 6章 規則12・13: 欄も主の操作も消え、見出しは残る。焦点は案内の文へ移る。
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'アカウントを作る' })).not.toBeNull();
    expect(screen.getAllByRole('button')).toEqual([
      screen.getByRole('button', { name: 'ログイン画面へ' }),
    ]);
    // 案内は数行に分かれて1つの段落に収まる。焦点はその段落にある。
    expect(document.activeElement).toBe(done.closest('p'));

    fireEvent.click(screen.getByRole('button', { name: 'ログイン画面へ' }));
    expect(wentBack).toEqual([true]);
  });

  it('ログイン画面へ戻る操作は、何も送らずに戻る', () => {
    const { session, wentBack } = renderSignUpForm();

    fill(typedEmail, typedPassword);
    fireEvent.click(backOperation());

    // B-73 設計 6章 規則13。
    expect(wentBack).toEqual([true]);
    expect(session.receivedCredentials).toEqual([]);
  });
});
