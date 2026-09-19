/**
 * ログイン／サインアップのフォームの値から、資格情報を組み立てる（B-35 設計 5章 / 6章 規則4〜6）。
 *
 * 判断はここに置き、日本語と描画は `.tsx` が持つ（先行 `features/pantry/StockItemFormValues.ts`）。
 * React も `@supabase/*` も import しない（ADR-046 決定3）。
 *
 * **値は写すだけで、前後の空白も落とさず、メールの書式もパスワードの長さも確かめない**（規則5）。
 * 断るのは Supabase Auth の側で、継ぎ目が `'rejected'` で返す。画面が同じ判断を持つと、
 * 2か所が別々にずれていく（先行 B-12 規則4）。
 */

/** ログイン／サインアップの画面が持つ2欄の値。世帯は持たない（C-9 / ADR-028）。 */
export type SignInFormValues = {
  readonly email: string;
  readonly password: string;
};

/** メールとパスワードの組。継ぎ目の `signIn` / `signUp` に渡す（ADR-046 決定2）。 */
export type Credentials = {
  readonly email: string;
  readonly password: string;
};

/**
 * 開いた直後の値（規則6）。この値からは資格情報が作れない（規則4）—
 * 開いた直後に送れる状態にしないためである。
 */
export const EMPTY_SIGN_IN_FORM: SignInFormValues = {
  email: '',
  password: '',
};

/**
 * 資格情報を作る。作れない＝送れないときは null（規則4・5）。
 *
 * 作れない条件は2つだけ（規則4）— 往復しても必ず断られるものだけ手前で止める。
 * メールは `trim()` 後に空なら作らない（`trim()` は全角空白も落とす）。パスワードは**空文字だけ**が
 * 作れない条件で、空白だけのパスワードは断らずそのまま運ぶ — パスワードに正規化を掛けると、
 * 登録時と一致しなくなる。
 */
export function credentialsOf(values: SignInFormValues): Credentials | null {
  if (values.email.trim() === '') return null;
  if (values.password === '') return null;

  return { email: values.email, password: values.password };
}
