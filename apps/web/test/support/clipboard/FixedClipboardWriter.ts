/**
 * 文字を写す継ぎ目（`src/clipboard/ClipboardWriter.ts`）の**記憶上の実装**（B-76 設計 4章。
 * 先行 `FixedConnectivity`）。
 *
 * **`vi.fn()` を使わない**（`docs/testing.md` 2章）。写した文字は自分の状態として持つ —
 * **作った時点では写さず、`コピー` を押したときだけ写す**（設計 規則5）ことを観るにはこの配列が要る。
 */

import type { ClipboardWriter, CopyOutcome } from '../../../src/clipboard/ClipboardWriter.js';

export class FixedClipboardWriter implements ClipboardWriter {
  readonly #outcomes: readonly CopyOutcome[];
  readonly #writtenTexts: string[] = [];

  /**
   * 写した結末の台本。**尽きたあとは最後のものを繰り返す**（先行 `DeliveryLine`）。
   * 空の台本は呼ばれるはずがない継ぎ目であり、呼ばれたら落ちる。
   */
  constructor(...outcomes: readonly CopyOutcome[]) {
    this.#outcomes = outcomes;
  }

  writeText(text: string): Promise<CopyOutcome> {
    // **積むのは配るより先である**（`docs/testing.md` 2章）。
    this.#writtenTexts.push(text);

    const outcome =
      this.#outcomes[Math.min(this.#writtenTexts.length - 1, this.#outcomes.length - 1)];
    if (outcome === undefined) {
      throw new Error('この観点では文字を写さない');
    }

    return Promise.resolve(outcome);
  }

  /** 写した文字。写した順に並ぶ。 */
  get writtenTexts(): readonly string[] {
    return [...this.#writtenTexts];
  }
}
