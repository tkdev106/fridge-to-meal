/**
 * ログイン／サインアップの画面（B-35 設計 4章 / 6章 規則7〜10 / 7章）。`docs/screen-design.md` 第8章の
 * 「ログイン／サインアップ」1画面に当たる。
 *
 * ここは `SignInFormValues.ts` を読むだけの薄い層である。資格情報を作れるかの判断を持たない
 * — **描いて確かめられるようになった今も**（ADR-052）、判断は純粋関数に置くほうが速く、
 * 文言にも jsdom にも依存しない。
 *
 * 反対に、**日本語はここにしか置かない。** 文言と見た目の正は ADR-074 で `docs/design/` に移った
 * （原本 14-sp。`docs/screen-design.md` 論点3 の「未確定」はここで解けた）。見出し・欄・操作の
 * 名札とロゴは原本の文言であり、案内と「送っています…」は原本に無いため B-35 の文面を据え置く。
 *
 * **見た目の値は `SignInForm.module.css` にだけ置き、ここには class 名しか書かない**（ADR-055 決定1・2 /
 * B-68 設計 6章 規則11）。
 *
 * サインインとサインアップの実行は引数で受け取る。画面が見るのは `Session.ts` の結末の型だけで、
 * `@supabase/*` は import しない（ADR-046 決定3 / 規則3）。
 */

import type { ChangeEvent, FormEvent } from 'react';
import { useState } from 'react';
import type { SignInOutcome, SignUpOutcome } from '../../session/Session.js';
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

/**
 * 断りの案内に添える記号（B-68 設計 6章 規則9）。**色だけで分けない**ための手がかりであり
 * （NFR-17 の構え）、読み上げには出さない。
 */
const REJECTED_MARK = '!';

/** 断りの案内か。記号と配色はこれだけで決まる（同 規則9）。 */
const isRejection = (notice: Notice): boolean => notice !== 'confirmationRequired';

/**
 * class を在るものだけ空白で繋ぐ。`noUncheckedIndexedAccess` のもとで `styles.x` は
 * `string | undefined` であり、そのまま連結すると `"undefined"` が混ざる（先行 `TabbedScreen.tsx`）。
 */
const classOf = (...names: readonly (string | undefined)[]): string =>
  names.filter((name): name is string => name !== undefined).join(' ');

/** 案内の帯に当てる class。断りの帯と控えめな帯を分ける（同 規則9 / NFR-16）。 */
const noticeClassOf = (notice: Notice): string =>
  classOf(styles.notice, isRejection(notice) ? styles.noticeRejected : styles.noticeQuiet);

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
    // 根の中に「ロゴ → フォーム」の順で置き、フォームは下寄せにする（B-68 設計 6章 規則1）。
    <div className={classOf(styles.screen)}>
      <div className={classOf(styles.logo)}>{LOGO}</div>

      {/* `noValidate` で、ブラウザの書式の検めを submit に挟ませない（規則5）。挟むと、ログインだけが
          書式で止まり「アカウントを作る」は止まらないという食い違いが出る。断るのは Supabase Auth の側。 */}
      <form onSubmit={signIn} noValidate className={classOf(styles.form)}>
        {/* 門の signedOut 枝でこの画面だけが描かれ、上位の見出しが無いので h1 にする（B-68 規則3）。 */}
        <h1 className={classOf(styles.heading)}>{HEADING}</h1>

        <div className={classOf(styles.fields)}>
          {/* `<label>` が欄を包む形は変えない — 欄の名札が保たれる（B-68 規則4）。 */}
          <label className={classOf(styles.field)}>
            <span className={classOf(styles.fieldLabel)}>{FIELD_LABELS.email}</span>
            {/* `type="email"` はブラウザの補助であって画面の判断ではない（設計 10章）。書式の検めは
                置かず、断るのは Supabase Auth の側（規則5）。 */}
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

        {notice !== null && (
          <p className={noticeClassOf(notice)}>
            {/* 断りの帯にだけ記号を添え、読み上げでは文を変えない（B-68 規則9 / NFR-17）。 */}
            {isRejection(notice) && (
              <span aria-hidden="true" className={classOf(styles.noticeMark)}>
                {REJECTED_MARK}
              </span>
            )}
            {NOTICES[notice]}
          </p>
        )}

        {/* 操作は2つ（規則7）。ログインが submit で、アカウントを作るは submit にしない —
            Enter で送ったときに意図せずアカウントができないようにする。主と副は別の class
            （B-68 規則6・7）。 */}
        <button type="submit" disabled={disabled} className={classOf(styles.primary)}>
          {sending ? SENDING_LABEL : SIGN_IN_LABEL}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={signUp}
          className={classOf(styles.secondary)}
        >
          {sending ? SENDING_LABEL : SIGN_UP_LABEL}
        </button>
      </form>
    </div>
  );
}
