import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import type { SessionConfig } from './SessionConfig.js';
import type { Session, SessionState, SignInOutcome, SignUpOutcome } from './Session.js';
import { signUpOutcomeOf } from './SignUpOutcomes.js';

/**
 * `Session` の実装（B-34 設計 4章・5章 / 6章 規則1〜9）。
 *
 * **腐敗防止層である**（ADR-005 と同じ置き方を web の中で行う。ADR-046 決定3）。
 * `@supabase/supabase-js` の語と型はこのファイルに閉じ、外へ出ていくのは `Session.ts` の型と
 * 文字列だけである（規則1）。**このクラスを `new` してよいのは web の入口だけ**で、
 * 結線は `main.tsx` にある（規則2 / B-35）。
 *
 * **薄い写しに留める**（設計 10章）。`HouseholdAuthenticatorImpl` は `kid` の選び方や鍵の保持と
 * いった判断を持つのでテストで観察するが、こちらは委譲しかないため単体テストを置かない
 * （`docs/testing.md` 5章 — 本物の外部に出る部分を `pnpm test` で観察しない）。
 * **判断が増えたら**（再試行・失敗の種別分け・独自の期限管理）、その周で内側の口を起こすか決め直す。
 */
export class SessionImpl implements Session {
  private readonly client: SupabaseClient;

  constructor(config: SessionConfig) {
    this.client = createClient(config.url, config.anonKey, {
      auth: {
        // 保持と更新はライブラリに委ねる（規則4 / ADR-046 理由1）。アクセストークンの寿命は
        // 3600 秒で、回転と同時実行の扱いを自前で書く価値が無い。
        persistSession: true,
        autoRefreshToken: true,
        // 方式はメールとパスワードであり、URL から戻ってくる経路が無い（規則4 / ADR-046 決定2）。
        // 切らないと、アプリの URL に現れた断片をライブラリが毎回読みにいく。
        detectSessionInUrl: false,
      },
    });
  }

  /**
   * アカウントを作る（FR-25 / 規則7）。
   *
   * **判断は持たない** — 応答を `SignUpResult` に詰め替えて `signUpOutcomeOf` に渡すだけである
   * （B-73 設計 6章 規則2 / ADR-081）。断りの種別分けとセッションの有無の読みはあちらにあり、
   * `pnpm test` で観察する。
   */
  async signUp(email: string, password: string): Promise<SignUpOutcome> {
    const { data, error } = await this.client.auth.signUp({ email, password });

    return signUpOutcomeOf({
      error: error === null ? null : { code: error.code },
      sessionReturned: data.session !== null,
    });
  }

  /**
   * サインインする（FR-25 / 規則7）。
   *
   * **通らなかった理由の種別は分けない。** 資格情報の誤りも通信不能も `'rejected'` に倒れる
   * （設計 10章）。B-35 はこのままにすると判断した — 分けるにはここに「どの失敗か」の判断が増え、
   * 内側の口を起こしてテストする形に膨らむ。代わりに**画面の断りの文言が原因を断定しない**
   * （B-35 設計 6章 規則8）。分けると決まったら、足すのは `Session.ts` の結末の変種とここの写しである。
   */
  async signIn(email: string, password: string): Promise<SignInOutcome> {
    const { error } = await this.client.auth.signInWithPassword({ email, password });

    return error === null ? 'signedIn' : 'rejected';
  }

  /**
   * サインアウトする（FR-25 / 規則8）。
   *
   * **戻り値の `error` を捨てる。** サーバ側の取り消しに失敗しても、ライブラリは手元の
   * セッションを消してから error を返す（`GoTrueClient._signOut`。2026-09-19 に実装を読んで
   * 確かめた）ので、**利用者から見た結末は「サインアウトした」で揃う。** 残るより消えるほうが
   * 安全側であり、画面に選ばせる余地は無い。
   */
  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  /**
   * いま有効なアクセストークン（規則3）。
   *
   * `getSession()` は**必要なら更新してから返す**ので、期限の判断をこちらに持たない。
   * サインインしていなければ `null` を返す — B-22 / B-24 は `Authorization` を付けずに
   * 送るのではなく、**呼ぶ前に門で止まる**（B-35 の門）。
   */
  async accessToken(): Promise<string | null> {
    const { data } = await this.client.auth.getSession();

    return data.session?.access_token ?? null;
  }

  /**
   * 状態の変化を購読する（規則5・規則6）。
   *
   * **まず `'unknown'` を1度渡す。** 保存されたセッションの復元は非同期であり、購読を始めた
   * 時点では本当に分かっていない。ライブラリは登録の直後に最初の通知を送るので、復元が済めば
   * `'signedIn'` か `'signedOut'` が続けて届く。
   *
   * **同じ状態を2度渡さない。** ライブラリは更新のたびにも通知するが、画面から見た状態は
   * 変わっていない。直前に渡した値を購読ごとに覚えて差分だけを流す — 覚えるのはこの関数の
   * 中だけで、クラスは状態を持たない。
   */
  subscribe(onChange: (state: SessionState) => void): () => void {
    let delivered: SessionState = 'unknown';
    onChange(delivered);

    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      const next: SessionState = session === null ? 'signedOut' : 'signedIn';
      if (next === delivered) return;

      delivered = next;
      onChange(next);
    });

    return () => data.subscription.unsubscribe();
  }
}
