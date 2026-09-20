/**
 * ログイン／サインアップの画面（B-35 設計 4章 / 6章 規則7〜10 / 7章）。`docs/screen-design.md` 第8章の
 * 「ログイン／サインアップ」1画面に当たる。
 *
 * ここは `SignInFormValues.ts` を読むだけの薄い層である。資格情報を作れるかの判断を持たない
 * — **描いて確かめられるようになった今も**（ADR-052）、判断は純粋関数に置くほうが速く、
 * 仮の文言にも jsdom にも依存しない。
 *
 * 反対に、**日本語はここにしか置かない。** 文言も配色も未確定であり（`docs/screen-design.md` 論点3）、
 * 以下の日本語は仮のものである。
 *
 * サインインとサインアップの実行は引数で受け取る。画面が見るのは `Session.ts` の結末の型だけで、
 * `@supabase/*` は import しない（ADR-046 決定3 / 規則3）。
 */

import type { ChangeEvent, FormEvent } from 'react';
import { useState } from 'react';
import type { SignInOutcome, SignUpOutcome } from '../../session/Session.js';
import type { SignInFormValues } from './SignInFormValues.js';
import { EMPTY_SIGN_IN_FORM, credentialsOf } from './SignInFormValues.js';

/** 画面の見出し。仮の文言である。 */
const HEADING = 'ログイン';

/** 欄の見出し。2欄とも必須なので「（任意）」は付けない（規則4）。 */
const FIELD_LABELS: Record<keyof SignInFormValues, string> = {
  email: 'メールアドレス',
  password: 'パスワード',
};

/** 操作2つの名札（規則7）。ログインはフォームの submit、アカウントを作るは別の操作。 */
const SIGN_IN_LABEL = 'ログイン';
const SIGN_UP_LABEL = 'アカウントを作る';

/** 送っている間の名札。受け付けないこと（規則7）を、操作の見た目だけでなく文字でも伝える。 */
const SENDING_LABEL = '送っています…';

/**
 * 画面が出す案内。**新しい操作を始めたら前の案内を消す**ので、同時に出るのは1つだけ（規則10）。
 *
 * - `signInRejected` / `signUpRejected` — 断りの案内。**原因を断定しない**（規則8）。継ぎ目の
 *   `'rejected'` は資格情報の誤りも通信不能も含むため、「メールかパスワードが違います」と書くと
 *   通信不能のときに嘘になる。確かめることとして両方を並べる。
 * - `confirmationRequired` — 確認メールの案内（規則9）。メールの確認を要する設定のときに返る。
 *   実物の設定は確かめられていないため、この変種は落とさない（設計 10章）。
 */
type Notice = 'signInRejected' | 'signUpRejected' | 'confirmationRequired';

const NOTICES: Record<Notice, string> = {
  signInRejected:
    'ログインできませんでした。メールアドレスとパスワード、通信の状態を確かめて、もう一度お試しください。入力はそのままです。',
  signUpRejected:
    'アカウントを作れませんでした。メールアドレスとパスワード、通信の状態を確かめて、もう一度お試しください。入力はそのままです。',
  confirmationRequired:
    '確認のメールを送りました。メールの中のリンクを開いてから、同じメールアドレスとパスワードでログインしてください。',
};

export type SignInFormProps = {
  /** サインインの実行。失敗は reject ではなく結末の値で返る（`Session.ts` 規則7）。 */
  onSignIn: (email: string, password: string) => Promise<SignInOutcome>;
  /** サインアップの実行。同上。 */
  onSignUp: (email: string, password: string) => Promise<SignUpOutcome>;
};

export function SignInForm({ onSignIn, onSignUp }: SignInFormProps) {
  const [values, setValues] = useState<SignInFormValues>(EMPTY_SIGN_IN_FORM);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const credentials = credentialsOf(values);

  // 資格情報が作れない間と送っている間は、どちらの操作も効かせない（規則7）。
  const disabled = credentials === null || sending;

  function changeField(field: keyof SignInFormValues) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setValues((previous) => ({ ...previous, [field]: event.target.value }));
    };
  }

  /**
   * 操作1つぶんの送り方。**`catch` しない**（7章）— 失敗は値で返す約束であり、包むと継ぎ目の
   * 約束違反が隠れる。送っている状態だけは `finally` で戻す。
   */
  async function send(run: (email: string, password: string) => Promise<Notice | null>) {
    if (disabled) return;

    setSending(true);
    setNotice(null); // 新しい操作を始めたら前の案内を消す（規則10）
    try {
      // 入力は消さない（規則10）。`'signedIn'` は何も出さない — 門が切り替える（規則9）。
      setNotice(await run(credentials.email, credentials.password));
    } finally {
      setSending(false);
    }
  }

  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return send(async (email, password) => {
      const outcome = await onSignIn(email, password);
      return outcome === 'rejected' ? 'signInRejected' : null;
    });
  }

  function signUp() {
    return send(async (email, password) => {
      const outcome = await onSignUp(email, password);
      if (outcome === 'rejected') return 'signUpRejected';
      if (outcome === 'confirmationRequired') return 'confirmationRequired';
      return null;
    });
  }

  return (
    // `noValidate` で、ブラウザの書式の検めを submit に挟ませない（規則5）。挟むと、ログインだけが
    // 書式で止まり「アカウントを作る」は止まらないという食い違いが出る。断るのは Supabase Auth の側。
    <form onSubmit={signIn} noValidate>
      <h2>{HEADING}</h2>

      <label>
        {FIELD_LABELS.email}
        {/* `type="email"` はブラウザの補助であって画面の判断ではない（設計 10章）。書式の検めは
            置かず、断るのは Supabase Auth の側（規則5）。 */}
        <input
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={changeField('email')}
        />
      </label>

      <label>
        {FIELD_LABELS.password}
        <input
          type="password"
          autoComplete="current-password"
          value={values.password}
          onChange={changeField('password')}
        />
      </label>

      {notice !== null && <p>{NOTICES[notice]}</p>}

      {/* 操作は2つ（規則7）。ログインが submit で、アカウントを作るは submit にしない —
          Enter で送ったときに意図せずアカウントができないようにする。 */}
      <button type="submit" disabled={disabled}>
        {sending ? SENDING_LABEL : SIGN_IN_LABEL}
      </button>
      <button type="button" disabled={disabled} onClick={signUp}>
        {sending ? SENDING_LABEL : SIGN_UP_LABEL}
      </button>
    </form>
  );
}
