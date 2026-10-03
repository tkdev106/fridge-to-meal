/**
 * アカウント作成画面のフォームの値を検める（B-73 設計 6章 規則3〜5 / ADR-081）。
 *
 * 判断はここに置き、日本語と描画は `SignUpForm.tsx` が持つ（先行 `SignInFormValues.ts`）。
 * React も `@supabase/*` も import しない（ADR-046 決定3）。
 *
 * **ログイン画面の判断（`credentialsOf`）とは別にする**（規則6）— ログインは既に作られた
 * アカウントの資格情報を通すだけで、ここで決めた下限を当てると、Supabase の既定（6 文字）で
 * 作られた既存のパスワードを締め出す。
 *
 * **値は trim も正規化もしない。** 前後に空白のあるメールは書式の誤りとして知らせ、黙って直さない。
 * パスワードに正規化を掛けると、登録時と一致しなくなる（B-35 規則4）。
 */

import type { Credentials } from './SignInFormValues.js';

/** 作成画面が持つ2欄の値。名前や世帯の欄は持たない（B-73。入力は最小限）。 */
export type SignUpFormValues = {
  readonly email: string;
  readonly password: string;
};

/** 開いた直後の値。 */
export const EMPTY_SIGN_UP_FORM: SignUpFormValues = {
  email: '',
  password: '',
};

/** メールの欄の理由。1欄に出す理由は1つで、この並びの順に判定する。 */
export type EmailProblem = 'empty' | 'tooLong' | 'malformed';

/** パスワードの欄の理由。同上。 */
export type PasswordProblem = 'empty' | 'tooShort' | 'tooLong';

export type SignUpProblems = {
  readonly email: EmailProblem | null;
  readonly password: PasswordProblem | null;
};

export type SignUpCheck =
  | { readonly ok: true; readonly credentials: Credentials }
  | { readonly ok: false; readonly problems: SignUpProblems };

/** メールの上限（コードポイント）。RFC 5321 の経路の上限に揃える。 */
const EMAIL_MAX_CODE_POINTS = 254;

/** パスワードの下限（コードポイント）。Supabase の既定 6 より厳しくし、ダッシュボードで 8 に揃える（ADR-081）。 */
const PASSWORD_MIN_CODE_POINTS = 8;

/** パスワードの上限（UTF-8 のバイト数）。Supabase Auth がハッシュに使う bcrypt の上限（ADR-081）。 */
const PASSWORD_MAX_UTF8_BYTES = 72;

/** 文字数はコードポイントで数える（サロゲートペアを2と数えない）。 */
const codePointsOf = (value: string): number => [...value].length;

const utf8BytesOf = (value: string): number => new TextEncoder().encode(value).length;

/**
 * メールの書式。**届くかどうかは確かめない** — 往復して断られる明らかな誤りだけを手前で止める。
 * `@` が複数あり得るので、前後は**最後の** `@` で切る。
 */
function emailProblemOf(email: string): EmailProblem | null {
  if (email === '') return 'empty';
  if (codePointsOf(email) > EMAIL_MAX_CODE_POINTS) return 'tooLong';
  if (/\s/u.test(email)) return 'malformed';

  const at = email.lastIndexOf('@');
  if (at <= 0) return 'malformed';

  const domain = email.slice(at + 1);
  if (domain === '' || !domain.includes('.')) return 'malformed';

  return null;
}

function passwordProblemOf(password: string): PasswordProblem | null {
  if (password === '') return 'empty';
  if (codePointsOf(password) < PASSWORD_MIN_CODE_POINTS) return 'tooShort';
  if (utf8BytesOf(password) > PASSWORD_MAX_UTF8_BYTES) return 'tooLong';
  return null;
}

/** 2欄を検める。両方に理由が無いときだけ、入力のままの資格情報を作る（規則5）。 */
export function signUpCheckOf(values: SignUpFormValues): SignUpCheck {
  const problems: SignUpProblems = {
    email: emailProblemOf(values.email),
    password: passwordProblemOf(values.password),
  };

  if (problems.email !== null || problems.password !== null) return { ok: false, problems };

  return { ok: true, credentials: { email: values.email, password: values.password } };
}
