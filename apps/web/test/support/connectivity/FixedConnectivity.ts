/**
 * 接続状態の継ぎ目（`src/connectivity/Connectivity.ts`）の**記憶上の実装**（B-70 設計 4章・5章）。
 *
 * **`vi.mock` も `vi.fn()` も使わない**（`docs/testing.md` 2章）。状態は自分で持ち、テストが
 * `emit` で切り替える（先行 `FixedSession.emit`）。
 */

import type { Connectivity, ConnectivityState } from '../../../src/connectivity/Connectivity.js';

export type FixedConnectivityOptions = {
  /** 購読を始めた時点の状態。既定は接続している状態。 */
  readonly initialState?: ConnectivityState;
};

export class FixedConnectivity implements Connectivity {
  readonly #subscribers: ((state: ConnectivityState) => void)[] = [];
  #state: ConnectivityState;

  constructor(options: FixedConnectivityOptions = {}) {
    this.#state = options.initialState ?? 'online';
  }

  /** 状態の変化を購読者へ配る（接続が切れた・戻ったことの再現）。 */
  emit(state: ConnectivityState): void {
    this.#state = state;

    for (const onChange of [...this.#subscribers]) onChange(state);
  }

  /** **購読を始めた時点の状態をまず1度渡す**（`Connectivity.ts`）。 */
  subscribe(onChange: (state: ConnectivityState) => void): () => void {
    this.#subscribers.push(onChange);
    onChange(this.#state);

    return () => {
      const index = this.#subscribers.indexOf(onChange);
      if (index >= 0) this.#subscribers.splice(index, 1);
    };
  }
}
