/**
 * セッションの継ぎ目（`src/session/Session.ts`）の**記憶上の実装**（B-40 設計 4章 / 5章 /
 * 6章 規則5）。
 *
 * **`vi.mock` も `vi.fn()` も使わない**（`docs/testing.md` 2章）。受け取った資格情報は
 * 自分の状態として持ち、テストが観るのは `receivedCredentials` と、配った結末が画面に
 * 起こしたことだけである。
 *
 * **`@supabase/*` を1つも触らない**（ADR-046 決定3 / 設計 9章）。本物の代役であっても、
 * 継ぎ目の外に Supabase の型を出さないという規則はそのまま当てはまる。
 */

import type {
  Session,
  SessionState,
  SignInOutcome,
  SignUpOutcome,
} from '../../../src/session/Session.js';
import type { Delivery } from '../HeldDelivery.js';
import { DeliveryLine, PendingReleases } from '../HeldDelivery.js';

export type FixedSessionOptions = {
  /** 購読を始めた時点の状態（`Session.ts` 規則5）。既定はサインインしていない状態。 */
  readonly initialState?: SessionState;
  /** サインインの結末の台本。**渡さなかった口は呼ばれたら落ちる**（設計 7章 行1）。 */
  readonly signIn?: readonly Delivery<SignInOutcome>[];
  /** サインアップの結末の台本。同上。 */
  readonly signUp?: readonly Delivery<SignUpOutcome>[];
  /** `accessToken()` が返す値。既定は `null`（サインインしていない。`Session.ts` 規則3）。 */
  readonly accessToken?: string | null;
};

/** 口へ届いた資格情報1つぶん。**どちらの口へ届いたかも事実として残す。** */
export type ReceivedCredentials = {
  readonly operation: 'signIn' | 'signUp';
  readonly email: string;
  readonly password: string;
};

export class FixedSession implements Session {
  readonly #pending = new PendingReleases();
  readonly #signIn: DeliveryLine<SignInOutcome>;
  readonly #signUp: DeliveryLine<SignUpOutcome>;
  readonly #accessToken: string | null;
  readonly #receivedCredentials: ReceivedCredentials[] = [];
  readonly #subscribers: ((state: SessionState) => void)[] = [];
  #state: SessionState;

  constructor(options: FixedSessionOptions = {}) {
    this.#state = options.initialState ?? 'signedOut';
    this.#accessToken = options.accessToken ?? null;
    this.#signIn = new DeliveryLine(
      options.signIn ?? [],
      this.#pending,
      'この観点ではサインインを呼ばない',
    );
    this.#signUp = new DeliveryLine(
      options.signUp ?? [],
      this.#pending,
      'この観点ではサインアップを呼ばない',
    );
  }

  /** 口へ届いた資格情報を、届いた順に。**値は加工しない**（ADR-046 決定2）。 */
  get receivedCredentials(): readonly ReceivedCredentials[] {
    return this.#receivedCredentials;
  }

  /** 保留している結末を解く（設計 6章 規則7）。 */
  settle(): void {
    this.#pending.settle();
  }

  /**
   * 状態の変化を購読者へ配る。**保存されたセッションの復元**（`Session.ts` 規則5・6）と
   * サインアウトの再現に使う。
   */
  emit(state: SessionState): void {
    this.#state = state;

    for (const onChange of [...this.#subscribers]) onChange(state);
  }

  signUp(email: string, password: string): Promise<SignUpOutcome> {
    // **記録は結末を配るより先である**（先行 `FixedHttpFetch`）。呼ばれたことは、
    // そのあと落ちても事実である。
    this.#receivedCredentials.push({ operation: 'signUp', email, password });

    return this.#signUp.deliver();
  }

  signIn(email: string, password: string): Promise<SignInOutcome> {
    this.#receivedCredentials.push({ operation: 'signIn', email, password });

    return this.#signIn.deliver();
  }

  /**
   * サインアウトする。**手元のセッションを必ず捨てる**（`Session.ts` 規則8）ので、
   * 購読者には `'signedOut'` が届く。
   */
  signOut(): Promise<void> {
    this.emit('signedOut');

    return Promise.resolve();
  }

  accessToken(): Promise<string | null> {
    return Promise.resolve(this.#accessToken);
  }

  /** **購読を始めた時点の状態をまず1度渡す**（`Session.ts` 規則5）。 */
  subscribe(onChange: (state: SessionState) => void): () => void {
    this.#subscribers.push(onChange);
    onChange(this.#state);

    return () => {
      const index = this.#subscribers.indexOf(onChange);
      if (index >= 0) this.#subscribers.splice(index, 1);
    };
  }
}
