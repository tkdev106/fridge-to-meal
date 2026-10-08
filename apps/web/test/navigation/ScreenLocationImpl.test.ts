/**
 * 画面の行き先の継ぎ目の実装 `ScreenLocationImpl`（B-81 設計 5章 / 6章 規則3〜5 / ADR-092）。
 *
 * **node の上で動かす**（`docs/testing.md` 5章 — DOM を起動しない）。窓は構造型
 * `ScreenLocationSource` で受け取るので、テストは**偽の窓**を渡す（先行
 * `test/backNavigation/BackNavigationImpl.test.ts`）。
 *
 * 偽の窓は履歴を**項目（state と URL）の配列と現在の位置**として持つ素朴なものである。
 *
 * - `replaceState` は今の項目の state と URL を置き換える。位置も項目の数も変えない
 * - `location` は今の項目の URL から読む
 * - 利用者の「戻る」はテストの側から `userBack()` で起こす。
 *   位置を動かして `popstate` を起こす
 * - ほかの継ぎ目が URL を書き換えたこと（`BackNavigationImpl` が構築時にクエリを外す）は
 *   `rewriteUrl()` で起こす
 *
 * **`vi.fn()` で呼び出しを数えない**（`docs/testing.md` 2章）。観るのは項目の URL と state である。
 */

import { describe, expect, it } from 'vitest';
import { ScreenLocationImpl } from '../../src/navigation/ScreenLocationImpl.js';
import type { ScreenLocationSource } from '../../src/navigation/ScreenLocationImpl.js';

/** 履歴の項目1つ。 */
type Entry = { state: unknown; url: string };

/** URL の成分を読むための基点。偽の窓の URL は経路から始まるので、解決にだけ使う。 */
const URL_BASE = 'https://fridge.example.test';

class FakeWindow implements ScreenLocationSource {
  readonly #entries: Entry[];
  #position: number;
  readonly #listeners: (() => void)[] = [];

  readonly history: ScreenLocationSource['history'];

