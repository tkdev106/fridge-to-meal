import type { ClipboardWriter, CopyOutcome } from './ClipboardWriter.js';

/**
 * 実装が読む `navigator` の一部だけを写した構造型。**DOM の型を口に出さない**（先行
 * `connectivity/ConnectivityImpl.ts` の `ConnectivitySource`）— `main.tsx` は `navigator` を渡し、
 * テストは偽の clipboard を渡す。
 */
export type ClipboardNavigator = {
  readonly clipboard?: { writeText(text: string): Promise<void> };
};

/**
 * `navigator.clipboard` に写す実装（FR-44）。clipboard が無いときも書き込みが拒まれたときも
 * `failed` を返し、例外を外へ出さない。
 */
export class ClipboardWriterImpl implements ClipboardWriter {
  readonly #navigator: ClipboardNavigator;

  constructor(navigator: ClipboardNavigator) {
    this.#navigator = navigator;
  }

  async writeText(text: string): Promise<CopyOutcome> {
    const { clipboard } = this.#navigator;

    if (clipboard === undefined) {
      return 'failed';
    }

    try {
      await clipboard.writeText(text);

      return 'copied';
    } catch {
      return 'failed';
    }
  }
}
