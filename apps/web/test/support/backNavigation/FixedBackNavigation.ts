/**
 * 端末の「戻る」の継ぎ目（`src/backNavigation/BackNavigation.ts`）の**記憶上の実装**
 * （B-74 設計 4章・5章）。
 *
 * **`vi.mock` も `vi.fn()` も使わない**（`docs/testing.md` 2章）。登録された口は自分で持ち、
 * テストが `pressBack()` で「利用者が戻るを押した」ことにする（先行 `FixedConnectivity.emit`）。
 * 履歴（`pushState` / `popstate`）は持たない — それは `BackNavigationImpl` の持ち分であり、
 * 偽の窓で別に確かめる（`test/backNavigation/BackNavigationImpl.test.ts`）。
 *
 * **`pressBack()` は `act` で包んで呼ぶ** — 口は画面の状態を変える。
 */

import type {
  BackHandlerRank,
  BackNavigation,
} from '../../../src/backNavigation/BackNavigation.js';

type Registration = { readonly onBack: () => void; readonly rank: BackHandlerRank };

export class FixedBackNavigation implements BackNavigation {
  readonly #registrations: Registration[] = [];

  register(onBack: () => void, rank: BackHandlerRank): () => void {
    const registration: Registration = { onBack, rank };
    this.#registrations.push(registration);

    return () => {
      const index = this.#registrations.indexOf(registration);
      if (index >= 0) this.#registrations.splice(index, 1);
    };
  }

  /**
   * 利用者が戻るを押したことにする。**呼ぶ口は1つだけ** — `'screen'` の口のうち最後に
   * 登録されたもの、それが無ければ `'tab'` の口のうち最後に登録されたもの（設計 6章 規則4）。
   *
   * 呼んだら `true`、呼ぶ口が無ければ（アプリを離れる回。規則3）`false` を返す。
   */
  pressBack(): boolean {
    const target = this.#latestOf('screen') ?? this.#latestOf('tab');
    if (target === undefined) return false;

    target.onBack();
    return true;
  }

  #latestOf(rank: BackHandlerRank): Registration | undefined {
    return this.#registrations.filter((registration) => registration.rank === rank).at(-1);
  }
}
