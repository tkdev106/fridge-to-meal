/**
 * アカウント作成の画面（B-73 設計 6章 規則7〜17 / ADR-081）。`docs/screen-design.md` 第8章の
 * 「アカウント作成」に当たる。
 *
 * 入力はメールアドレスとパスワードだけである。
 *
 * 検証は2段である（ADR-081）。**画面の検証**（書式・長さ）は `SignUpFormValues.ts` の純粋関数が
 * 判断し、満たさない欄は送らずに欄の下に理由を出す。**サーバの検証**はアカウントを作る相手の
 * Supabase Auth が行い、継ぎ目が種別に読み分けた結末（`SignUpOutcome`）をここが文言にする。
 *
 * **日本語はここにしか置かない。** 見た目はログインの画面（デザイン 14）に揃え、値は
 * `SignInForm.module.css` の class を引いて共有する（規則17）。足りない値だけ `SignUpForm.module.css`。
 * `@supabase/*` は import しない（ADR-046 決定3）。
 */

import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import type { SignUpOutcome } from '../../session/Session.js';
import type { EmailProblem, PasswordProblem, SignUpFormValues } from './SignUpFormValues.js';
import { EMPTY_SIGN_UP_FORM, signUpCheckOf } from './SignUpFormValues.js';
import shared from './SignInForm.module.css';
import styles from './SignUpForm.module.css';

/** ロゴ（ログインの画面と同じ文字。B-68 規則2）。 */
const LOGO = 'fridge to meal';

/** 見出し。完了の案内に置き換わっても残す（規則12）。 */
const HEADING = 'アカウントを作る';

const FIELD_LABELS: Record<keyof SignUpFormValues, string> = {
  email: 'メールアドレス',
  password: 'パスワード',
};

/** 主の操作と戻る操作の名札（規則7・13）。 */
const SUBMIT_LABEL = 'アカウントを作る';
const BACK_LABEL = 'ログイン画面へ戻る';
const DONE_BACK_LABEL = 'ログイン画面へ';
const SENDING_LABEL = '送っています…';

/** 欄の下の理由（規則3・4・8）。下限と上限の数は `SignUpFormValues.ts` の値と揃える。 */
const EMAIL_PROBLEMS: Record<EmailProblem, string> = {
  empty: 'メールアドレスを入力してください。',
  tooLong: 'メールアドレスは 254 文字以内で入力してください。',
  malformed: 'メールアドレスの形式が正しくありません（例: name@example.com）。空白は使えません。',
};

const PASSWORD_PROBLEMS: Record<PasswordProblem, string> = {
  empty: 'パスワードを入力してください。',
  tooShort: 'パスワードは 8 文字以上にしてください。',
  tooLong:
    'パスワードが長すぎます。半角英数字なら 72 文字以内（全角文字は 1 文字を 3 文字分と数えます）にしてください。',
};

/** パスワードの欄の下に常に出す決まり。理由が出ている間は理由に譲る。 */
const PASSWORD_HINT = '8 文字以上';

/** サーバの断り（規則11）。`rejected` は原因を断定しない（B-35 規則8 の構え）。 */
type Rejection = Exclude<SignUpOutcome, 'signedIn' | 'confirmationRequired'>;

const REJECTIONS: Record<Rejection, string> = {
  weakPassword:
    'このパスワードは使えません。より長いパスワードや、推測されにくいパスワードにしてください。',
  invalidEmail: 'このメールアドレスでは作れません。メールアドレスを確かめてください。',
  alreadyRegistered:
    'このメールアドレスのアカウントはすでにあります。ログイン画面からログインしてください。',
  rejected:
    'アカウントを作れませんでした。通信の状態を確かめて、しばらくしてからもう一度お試しください。入力はそのままです。',
};

/** 確認のメールの案内（規則12）。登録済みのアドレスでも同じ形で返るため、その場合の一文を添える。 */
const DONE_LINES = [
  '確認のメールを送りました。',
  'メールの中のリンクを開いてから、同じメールアドレスとパスワードでログインしてください。',
  'すでにアカウントがある場合はメールは届きません。ログイン画面からログインしてください。',
] as const;

const REJECTED_MARK = '!';

const classOf = (...names: readonly (string | undefined)[]): string =>
  names.filter((name): name is string => name !== undefined).join(' ');

export type SignUpFormProps = {
  /** サインアップの実行。失敗は reject ではなく結末の値で返る（`Session.ts` 規則7）。 */
  onSignUp: (email: string, password: string) => Promise<SignUpOutcome>;
  /** ログインの画面へ戻る（規則13）。何も保存しない。 */
  onBackToSignIn: () => void;
};

