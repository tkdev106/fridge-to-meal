/**
 * 文字を写す継ぎ目の実装 `ClipboardWriterImpl`（B-76 2周目 / 設計 5章 / 6章 規則16 / FR-44）。
 *
 * **node の上で動かす**（`docs/testing.md` 5章 — DOM を起動しない）。`navigator` は構造型
 * `ClipboardNavigator` で受け取るので、テストは**偽の clipboard** を渡す。偽の clipboard は
 * 書き込まれた文字を自分の状態として持つ（先行 `ConnectivityImpl.test.ts` の偽の窓）。
 *
 * **`vi.fn()` で呼び出しを確かめない**（`docs/testing.md` 2章）。
 */

import { describe, expect, it } from 'vitest';
import { ClipboardWriterImpl } from '../../src/clipboard/ClipboardWriterImpl.js';

/** 偽の clipboard。受け入れれば書き込まれた文字を持ち、拒むなら投げる。 */
class FakeClipboard {
  writtenText: string | null = null;
  readonly #rejects: boolean;

  constructor(rejects = false) {
    this.#rejects = rejects;
  }

  async writeText(text: string): Promise<void> {
    if (this.#rejects) {
      throw new Error('書き込みを拒まれた');
    }

    this.writtenText = text;
  }
}

describe('文字を写す継ぎ目の実装 ClipboardWriterImpl', () => {
  it('書き込みが通れば、写せた結末を返す', async () => {
    // 規則16 / FR-44
    const writer = new ClipboardWriterImpl({ clipboard: new FakeClipboard() });

    await expect(
      writer.writeText('https://fridge.example.test/?invite=invite-token'),
    ).resolves.toBe('copied');
  });

  it('渡された文字をそのまま書き込む', async () => {
    // 規則16 / FR-44: 写すのは渡されたリンクの文字そのもの。
    const clipboard = new FakeClipboard();
    const writer = new ClipboardWriterImpl({ clipboard });

    await writer.writeText('https://fridge.example.test/?invite=invite-token');

    expect(clipboard.writtenText).toBe('https://fridge.example.test/?invite=invite-token');
  });

  it('clipboard を持たない navigator では、写せなかった結末を返す', async () => {
    // 規則16: `navigator.clipboard` が無ければ `failed`。例外を外へ出さない。
    const writer = new ClipboardWriterImpl({});

    await expect(
      writer.writeText('https://fridge.example.test/?invite=invite-token'),
    ).resolves.toBe('failed');
  });

  it('書き込みが拒まれれば、写せなかった結末を返す', async () => {
    // 規則16: 書き込みが拒まれれば `failed`。例外を外へ出さない。
    const writer = new ClipboardWriterImpl({ clipboard: new FakeClipboard(true) });

    await expect(
      writer.writeText('https://fridge.example.test/?invite=invite-token'),
    ).resolves.toBe('failed');
  });
});
