import { describe, expect, it } from 'vitest';
import type { SignUpFormValues } from '../../../src/features/identity/SignUpFormValues.js';
import {
  EMPTY_SIGN_UP_FORM,
  signUpCheckOf,
} from '../../../src/features/identity/SignUpFormValues.js';

// 標本（`docs/testing.md` 6章）。2欄は互いに見分けのつく文字列にする。
const email = 'user@example.com';
const password = 'correct-horse';

/** 本題でない欄を有効な標本で埋める（`docs/testing.md` 6章）。 */
function check(overrides: Partial<SignUpFormValues> = {}) {
  return signUpCheckOf({ email, password, ...overrides });
}

/** メールだけが本題の行で、メールに当たった理由の全体。 */
function emailProblem(problem: string) {
  return { ok: false, problems: { email: problem, password: null } };
}

/** パスワードだけが本題の行で、パスワードに当たった理由の全体。 */
function passwordProblem(problem: string) {
  return { ok: false, problems: { email: null, password: problem } };
}

describe('作成画面の検証 signUpCheckOf', () => {
  describe('2欄の組み合わせ', () => {
    it('メールとパスワードの両方が規則を満たすとき入力のままの資格情報を返す', () => {
      // B-73 設計 規則5。
      expect(check()).toEqual({
        ok: true,
        credentials: { email: 'user@example.com', password: 'correct-horse' },
      });
    });

    it('2欄とも不正なら両方の理由を返す', () => {
      expect(check({ email: '', password: '' })).toEqual({
        ok: false,
        problems: { email: 'empty', password: 'empty' },
      });
    });

    it('開いた直後のフォームは2欄とも空である', () => {
      expect(EMPTY_SIGN_UP_FORM).toEqual({ email: '', password: '' });
    });
  });

  describe('メール', () => {
    it('メールが空文字なら空とする', () => {
      expect(check({ email: '' })).toEqual(emailProblem('empty'));
    });

    it('メールが空白だけなら空ではなく書式の不正とする', () => {
      // 値は trim しない（B-73 設計 規則3）。
      expect(check({ email: '   ' })).toEqual(emailProblem('malformed'));
    });

    it('254 コードポイントのメールは通す', () => {
      const value = 'a'.repeat(242) + '@example.com';
      expect(check({ email: value })).toEqual({
        ok: true,
        credentials: { email: value, password },
      });
    });

    it('255 コードポイントのメールは長すぎるとする', () => {
      expect(check({ email: 'a'.repeat(243) + '@example.com' })).toEqual(emailProblem('tooLong'));
    });

    it('メールの長さは UTF-16 の単位でもバイトでもなくコードポイントで数える', () => {
      // 254 コードポイント・UTF-16 で 496 単位・980 バイト。
      const value = '𠮷'.repeat(242) + '@example.com';
      expect(check({ email: value })).toEqual({
        ok: true,
        credentials: { email: value, password },
      });
    });

    it('長すぎるメールは書式が不正でも長すぎるとする', () => {
      expect(check({ email: 'a'.repeat(255) })).toEqual(emailProblem('tooLong'));
    });

    it('メールの途中に半角空白があれば書式の不正とする', () => {
      expect(check({ email: 'user @example.com' })).toEqual(emailProblem('malformed'));
    });

    it('メールの前後の空白は落とさず書式の不正とする', () => {
      expect(check({ email: '  user@example.com  ' })).toEqual(emailProblem('malformed'));
    });

    it('メールに全角空白があれば書式の不正とする', () => {
      expect(check({ email: 'user@example.com　' })).toEqual(emailProblem('malformed'));
    });

    it('メールに @ が無ければ書式の不正とする', () => {
      expect(check({ email: 'userexample.com' })).toEqual(emailProblem('malformed'));
    });

    it('最後の @ より前が空なら書式の不正とする', () => {
      expect(check({ email: '@example.com' })).toEqual(emailProblem('malformed'));
    });

    it('最後の @ より後が空なら書式の不正とする', () => {
      expect(check({ email: 'user@' })).toEqual(emailProblem('malformed'));
    });

    it('最後の @ より後に . が無ければ書式の不正とする', () => {
      expect(check({ email: 'user@example' })).toEqual(emailProblem('malformed'));
    });

    it('最初の @ の後が整っていても最後の @ の後が空なら書式の不正とする', () => {
      expect(check({ email: 'user@example.com@' })).toEqual(emailProblem('malformed'));
    });

    it('. が最後の @ より前にしか無ければ書式の不正とする', () => {
      expect(check({ email: 'a@b.c@example' })).toEqual(emailProblem('malformed'));
    });

    it('@ が複数あっても最後の @ の前後が規則を満たせば通す', () => {
      expect(check({ email: 'a@b@example.com' })).toEqual({
        ok: true,
        credentials: { email: 'a@b@example.com', password },
      });
    });

    it('最小の整ったメールは通す', () => {
      expect(check({ email: 'a@b.c' })).toEqual({
        ok: true,
        credentials: { email: 'a@b.c', password },
      });
    });
  });

  describe('パスワード', () => {
    it('パスワードが空文字なら空とする', () => {
      expect(check({ password: '' })).toEqual(passwordProblem('empty'));
    });

    it('7 コードポイントのパスワードは短すぎるとする', () => {
      expect(check({ password: 'abcdefg' })).toEqual(passwordProblem('tooShort'));
    });

    it('8 コードポイントのパスワードは通す', () => {
      expect(check({ password: 'abcdefgh' })).toEqual({
        ok: true,
        credentials: { email, password: 'abcdefgh' },
      });
    });

    it('7 コードポイントなら UTF-16 やバイトで8を超えても短すぎるとする', () => {
      expect(check({ password: '𠮷'.repeat(7) })).toEqual(passwordProblem('tooShort'));
    });

    it('空白だけのパスワードは空ではなく短すぎるとする', () => {
      expect(check({ password: ' '.repeat(7) })).toEqual(passwordProblem('tooShort'));
    });

    it('空白だけのパスワードでも長さを満たせば入力のまま通す', () => {
      // B-35 規則4: パスワードに正規化を掛けると登録時と一致しなくなる。
      expect(check({ password: '        ' })).toEqual({
        ok: true,
        credentials: { email, password: '        ' },
      });
    });

    it('パスワードの前後の空白も長さに数える', () => {
      expect(check({ password: ' abcdef ' })).toEqual({
        ok: true,
        credentials: { email, password: ' abcdef ' },
      });
    });

    it('パスワードは正規化せず入力のまま数えて写す', () => {
      // 「が」を NFD（か + 濁点）で4つ。8 コードポイントで、NFC なら4になる。
      const value = 'が'.repeat(4);
      expect(check({ password: value })).toEqual({
        ok: true,
        credentials: { email, password: value },
      });
    });

    it('UTF-8 で 72 バイトのパスワードは通す', () => {
      const value = 'a'.repeat(72);
      expect(check({ password: value })).toEqual({
        ok: true,
        credentials: { email, password: value },
      });
    });

    it('UTF-8 で 73 バイトのパスワードは長すぎるとする', () => {
      expect(check({ password: 'a'.repeat(73) })).toEqual(passwordProblem('tooLong'));
    });

    it('マルチバイト文字のパスワードは 72 バイトちょうどなら通す', () => {
      const value = 'あ'.repeat(24);
      expect(check({ password: value })).toEqual({
        ok: true,
        credentials: { email, password: value },
      });
    });

    it('マルチバイト文字のパスワードは 25 コードポイントでも 73 バイトなら長すぎるとする', () => {
      expect(check({ password: 'あ'.repeat(24) + 'a' })).toEqual(passwordProblem('tooLong'));
    });
  });
});
