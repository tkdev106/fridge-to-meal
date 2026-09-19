/**
 * セッションの継ぎ目（B-34 設計 5章 / 6章 規則1〜9 / ADR-046 決定3）。
 *
 * **画面が見るのはこのファイルの型だけである。** アクセストークンの取得・保持・更新・破棄は
 * この背後に閉じ、`@supabase/supabase-js` の型は**再輸出でも型引数でも出さない**（規則1）。
 * 腐敗防止層（ADR-005）と同じ置き方を、web の中でもう一度したものである（ADR-046 決定3）。
 * **層を増やしたのではない** — `docs/adr.md` A章 の表は `apps/web/` をまとめて扱う。
 *
 * **`Session` は用語表の語ではない**（設計 3章）。献立や在庫のようなドメインの概念ではなく、
 * web の中の継ぎ目の名である。
 */

/**
 * 画面が門の出し分けに使う3値（規則6）。
 *
 * **`unknown` を `signedOut` に倒さない。** 保存されたセッションの復元は非同期で、
 * 倒すとサインイン済みの利用者にログイン画面が一瞬見える（ADR-046 結果4 の門が使う）。
 */
export type SessionState = 'unknown' | 'signedOut' | 'signedIn';

/** サインインの結末（規則7）。通らなかった理由の種別はまだ分けない。 */
export type SignInOutcome = 'signedIn' | 'rejected';

/**
 * サインアップの結末（規則7）。
 *
 * `confirmationRequired` は、メールの確認を要する設定のときに返る。**実プロジェクトの設定は
 * 未確認である**（設計 10章）— 確認が要らないと判ったら、この変種は落としてよい。
 */
export type SignUpOutcome = 'signedIn' | 'confirmationRequired' | 'rejected';

/** 継ぎ目の口。画面はこの型だけを受け取る（規則1）。 */
export type Session = {
  /** アカウントを作る（FR-25）。パスワードは受け取って渡すだけで、保持も記憶もしない（規則9）。 */
  signUp(email: string, password: string): Promise<SignUpOutcome>;

  /** サインインする（FR-25）。失敗は例外にせず結末の値で返す（規則7）。 */
  signIn(email: string, password: string): Promise<SignInOutcome>;

  /**
   * サインアウトする（FR-25）。
   *
   * **手元のセッションは必ず捨てる**（規則8）。サーバ側の取り消しに失敗しても、
   * 画面はサインアウトした状態になる — 残るより消えるほうが安全側である。
   */
  signOut(): Promise<void>;

  /**
   * いま有効なアクセストークン。サインインしていなければ `null`（規則3）。
   *
   * **画面は期限を見ず、トークンを抱えない。** 要るたびにここへ聞く — B-22 / B-24 が
   * `Authorization: Bearer` に載せる値をこの口から取る（ADR-043 / B-08）。
   */
  accessToken(): Promise<string | null>;

  /**
   * 状態の変化を購読する（規則5）。
   *
   * **購読を始めた時点の状態をまず1度渡し**、以後は変わったときだけ渡す。
   * 戻り値を呼ぶと購読をやめる — やめられないと、門を張り替えるたびに購読が積もる。
   */
  subscribe(onChange: (state: SessionState) => void): () => void;
};
