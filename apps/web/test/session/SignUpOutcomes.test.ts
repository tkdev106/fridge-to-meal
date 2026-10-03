import { describe, expect, it } from 'vitest';
import type { SignUpResult } from '../../src/session/SignUpOutcomes.js';
import { signUpOutcomeOf } from '../../src/session/SignUpOutcomes.js';

/** 断りの code だけが本題の行で、セッションは返っていない形を作る。 */
function rejectedWith(code: string | undefined): SignUpResult {
  return { error: { code }, sessionReturned: false };
}

describe('サインアップの結末 signUpOutcomeOf', () => {
  it('断られずにセッションが返ったらサインイン済みとする', () => {
    // B-73 設計 規則1。
    expect(signUpOutcomeOf({ error: null, sessionReturned: true })).toBe('signedIn');
  });

  it('断られずにセッションが返らなければメールの確認待ちとする', () => {
    // B-73 設計 規則1 / 10章 前提1。
    expect(signUpOutcomeOf({ error: null, sessionReturned: false })).toBe('confirmationRequired');
  });

  it('weak_password で断られたらパスワードが弱いとする', () => {
    expect(signUpOutcomeOf(rejectedWith('weak_password'))).toBe('weakPassword');
  });

  it('email_address_invalid で断られたらメールアドレスが不正とする', () => {
    expect(signUpOutcomeOf(rejectedWith('email_address_invalid'))).toBe('invalidEmail');
  });

  it('user_already_exists で断られたら登録済みとする', () => {
    expect(signUpOutcomeOf(rejectedWith('user_already_exists'))).toBe('alreadyRegistered');
  });

  it('email_exists で断られたら登録済みとする', () => {
    expect(signUpOutcomeOf(rejectedWith('email_exists'))).toBe('alreadyRegistered');
  });

  it('断りに code が無ければ種別を決めずに断られたとする', () => {
    // 通信不能も code を持たない（B-73 設計 規則1）。
    expect(signUpOutcomeOf(rejectedWith(undefined))).toBe('rejected');
  });

  it('送信の回数制限で断られたら断られたとする', () => {
    expect(signUpOutcomeOf(rejectedWith('over_email_send_rate_limit'))).toBe('rejected');
  });

  it('サインアップが無効で断られたら断られたとする', () => {
    expect(signUpOutcomeOf(rejectedWith('signup_disabled'))).toBe('rejected');
  });

  it('断りがあるときはセッションが返っていてもサインイン済みにしない', () => {
    // セッションの有無を見るのは断りが無いときだけ（B-73 設計 規則1）。
    expect(signUpOutcomeOf({ error: { code: 'signup_disabled' }, sessionReturned: true })).toBe(
      'rejected',
    );
  });
});
