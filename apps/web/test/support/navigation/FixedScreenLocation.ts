/**
 * 画面の行き先の継ぎ目（`src/navigation/ScreenLocation.ts`）の**記憶上の実装**（B-81 設計 4章）。
 *
 * **`vi.fn()` を使わない**（`docs/testing.md` 2章）。書かれた行き先は自分の状態 `written` に積み、
 * テストは**最後に書かれたもの**を観る。回数は約束しないので数えない（設計 10章 前提5）。
 */

import type { ScreenId, ScreenLocation } from '../../../src/navigation/ScreenLocation.js';

export class FixedScreenLocation implements ScreenLocation {
  readonly initial: ScreenId;
  readonly #written: ScreenId[] = [];

  /** 読み込み時の URL から読んだことにする行き先。既定は献立。 */
  constructor(initial: ScreenId = 'meals') {
    this.initial = initial;
  }

  replace(screen: ScreenId): void {
    this.#written.push(screen);
  }

  /** 書かれた行き先を古い順に。 */
  get written(): readonly ScreenId[] {
    return this.#written;
  }

  /** 最後に書かれた行き先。まだ書かれていなければ `undefined`。 */
  get lastWritten(): ScreenId | undefined {
    return this.#written.at(-1);
  }
}
