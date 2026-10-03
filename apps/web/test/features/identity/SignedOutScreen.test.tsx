// @vitest-environment jsdom
/**
 * ログイン／作成の出し分け `SignedOutScreen`（B-73 設計 6章 規則14・15 / ADR-081）。
 *
 * 見るのは**いまどちらの画面か**（階層1の見出しの名札）と、切り替えで入力が持ち越されないこと、
 * 戻ったときの焦点である。各画面の中身はそれぞれの suite が押さえている。
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '../../support/dom/renderComponent.js';
import { FixedSession } from '../../support/session/FixedSession.js';
import { SignedOutScreen } from '../../../src/features/identity/SignedOutScreen.js';

function renderSignedOutScreen() {
  const session = new FixedSession();
  render(
    <SignedOutScreen
      onSignIn={(email, password) => session.signIn(email, password)}
      onSignUp={(email, password) => session.signUp(email, password)}
    />,
  );
  return { session };
}

function headingName(): string {
  return screen.getByRole('heading', { level: 1 }).textContent ?? '';
}

describe('ログイン／作成の出し分け SignedOutScreen', () => {
  it('開いた直後はログインの画面である', () => {
    renderSignedOutScreen();

    expect(headingName()).toBe('ログイン');
  });

  it('ログインのアカウントを作る操作で作成画面に移る', () => {
    renderSignedOutScreen();

    fireEvent.click(screen.getByRole('button', { name: 'アカウントを作る' }));

    expect(headingName()).toBe('アカウントを作る');
  });

  it('作成画面のログイン画面へ戻る操作でログインの画面に戻り、アカウントを作る操作に焦点がある', () => {
    renderSignedOutScreen();

    fireEvent.click(screen.getByRole('button', { name: 'アカウントを作る' }));
    fireEvent.click(screen.getByRole('button', { name: 'ログイン画面へ戻る' }));

    // B-73 設計 6章 規則14・15。
    expect(headingName()).toBe('ログイン');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'アカウントを作る' }));
  });

  it('画面を切り替えても打った値は持ち越さない', () => {
    renderSignedOutScreen();

    fireEvent.change(screen.getByRole('textbox', { name: 'メールアドレス' }), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'アカウントを作る' }));

    // B-73 設計 6章 規則14 / 10章 前提3。
    expect(screen.queryByDisplayValue('user@example.com')).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'メールアドレス' }), {
      target: { value: 'other@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ログイン画面へ戻る' }));

    expect(screen.queryByDisplayValue('other@example.com')).toBeNull();
  });

  it('開いた直後のログインの画面ではアカウントを作る操作に焦点を当てない', () => {
    renderSignedOutScreen();

    expect(document.activeElement).not.toBe(
      screen.getByRole('button', { name: 'アカウントを作る' }),
    );
  });
});
