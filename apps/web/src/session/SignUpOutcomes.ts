import type { SignUpOutcome } from './Session.js';

/**
 * サインアップの応答から結末を選ぶ（B-73 設計 6章 規則1 / ADR-081）。
 *
 * **判断はここに置き、`SessionImpl` は詰め替えて渡すだけにする**（同 規則2）。Supabase の型は
 * 引数にも戻り値にも出さない — 見るのは断りの `code` の文字列とセッションの有無だけで、
 * `@supabase/*` を import しない（ADR-046 決定3）。
 *
 * アカウントを作る相手は Supabase Auth であり、api はサインアップを受けない（ADR-046）。
 * **サーバ側の検証はここで種別に読み分けて画面へ届ける**（ADR-081）。
 */

/** サインアップの応答のうち、結末の判断に要るものだけ。 */
export type SignUpResult = {
  /** 断られたときだけ非 null。`code` はライブラリの断りの `code` をそのまま写す */
  readonly error: { readonly code: string | undefined } | null;
  /** セッションが返ったか */
  readonly sessionReturned: boolean;
};

/**
 * 断りの `code` と結末の対応。**ここに無い `code` はすべて `rejected`**（通信不能・回数制限・
 * サインアップの無効など）— 画面は原因を断定しない文言を出す（B-35 規則8 の構え）。
 */
const REJECTIONS: ReadonlyMap<string, SignUpOutcome> = new Map([
  ['weak_password', 'weakPassword'],
  ['email_address_invalid', 'invalidEmail'],
  ['user_already_exists', 'alreadyRegistered'],
  ['email_exists', 'alreadyRegistered'],
]);

/**
 * 結末を選ぶ。**セッションの有無を見るのは断りが無いときだけ**である。
 *
 * セッションが返らずに利用者だけができたときがメールの確認待ちになる。メールの確認が有効な
 * 設定では、確認済みのアドレスへのサインアップも断られずにこの形で返る（列挙対策。B-73 設計
 * 10章 前提1）ため、登録済みかどうかはここでは判定しない。
 */
export function signUpOutcomeOf(result: SignUpResult): SignUpOutcome {
  if (result.error === null) {
    return result.sessionReturned ? 'signedIn' : 'confirmationRequired';
  }

  const code = result.error.code;
  return (code === undefined ? undefined : REJECTIONS.get(code)) ?? 'rejected';
}
