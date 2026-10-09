/**
 * ログインの画面（B-35 設計 4章 / 6章 規則7〜10 / 7章）。`docs/screen-design.md` 第8章の
 * 「ログイン」に当たる。**アカウントの作成は別の画面 `SignUpForm.tsx` が持つ**（B-73 / ADR-081）
 * — ここの `アカウントを作る` はその画面へ移る操作で、打った値を運ばない。
 *
 * ここは `SignInFormValues.ts` を読むだけの薄い層である。資格情報を作れるかの判断を持たない
 * — **描いて確かめられるようになった今も**（ADR-052）、判断は純粋関数に置くほうが速く、
 * 文言にも jsdom にも依存しない。
 *
 * 反対に、**日本語はここにしか置かない。** 文言の正は `docs/design/` の 14（ADR-074）、見た目の正は
 * `docs/design/README.md`（ADR-093）。
 * 見出し・欄・操作の名札とロゴはデザインの文言であり、デザインに無い案内は B-35 の文面である。
 *
 * **見た目の値は `SignInForm.module.css` にだけ置き、ここには class 名しか書かない**（ADR-055 決定1・2 /
 * B-68 設計 6章 規則11）。
 *
 * サインインの実行は引数で受け取る。画面が見るのは `Session.ts` の結末の型だけで、
 * `@supabase/*` は import しない（ADR-046 決定3 / 規則3）。
 */

import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { SignInOutcome } from '../../session/Session.js';
import type { SignInFormValues } from './SignInFormValues.js';
import { EMPTY_SIGN_IN_FORM, credentialsOf } from './SignInFormValues.js';
import styles from './SignInForm.module.css';

/** 画面の上に出すロゴ（B-68 設計 6章 規則2）。見出しにも段落にもしない文字1つ。 */
const LOGO = 'fridge to meal';

/** 画面の見出し（同 規則3）。 */
const HEADING = 'ログイン';

/** 欄の見出し。2欄とも必須なので「（任意）」は付けない（規則4）。 */
const FIELD_LABELS: Record<keyof SignInFormValues, string> = {
  email: 'メールアドレス',
  password: 'パスワード',
};

/** 操作2つの名札（規則7）。ログインはフォームの submit、アカウントを作るは作成画面へ移る操作（B-73）。 */
const SIGN_IN_LABEL = 'ログイン';
const SIGN_UP_LABEL = 'アカウントを作る';

/**
 * 送っている間の名札。見える文字は `…` だけにし、読み上げには `SENDING_NAME` を名前として渡す
 * — `…` だけでは何の操作か読み上げで伝わらない。受け付けないこと（規則7）は `disabled` でも示す。
 */
const SENDING_LABEL = '…';
const SENDING_NAME = '送っています';

/**
 * 画面が出す案内。**断りの1つだけ**になった（B-73 設計 6章 規則16。作成の断りと確認のメールの
 * 案内は作成画面へ移った）。**原因を断定しない**（規則8）— 継ぎ目の `'rejected'` は資格情報の
 * 誤りも通信不能も含むため、確かめることとして両方を並べる。
 */
const SIGN_IN_REJECTED_NOTICE =
  'ログインできませんでした。メールアドレスとパスワード、通信の状態を確かめて、もう一度お試しください。入力はそのままです。';

/**
 * 断りの案内に添える記号（B-68 設計 6章 規則9）。**色だけで分けない**ための手がかりであり
 * （NFR-17 の構え）、読み上げには出さない。
 */
const REJECTED_MARK = '!';

/**
 * class を在るものだけ空白で繋ぐ。`noUncheckedIndexedAccess` のもとで `styles.x` は
 * `string | undefined` であり、そのまま連結すると `"undefined"` が混ざる（先行 `TabbedScreen.tsx`）。
 */
const classOf = (...names: readonly (string | undefined)[]): string =>
  names.filter((name): name is string => name !== undefined).join(' ');

export type SignInFormProps = {
  /** サインインの実行。失敗は reject ではなく結末の値で返る（`Session.ts` 規則7）。 */
  onSignIn: (email: string, password: string) => Promise<SignInOutcome>;
  /** 作成画面へ移る（B-73 設計 6章 規則14・16）。打った値は渡さない。 */
  onOpenSignUp: () => void;
  /** 作成画面から戻った直後なら真。`アカウントを作る` に焦点を戻す（同 規則15 / 先行 B-65b）。 */
  returnedFromSignUp?: boolean;
};

