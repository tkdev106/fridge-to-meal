import { describe, expect, it } from 'vitest';
import type { SignInFormValues } from '../../../src/features/identity/SignInFormValues.js';
import {
  EMPTY_SIGN_IN_FORM,
  credentialsOf,
} from '../../../src/features/identity/SignInFormValues.js';

// 標本（`docs/testing.md` 6章）。メールとパスワードは**互いに見分けのつく**文字列にする —
// 2欄を取り違えた実装が緑にならないため。
const email = 'user@example.com';
const password = 'correct-horse';

/**
 * テストの本題でない欄を隠す（`docs/testing.md` 6章）。本題だけが `overrides` に現れる。
 *
 * 既定を `EMPTY_SIGN_IN_FORM` から取らない — それだと規則6 のテストが落ちたときに、
 * 関係のない行も一緒に落ちて理由が読めなくなる。
 */
function formValues(overrides: Partial<SignInFormValues> = {}): SignInFormValues {
  return { email, password, ...overrides };
}

function credentials(overrides: Partial<SignInFormValues> = {}) {
  return credentialsOf(formValues(overrides));
}

describe('資格情報の組み立て credentialsOf', () => {
  it('メールとパスワードの両方に値があるときその値をそのまま持つ資格情報を返す', () => {
    // FR-25 / ADR-046 決定2 / B-35 設計 規則4・5: 値は写すだけ。
    const result = credentials({ email: 'user@example.com', password: 'correct-horse' });

    expect(result).toEqual({ email: 'user@example.com', password: 'correct-horse' });
  });

  it('メールが空なら資格情報を作らない', () => {
    // B-35 設計 規則4 / 先行 B-12 規則2: 往復しても必ず断られるものだけ手前で止める。
    expect(credentials({ email: '' })).toBe(null);
  });

  it('メールが空白だけなら資格情報を作らない', () => {
    // B-35 設計 規則4（trim() 後に空）/ 先行 B-12 規則4b。
    expect(credentials({ email: '   ' })).toBe(null);
  });

  it('メールが全角空白だけでも資格情報を作らない', () => {
    // B-35 設計 規則4: JS の trim() は U+3000 も落とす。
    expect(credentials({ email: '　' })).toBe(null);
  });

  it('メールの前後の空白は落とさずそのまま資格情報に置く', () => {
    // B-35 設計 規則5 / 先行 B-12 規則4: 正規化を画面に持ち込まない。断るのは Supabase Auth の側。
    expect(credentials({ email: '  user@example.com  ' })?.email).toBe('  user@example.com  ');
  });

  it('メールの書式らしくない文字列でも資格情報を作りそのまま置く', () => {
    // B-35 設計 規則5: メールの書式は画面で確かめない。
    expect(credentials({ email: 'not-an-email' })?.email).toBe('not-an-email');
  });

  it('パスワードが空文字なら資格情報を作らない', () => {
    // B-35 設計 規則4: パスワードは空文字だけが作れない条件。
    expect(credentials({ password: '' })).toBe(null);
  });

  it('パスワードが空白だけなら資格情報を作りその空白をそのまま置く', () => {
    // B-35 設計 規則4・5: パスワードは trim() しない。空白だけでも作り、そのまま運ぶ。
    expect(credentials({ password: '   ' })?.password).toBe('   ');
  });

  it('1文字のパスワードでも資格情報を作る', () => {
    // B-35 設計 規則5: パスワードの長さは画面で確かめない。
    expect(credentials({ password: 'a' })?.password).toBe('a');
  });
});

describe('空のフォーム EMPTY_SIGN_IN_FORM', () => {
  it('開いた直後のフォームは2欄とも空である', () => {
    // B-35 設計 規則6 / 先行 B-12 規則6。
    expect(EMPTY_SIGN_IN_FORM).toEqual({ email: '', password: '' });
  });

  it('開いた直後のフォームからは資格情報を作らない', () => {
    // B-35 設計 規則6・4: 開いた直後に送れる状態にしない。
    expect(credentialsOf(EMPTY_SIGN_IN_FORM)).toBe(null);
  });
});