  /** `entries` は項目、`position` は読み込み時に居る項目の位置（既定は最後の項目）。 */
  constructor(entries: readonly Entry[], position = entries.length - 1) {
    this.#entries = entries.map((entry) => ({ ...entry }));
    this.#position = position;

    const entriesOf = this.#entries;
    // `history` は窓の状態を読み書きする口だけを持つ。
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fake = this;
    this.history = {
      get state(): unknown {
        return entriesOf[fake.#position]?.state;
      },
      replaceState(state: unknown, _unused: string, url: string): void {
        entriesOf[fake.#position] = { state, url };
      },
    };
  }

  /** 今の項目の URL の成分。 */
  get location(): { pathname: string; search: string; hash: string } {
    const url = new URL(this.currentUrl, URL_BASE);

    return { pathname: url.pathname, search: url.search, hash: url.hash };
  }

  addEventListener(_type: 'popstate', listener: () => void): void {
    this.#listeners.push(listener);
  }

  /** 利用者が戻る。 */
  userBack(): void {
    this.#moveBy(-1);
  }

  /** ほかの継ぎ目が今の項目の URL を書き換える。state は保つ。 */
  rewriteUrl(url: string): void {
    const entry = this.#entries[this.#position];
    if (entry === undefined) throw new Error('今の項目が無い');

    entry.url = url;
  }

  /** いま居る項目の位置。 */
  get position(): number {
    return this.#position;
  }

  /** 履歴の項目の数。 */
  get entryCount(): number {
    return this.#entries.length;
  }

  /** いま居る項目の state。 */
  get currentState(): unknown {
    return this.#entries[this.#position]?.state;
  }

  /** いま居る項目の URL。 */
  get currentUrl(): string {
    return this.#entries[this.#position]?.url ?? '';
  }

  #moveBy(delta: number): void {
    const next = Math.min(Math.max(this.#position + delta, 0), this.#entries.length - 1);
    if (next === this.#position) return;

    this.#position = next;
    for (const listener of [...this.#listeners]) listener();
  }
}

/** 読み込みの項目1つだけの窓。 */
function loadedAt(url: string, state: unknown = null): FakeWindow {
  return new FakeWindow([{ state, url }]);
}

describe('画面の行き先の継ぎ目 ScreenLocationImpl の読み込み時の行き先', () => {
  it('読み込み時のハッシュから最初の行き先を読む', () => {
    const source = loadedAt('/#history');

    const screenLocation = new ScreenLocationImpl(source);

    // 規則3 / ADR-092 決定1・3。
    expect(screenLocation.initial).toBe('history');
  });

  it('行き先を書いたあとも、最初の行き先は読み込み時のままである', () => {
    const source = loadedAt('/#history');
    const screenLocation = new ScreenLocationImpl(source);

    screenLocation.replace('pantry');

    // 規則3 / ADR-092 決定3: 読むのは構築時の1度だけ。
    expect(screenLocation.initial).toBe('history');
  });
});

describe('画面の行き先の継ぎ目 ScreenLocationImpl の書き方', () => {
  it('書くと、今の経路とクエリの後ろにハッシュを付けた URL になる', () => {
    const source = loadedAt('/app?x=1');
    const screenLocation = new ScreenLocationImpl(source);

    screenLocation.replace('pantry');

    // 規則4 / ADR-092 決定2: 変えるのはハッシュだけである。
    expect(source.currentUrl).toBe('/app?x=1#pantry');
  });

  it('献立を書くとハッシュが外れ、# も残らない', () => {
    const source = loadedAt('/#pantry');
    const screenLocation = new ScreenLocationImpl(source);

    screenLocation.replace('meals');

    // 規則2・4 / ADR-092 決定1: 既定の行き先の URL は素のままである。
    expect(source.currentUrl).toBe('/');
  });

  it('書いても履歴の項目は増えず、位置も変わらない', () => {
    const source = new FakeWindow([
      { state: null, url: '/' },
      { state: { fridgeToMealBack: 1 }, url: '/' },
    ]);
    const screenLocation = new ScreenLocationImpl(source);

    screenLocation.replace('history');

    // 規則4 / ADR-084 決定3: タブの切り替えを履歴に積まない。
    expect([source.entryCount, source.position]).toEqual([2, 1]);
  });

  it('書いても今の項目の state はそのままである', () => {
    const source = loadedAt('/', { fridgeToMealBack: 1 });
    const screenLocation = new ScreenLocationImpl(source);

    screenLocation.replace('pantry');

    // 規則4 / ADR-084 決定2: 戻るの深さの印を消すと、戻るの継ぎ目が深さを読めない。
    expect(source.currentState).toEqual({ fridgeToMealBack: 1 });
  });

  it('構築のあとにクエリが外れていれば、外れた URL に書く', () => {
    const source = loadedAt('/?invite=abc');
    const screenLocation = new ScreenLocationImpl(source);
    source.rewriteUrl('/');

    screenLocation.replace('pantry');

    // 規則4 / ADR-088: 経路とクエリは書くたびに今の URL から引く。構築時の値を覚えると、
    // 外したクエリが URL に戻る。
    expect(source.currentUrl).toBe('/#pantry');
  });
});

describe('画面の行き先の継ぎ目 ScreenLocationImpl の戻る・進む', () => {
  it('戻る・進むで移った項目には、最後に書いた行き先を書き直す', () => {
    const source = new FakeWindow([
      { state: null, url: '/' },
      { state: { fridgeToMealBack: 1 }, url: '/' },
    ]);
    const screenLocation = new ScreenLocationImpl(source);
    screenLocation.replace('pantry');

    source.userBack();

    // 規則5 / ADR-092 決定2・結果3: 着いた項目の URL を今の行き先に揃える。
    expect(source.currentUrl).toBe('/#pantry');
  });

  it('まだ書いていなければ、移った項目に読み込み時の行き先を書き直す', () => {
    const source = new FakeWindow([
      { state: null, url: '/' },
      { state: { fridgeToMealBack: 1 }, url: '/#history' },
    ]);
    new ScreenLocationImpl(source);

    source.userBack();

    // 規則5: 最後に書いた行き先の初期値は読み込み時の行き先である。
    expect(source.currentUrl).toBe('/#history');
  });

  it('書き直しても、着いた項目の state はそのままである', () => {
    const source = new FakeWindow([
      { state: { fridgeToMealBack: 1 }, url: '/' },
      { state: { fridgeToMealBack: 2 }, url: '/' },
    ]);
    const screenLocation = new ScreenLocationImpl(source);
    screenLocation.replace('history');

    source.userBack();

    // 規則5 / ADR-084 決定2: 着いた項目の深さの印を保つ。
    expect(source.currentState).toEqual({ fridgeToMealBack: 1 });
  });
});