export function SignUpForm({ onSignUp, onBackToSignIn }: SignUpFormProps) {
  const [values, setValues] = useState<SignUpFormValues>(EMPTY_SIGN_UP_FORM);
  // 初めて送ろうとしたか。以後だけ理由を出す（規則8）。
  const [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const [done, setDone] = useState(false);

  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const doneMessage = useRef<HTMLParagraphElement>(null);
  const emailProblemId = useId();
  const passwordProblemId = useId();
  const passwordHintId = useId();

  const check = signUpCheckOf(values);
  const emailProblem = attempted && !check.ok ? check.problems.email : null;
  const passwordProblem = attempted && !check.ok ? check.problems.password : null;

  // 完了の案内が出た直後は案内の文へ焦点を移す（規則12）。
  useEffect(() => {
    if (done) doneMessage.current?.focus();
  }, [done]);

  function changeField(field: keyof SignUpFormValues) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setValues((previous) => ({ ...previous, [field]: event.target.value }));
    };
  }

  /** 送り方。**`catch` しない**（B-35 設計 7章）。送っている状態だけは `finally` で戻す。 */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;

    setAttempted(true);
    if (!check.ok) {
      // 最初の不正な欄へ焦点を移し、口へは何も届けない（規則9）。
      (check.problems.email !== null ? emailInput : passwordInput).current?.focus();
      return;
    }

    setSending(true);
    setRejection(null); // 新しく送るときは前の案内を消す（規則10）
    try {
      const outcome = await onSignUp(check.credentials.email, check.credentials.password);
      // `'signedIn'` は何も出さない — 門が切り替える（規則10）。入力は消さない（B-35 規則10）。
      if (outcome === 'confirmationRequired') setDone(true);
      else if (outcome !== 'signedIn') setRejection(outcome);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={classOf(shared.screen)}>
      <div className={classOf(shared.logo)}>{LOGO}</div>

      {done ? (
        <div className={classOf(shared.form)}>
          <h1 className={classOf(shared.heading)}>{HEADING}</h1>
          {/* 文全体を1つの段落にし、焦点を受けられるようにする（規則12）。 */}
          <p ref={doneMessage} tabIndex={-1} className={classOf(styles.done)}>
            {DONE_LINES.map((line) => (
              <span key={line} className={classOf(styles.doneLine)}>
                {line}
              </span>
            ))}
          </p>
          <button type="button" onClick={onBackToSignIn} className={classOf(shared.primary)}>
            {DONE_BACK_LABEL}
          </button>
        </div>
      ) : (
        // `noValidate` でブラウザの検めを挟ませない — 理由はこの画面が欄の下に出す（規則7）。
        <form onSubmit={submit} noValidate className={classOf(shared.form)}>
          <h1 className={classOf(shared.heading)}>{HEADING}</h1>

          <div className={classOf(shared.fields)}>
            <label className={classOf(shared.field)}>
              <span className={classOf(shared.fieldLabel)}>{FIELD_LABELS.email}</span>
              <input
                ref={emailInput}
                type="email"
                autoComplete="email"
                // 開いた直後はメールの欄に焦点を当てる（規則15。先行 `StockItemForm`）。
                autoFocus
                value={values.email}
                onChange={changeField('email')}
                aria-invalid={emailProblem !== null ? true : undefined}
                aria-describedby={emailProblem !== null ? emailProblemId : undefined}
                className={classOf(
                  shared.input,
                  emailProblem !== null ? styles.invalid : undefined,
                )}
              />
            </label>
            {emailProblem !== null && (
              <span id={emailProblemId} className={classOf(styles.problem)}>
                {EMAIL_PROBLEMS[emailProblem]}
              </span>
            )}

            <label className={classOf(shared.field)}>
              <span className={classOf(shared.fieldLabel)}>{FIELD_LABELS.password}</span>
              <input
                ref={passwordInput}
                type="password"
                autoComplete="new-password"
                value={values.password}
                onChange={changeField('password')}
                aria-invalid={passwordProblem !== null ? true : undefined}
                // 理由が出ている間は理由に、それ以外は決まり（8 文字以上）に結ぶ。
                aria-describedby={passwordProblem !== null ? passwordProblemId : passwordHintId}
                className={classOf(
                  shared.input,
                  shared.passwordInput,
                  passwordProblem !== null ? styles.invalid : undefined,
                )}
              />
            </label>
            {passwordProblem !== null ? (
              <span id={passwordProblemId} className={classOf(styles.problem)}>
                {PASSWORD_PROBLEMS[passwordProblem]}
              </span>
            ) : (
              <span id={passwordHintId} className={classOf(styles.hint)}>
                {PASSWORD_HINT}
              </span>
            )}
          </div>

          {rejection !== null && (
            <p className={classOf(shared.notice, shared.noticeRejected)}>
              <span aria-hidden="true" className={classOf(shared.noticeMark)}>
                {REJECTED_MARK}
              </span>
              {REJECTIONS[rejection]}
            </p>
          )}

          <button type="submit" disabled={sending} className={classOf(shared.primary)}>
            {sending ? SENDING_LABEL : SUBMIT_LABEL}
          </button>
          <button
            type="button"
            // 送っている間は戻らせない — 結末の届く前に閉じると案内が出ないまま捨てられる（規則13）。
            disabled={sending}
            onClick={onBackToSignIn}
            className={classOf(shared.secondary)}
          >
            {BACK_LABEL}
          </button>
        </form>
      )}
    </div>
  );
}