export function SignInForm({
  onSignIn,
  onOpenSignUp,
  returnedFromSignUp = false,
}: SignInFormProps) {
  const [values, setValues] = useState<SignInFormValues>(EMPTY_SIGN_IN_FORM);
  const [sending, setSending] = useState(false);
  const [rejected, setRejected] = useState(false);
  const signUpButton = useRef<HTMLButtonElement>(null);

  const credentials = credentialsOf(values);

  // 資格情報が作れない間と送っている間は、ログインを効かせない（規則7）。
  const disabled = credentials === null || sending;

  // 閉じた作成画面を開いた操作へ焦点を戻す（B-73 設計 6章 規則15）。開いた直後のログインでは当てない。
  useEffect(() => {
    if (returnedFromSignUp) signUpButton.current?.focus();
  }, [returnedFromSignUp]);

  function changeField(field: keyof SignInFormValues) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setValues((previous) => ({ ...previous, [field]: event.target.value }));
    };
  }

  /**
   * ログインの送り方。**`catch` しない**（7章）— 失敗は値で返す約束であり、包むと継ぎ目の
   * 約束違反が隠れる。送っている状態だけは `finally` で戻す。
   */
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;

    setSending(true);
    setRejected(false); // 新しい操作を始めたら前の案内を消す（規則10）
    try {
      // 入力は消さない（規則10）。`'signedIn'` は何も出さない — 門が切り替える（規則9）。
      setRejected((await onSignIn(credentials.email, credentials.password)) === 'rejected');
    } finally {
      setSending(false);
    }
  }

  return (
    // 根の中に「ロゴ → フォーム」の順で置き、フォームは下寄せにする（B-68 設計 6章 規則1）。
    <div className={classOf(styles.screen)}>
      <div className={classOf(styles.logo)}>{LOGO}</div>

      {/* `noValidate` で、ブラウザの書式の検めを submit に挟ませない（規則5）。断るのは Supabase Auth の側。 */}
      <form onSubmit={signIn} noValidate className={classOf(styles.form)}>
        {/* 門の signedOut 枝でこの画面だけが描かれ、上位の見出しが無いので h1 にする（B-68 規則3）。 */}
        <h1 className={classOf(styles.heading)}>{HEADING}</h1>

        <div className={classOf(styles.fields)}>
          {/* `<label>` が欄を包む形は変えない — 欄の名札が保たれる（B-68 規則4）。 */}
          <label className={classOf(styles.field)}>
            <span className={classOf(styles.fieldLabel)}>{FIELD_LABELS.email}</span>
            {/* `type="email"` はブラウザの補助であって画面の判断ではない（設計 10章）。書式の検めは
                置かず、断るのは Supabase Auth の側（規則5）。作成画面の検証はここに当てない
                — 既存のアカウントを締め出さない（B-73 設計 6章 規則6）。 */}
            <input
              type="email"
              autoComplete="email"
              value={values.email}
              onChange={changeField('email')}
              className={classOf(styles.input)}
            />
          </label>

          <label className={classOf(styles.field)}>
            <span className={classOf(styles.fieldLabel)}>{FIELD_LABELS.password}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={values.password}
              onChange={changeField('password')}
              className={classOf(styles.input, styles.passwordInput)}
            />
          </label>
        </div>

        {rejected && (
          <p className={classOf(styles.notice, styles.noticeRejected)}>
            {/* 記号を添え、読み上げでは文を変えない（B-68 規則9 / NFR-17）。 */}
            <span aria-hidden="true" className={classOf(styles.noticeMark)}>
              {REJECTED_MARK}
            </span>
            {SIGN_IN_REJECTED_NOTICE}
          </p>
        )}

        {/* 操作は2つ（規則7）。ログインが submit で、アカウントを作るは submit にしない —
            作成画面へ移る操作であり、入力の有無では止めない（B-73 設計 6章 規則16）。
            主と副は別の class（B-68 規則6・7）。 */}
        <button
          type="submit"
          disabled={disabled}
          aria-label={sending ? SENDING_NAME : undefined}
          className={classOf(styles.primary)}
        >
          {sending ? SENDING_LABEL : SIGN_IN_LABEL}
        </button>
        <button
          ref={signUpButton}
          type="button"
          // 送っている間だけ効かない — 移ると結末の案内が出ないまま捨てられる（B-73 規則16）。
          disabled={sending}
          onClick={onOpenSignUp}
          className={classOf(styles.secondary)}
        >
          {SIGN_UP_LABEL}
        </button>
      </form>
    </div>
  );
}
