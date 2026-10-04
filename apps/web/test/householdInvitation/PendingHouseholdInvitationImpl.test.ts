/**
 * 持ち越し中の招待の継ぎ目の実装 `PendingHouseholdInvitationImpl`（B-77 1周目 / 設計 5章 /
 * 6章 規則4・5 / ADR-087 決定4）。
 *
 * **node の上で動かす**（`docs/testing.md` 5章 — DOM を起動しない）。ストレージは構造型
 * `InvitationStorage` で受け取るので、テストは**偽のストレージ**を渡す。偽のストレージは
 * 書き込まれた値を自分の `Map` に持ち、`failing` に選んだ操作でだけ投げる（先行
 * `ClipboardWriterImpl.test.ts` の偽の clipboard）。
 *
 * 鍵の名前は実装詳細なので観ない。観るのは継ぎ目の `read` の戻り値と、投げないことだけである。
 * **`vi.fn()` で呼び出しを確かめない**（`docs/testing.md` 2章）。
 */

import { describe, expect, it } from 'vitest';
import { PendingHouseholdInvitationImpl } from '../../src/householdInvitation/PendingHouseholdInvitationImpl.js';
import type { InvitationStorage } from '../../src/householdInvitation/PendingHouseholdInvitationImpl.js';

/** 投げさせる操作。`null` なら投げない。 */
type FailingOperation = 'getItem' | 'setItem' | 'removeItem' | null;

/** 偽のストレージ。値を `Map` に持ち、`failing` に選んだ操作でだけ投げる。 */
class FakeStorage implements InvitationStorage {
  readonly #entries = new Map<string, string>();
  failing: FailingOperation = null;

  getItem(key: string): string | null {
    if (this.failing === 'getItem') throw new Error('読めない');

    return this.#entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failing === 'setItem') throw new Error('書けない');

    this.#entries.set(key, value);
  }

  removeItem(key: string): void {
    if (this.failing === 'removeItem') throw new Error('消せない');

    this.#entries.delete(key);
  }
}

describe('持ち越し中の招待の継ぎ目の実装 PendingHouseholdInvitationImpl', () => {
  it('保存したトークンを読める', () => {
    // 規則4 / ADR-087 決定4: ログインを経るあいだトークンを持ち越す。
    const pending = new PendingHouseholdInvitationImpl(new FakeStorage());

    pending.save('invite-token');

    expect(pending.read()).toBe('invite-token');
  });

  it('何も保存していなければ null を読む', () => {
    // 規則4: 招待リンクで開かれていなければ、持ち越しは無い。
    const pending = new PendingHouseholdInvitationImpl(new FakeStorage());

    expect(pending.read()).toBeNull();
  });

  it('新しいトークンを保存すると前のものを上書きする', () => {
    // 規則2: 新しいトークンは保存済みのものを上書きする。
    const pending = new PendingHouseholdInvitationImpl(new FakeStorage());
    pending.save('older-invite');

    pending.save('newer-invite');

    expect(pending.read()).toBe('newer-invite');
  });

  it('消したあとは null を読む', () => {
    // 規則9: 参加した・断られた・参加しないのあとは、確認が戻らない。
    const pending = new PendingHouseholdInvitationImpl(new FakeStorage());
    pending.save('invite-token');

    pending.clear();

    expect(pending.read()).toBeNull();
  });

  it('同じストレージを渡した別の実装からも読める', () => {
    // 規則4: 記憶上の写しを持たない — 確認メールのリンクは別のタブ・窓で開かれ、
    // そこで作られた実装が同じストレージから読む。
    const storage = new FakeStorage();
    new PendingHouseholdInvitationImpl(storage).save('invite-token');

    const reopened = new PendingHouseholdInvitationImpl(storage);

    expect(reopened.read()).toBe('invite-token');
  });

  it('読みが投げても null を読む', () => {
    // 規則5 / 7章 行5: ストレージが投げても例外を外へ出さない。
    const storage = new FakeStorage();
    const pending = new PendingHouseholdInvitationImpl(storage);
    pending.save('invite-token');
    storage.failing = 'getItem';

    expect(pending.read()).toBeNull();
  });

  it('書きが投げても save は投げない', () => {
    // 規則5 / 7章 行5
    const storage = new FakeStorage();
    const pending = new PendingHouseholdInvitationImpl(storage);
    storage.failing = 'setItem';

    expect(() => {
      pending.save('invite-token');
    }).not.toThrow();
  });

  it('消しが投げても clear は投げない', () => {
    // 規則5 / 7章 行5
    const storage = new FakeStorage();
    const pending = new PendingHouseholdInvitationImpl(storage);
    pending.save('invite-token');
    storage.failing = 'removeItem';

    expect(() => {
      pending.clear();
    }).not.toThrow();
  });
});
