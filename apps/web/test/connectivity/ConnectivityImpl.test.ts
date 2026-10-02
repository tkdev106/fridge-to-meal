/**
 * 接続状態の継ぎ目の実装 `ConnectivityImpl`（B-70 設計 5章 / 6章 規則1 / FR-41）。
 *
 * **node の上で動かす**（`docs/testing.md` 5章 — DOM を起動しない）。窓は構造型
 * `ConnectivitySource` で受け取るので、テストは**偽の窓**を渡す。偽の窓は `onLine` と、
 * 張られている聞き手を自分の状態として持ち、出来事を起こす口を持つ。
 *
 * **`vi.fn()` で呼び出しを数えない**（`docs/testing.md` 2章）。渡された状態はテストが持つ
 * 配列に積み、聞き手が残っているかは偽の窓が抱えている件数で観る。
 */

import { describe, expect, it } from 'vitest';
import type { ConnectivityState } from '../../src/connectivity/Connectivity.js';
import { ConnectivityImpl } from '../../src/connectivity/ConnectivityImpl.js';
import type { ConnectivitySource } from '../../src/connectivity/ConnectivityImpl.js';

type ConnectivityEvent = 'online' | 'offline';

/** 偽の窓。**出来事を起こすと `onLine` もそれに合わせて変わる**（ブラウザと同じ）。 */
class FakeWindow implements ConnectivitySource {
  readonly navigator: { onLine: boolean };
  readonly #listeners: Record<ConnectivityEvent, (() => void)[]> = { online: [], offline: [] };

  constructor(onLine: boolean) {
    this.navigator = { onLine };
  }

  addEventListener(type: ConnectivityEvent, listener: () => void): void {
    this.#listeners[type].push(listener);
  }

  removeEventListener(type: ConnectivityEvent, listener: () => void): void {
    const listeners = this.#listeners[type];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  /** 出来事を起こす。張られている聞き手を、張られた順に呼ぶ。 */
  dispatch(type: ConnectivityEvent): void {
    this.navigator.onLine = type === 'online';

    for (const listener of [...this.#listeners[type]]) listener();
  }

  /** いま張られている聞き手の件数。 */
  listenerCount(type: ConnectivityEvent): number {
    return this.#listeners[type].length;
  }
}

/** 購読を始め、渡された状態を積む配列と、購読をやめる口を返す。 */
function subscribeTo(source: FakeWindow): {
  readonly received: readonly ConnectivityState[];
  readonly unsubscribe: () => void;
} {
  const received: ConnectivityState[] = [];
  const unsubscribe = new ConnectivityImpl(source).subscribe((state) => {
    received.push(state);
  });

  return { received, unsubscribe };
}

describe('接続状態の継ぎ目 ConnectivityImpl', () => {
  it('接続している窓で購読を始めると、まず接続していることを1度だけ渡す', () => {
    const { received } = subscribeTo(new FakeWindow(true));

    // 規則1: 購読の始めに `navigator.onLine` が真なら `online` を1度渡す。
    expect(received).toEqual(['online']);
  });

  it('接続していない窓で購読を始めると、まず接続していないことを渡す', () => {
    const { received } = subscribeTo(new FakeWindow(false));

    // 規則1: 偽なら `offline`。
    expect(received).toEqual(['offline']);
  });

  it('切れた出来事を受けると、接続していないことを渡す', () => {
    const source = new FakeWindow(true);
    const { received } = subscribeTo(source);

    source.dispatch('offline');

    // 規則1 / FR-41: `offline` の出来事で `offline` を渡す。
    expect(received).toEqual(['online', 'offline']);
  });

  it('戻った出来事を受けると、接続していることを渡す', () => {
    const source = new FakeWindow(false);
    const { received } = subscribeTo(source);

    source.dispatch('online');

    // 規則1 / FR-41: `online` の出来事で `online` を渡す。
    expect(received).toEqual(['offline', 'online']);
  });

  it('購読をやめたあとに出来事を受けても、何も渡さない', () => {
    const source = new FakeWindow(true);
    const { received, unsubscribe } = subscribeTo(source);

    unsubscribe();
    source.dispatch('offline');
    source.dispatch('online');

    // 規則1: 購読をやめたら出来事を受けても渡さない（先行 `Session.ts` 規則5）。
    expect(received).toEqual(['online']);
  });

  it('購読をやめると、窓に張った聞き手が1つも残らない', () => {
    const source = new FakeWindow(true);
    const { unsubscribe } = subscribeTo(source);

    unsubscribe();

    // 規則1: 張った2つの聞き手を外す。残ると、門を張り替えるたびに聞き手が積もる。
    expect(source.listenerCount('online')).toBe(0);
    expect(source.listenerCount('offline')).toBe(0);
  });
});
