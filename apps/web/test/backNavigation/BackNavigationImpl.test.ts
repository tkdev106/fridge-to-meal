/**
 * 端末の「戻る」の継ぎ目の実装 `BackNavigationImpl`（B-75 設計 5章 / 6章 規則4・8・9）。
 *
 * **node の上で動かす**（`docs/testing.md` 5章 — DOM を起動しない）。窓は構造型
 * `BackNavigationSource` で受け取るので、テストは**偽の窓**を渡す（先行
 * `test/connectivity/ConnectivityImpl.test.ts`）。
 *
 * 偽の窓は履歴を**項目（state と URL）の配列と現在の位置**として持つ素朴なものである。
 *
 * - `pushState` は位置より前方を切り捨てて積み、位置を進める。`popstate` は起こさない。
 *   URL を渡さないので、積んだ項目の URL は今の項目のものを引き継ぐ（ブラウザと同じ）
 * - `replaceState` は今の項目の state と URL を置き換える。位置も項目の数も変えず、
 *   置き換えた回数を `replacedCount` に数える（「置き換えないこと」が要件の1件のため。
 *   `docs/testing.md` 2章）
 * - `location` は今の項目の URL から読む。読み込み時の URL は構築時に渡し、すべての項目が
 *   その URL を持つ
 * - `go` / `back` は位置を**すぐには動かさない** — ブラウザと同じく非同期であり、テストが
 *   `deliver()` で流すまで溜めておく。流すと位置を動かし `popstate` を起こす
 * - 利用者の「戻る」「進む」はテストの側から `userBack()` / `userForward()` で起こす
 * - 最初の項目は「よそ」（アプリより前に開いていたページ）で、アプリの読み込みの項目は
 *   その次（state は `null`）に置く
 *
 * 登録と解除はマイクロタスクで揃える実装を許すので（規則8）、**観る前に `settle()` で
 * マイクロタスクと溜めた `go` を流し切る。**
 *
 * **`vi.fn()` で呼び出しを数えない**（`docs/testing.md` 2章）。口が呼ばれたことは、
 * テストが持つ配列 `closed` に名前を積む形で観る。
 */

import { describe, expect, it } from 'vitest';
import { BackNavigationImpl } from '../../src/backNavigation/BackNavigationImpl.js';
import type { BackNavigationSource } from '../../src/backNavigation/BackNavigationImpl.js';

/** アプリより前に開いていたページの項目。**ここまで戻ったらアプリを離れている。** */
const elsewhere = 'よそ';

/** 読み込み時の URL の3つの成分。 */
type LoadedLocation = { readonly search: string; readonly pathname: string; readonly hash: string };

/** 履歴の項目1つ。 */
type Entry = { state: unknown; url: string };

/** URL の成分を読むための基点。偽の窓の URL は経路から始まるので、解決にだけ使う。 */
const URL_BASE = 'https://fridge.example.test';

class FakeWindow implements BackNavigationSource {
  readonly #entries: Entry[];
  #position: number;
  #replacedCount = 0;
  readonly #pendingDeltas: number[] = [];
  readonly #listeners: (() => void)[] = [];

  readonly history: BackNavigationSource['history'];

  /**
   * `entries` は項目の state、`position` は読み込み時に居る項目の位置、`loaded` は読み込み時の
   * URL（既定はクエリもハッシュも無い `/`）。
   */
  constructor(
    entries: readonly unknown[] = [elsewhere, null],
    position = 1,
    loaded: LoadedLocation = { search: '', pathname: '/', hash: '' },
  ) {
    const loadedUrl = `${loaded.pathname}${loaded.search}${loaded.hash}`;
    this.#entries = entries.map((state) => ({ state, url: loadedUrl }));
    this.#position = position;

    const entriesOf = this.#entries;
    // `history` は窓の状態を読み書きする口だけを持つ。
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fake = this;
    this.history = {
      get state(): unknown {
        return entriesOf[fake.#position]?.state;
      },
      pushState(state: unknown): void {
        const url = entriesOf[fake.#position]?.url ?? loadedUrl;
        entriesOf.splice(fake.#position + 1);
        entriesOf.push({ state, url });
        fake.#position += 1;
      },
      replaceState(state: unknown, _unused: string, url: string): void {
        entriesOf[fake.#position] = { state, url };
        fake.#replacedCount += 1;
      },
      back(): void {
        fake.#pendingDeltas.push(-1);
      },
      go(delta: number): void {
        fake.#pendingDeltas.push(delta);
      },
    };
  }

  /** 今の項目の URL の成分。 */
  get location(): LoadedLocation {
    const url = new URL(this.currentUrl, URL_BASE);

    return { search: url.search, pathname: url.pathname, hash: url.hash };
  }

  addEventListener(_type: 'popstate', listener: () => void): void {
    this.#listeners.push(listener);
  }

  removeEventListener(_type: 'popstate', listener: () => void): void {
    const index = this.#listeners.indexOf(listener);
    if (index >= 0) this.#listeners.splice(index, 1);
  }

  /** 溜めた `go` / `back` を順に流す。1つごとに位置を動かし `popstate` を起こす。 */
  deliver(): void {
    for (const delta of this.#pendingDeltas.splice(0)) this.#moveBy(delta);
  }

  /** 利用者が戻る（Android の戻るジェスチャー・ブラウザの戻る）。 */
  userBack(): void {
    this.#moveBy(-1);
  }

  /** 利用者が進む。 */
  userForward(): void {
    this.#moveBy(1);
  }

  /** いま居る項目の位置。 */
  get position(): number {
    return this.#position;
  }

  /** 履歴の項目の state を前から順に。 */
  get states(): readonly unknown[] {
    return this.#entries.map((entry) => entry.state);
  }

  /** いま居る項目の state。 */
  get currentState(): unknown {
    return this.#entries[this.#position]?.state;
  }

  /** いま居る項目の URL。 */
  get currentUrl(): string {
    return this.#entries[this.#position]?.url ?? '';
  }

  /** `replaceState` で置き換えた回数。 */
  get replacedCount(): number {
    return this.#replacedCount;
  }

  #moveBy(delta: number): void {
    const next = Math.min(Math.max(this.#position + delta, 0), this.#entries.length - 1);
    if (next === this.#position) return;

    this.#position = next;
    for (const listener of [...this.#listeners]) listener();
  }
}

/** マイクロタスクと溜めた `go` を、動かなくなるまで流す。**実時間は待たない**（5章）。 */
async function settle(source: FakeWindow): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    source.deliver();
  }
}

/** 呼ばれたら `closed` に名前を積む口。 */
function recording(closed: string[], name: string): () => void {
  return () => {
    closed.push(name);
  };
}

describe('端末の戻るの継ぎ目 BackNavigationImpl の履歴の積み方', () => {
  it('口を1つ登録すると、深さ1の印つきの項目が1つ積まれる', async () => {
    const source = new FakeWindow();
    const backNavigation = new BackNavigationImpl(source);

    backNavigation.register(() => {}, 'screen');
    await settle(source);

    // 規則8: 開いた数だけ積む。URL は変えず、state に深さの印を持たせる。
    expect(source.states).toEqual([elsewhere, null, { fridgeToMealBack: 1 }]);
    expect(source.position).toBe(2);
  });

  it('口を2つ登録すると、深さ1と深さ2の項目が順に積まれる', async () => {
    const source = new FakeWindow();
    const backNavigation = new BackNavigationImpl(source);

    backNavigation.register(() => {}, 'screen');
    backNavigation.register(() => {}, 'screen');
    await settle(source);

    // 規則8: A を D（= 2）に揃える。
    expect(source.states).toEqual([
      elsewhere,
      null,
      { fridgeToMealBack: 1 },
      { fridgeToMealBack: 2 },
    ]);
    expect(source.position).toBe(3);
  });

  it('同じ描画のうちに登録してすぐ外すと、履歴に何も積まない', async () => {
    const source = new FakeWindow();
    const backNavigation = new BackNavigationImpl(source);

    const unregister = backNavigation.register(() => {}, 'screen');
    unregister();
    await settle(source);

    // 規則8: 登録と解除はまとめて揃える。積んでから外すと、操作なしの項目が残りうる。
    expect(source.states).toEqual([elsewhere, null]);
    expect(source.position).toBe(1);
  });
});

describe('端末の戻るの継ぎ目 BackNavigationImpl の戻るで呼ぶ口', () => {
  it('戻ると、最後に登録した screen の口だけが呼ばれる', async () => {
    const source = new FakeWindow();
    const backNavigation = new BackNavigationImpl(source);
    const closed: string[] = [];
    backNavigation.register(recording(closed, 'first'), 'screen');
    backNavigation.register(recording(closed, 'second'), 'screen');
    await settle(source);

    source.userBack();
    await settle(source);

    // 規則1・4: 最後に開いたもの1つを閉じる。
    expect(closed).toEqual(['second']);
  });

  it('tab の口を後から登録しても、戻るで先に呼ばれるのは screen の口である', async () => {
    const source = new FakeWindow();
    const backNavigation = new BackNavigationImpl(source);
    const closed: string[] = [];
    backNavigation.register(recording(closed, 'screen'), 'screen');
    backNavigation.register(recording(closed, 'tab'), 'tab');
    await settle(source);

    source.userBack();
    await settle(source);

    // 規則4 / 設計 10章 前提3: 登録の順によらず、screen の口がある間は tab の口を呼ばない。
    expect(closed).toEqual(['screen']);
  });

  it('screen の口が無いときは、tab の口が呼ばれる', async () => {
    const source = new FakeWindow();
    const backNavigation = new BackNavigationImpl(source);
    const closed: string[] = [];
    backNavigation.register(recording(closed, 'tab'), 'tab');
    await settle(source);

    source.userBack();
    await settle(source);

    // 規則4: 既定でないタブ → 献立タブ。
    expect(closed).toEqual(['tab']);
  });

  it('戻るで呼ばれた口が自分を外しても、履歴をそれ以上戻さない', async () => {
    const source = new FakeWindow();
    const backNavigation = new BackNavigationImpl(source);
    const unregisterHolder: { unregister: () => void } = { unregister: () => {} };
    unregisterHolder.unregister = backNavigation.register(() => {
      unregisterHolder.unregister();
    }, 'screen');
    await settle(source);

    source.userBack();
    await settle(source);

    // 規則8: 利用者の戻るで A を1減らしてあるので、口が閉じれば D と揃い、何も動かさない。
    // さらに戻すと「よそ」へ出てアプリを離れてしまう。
    expect(source.position).toBe(1);
    expect(source.currentState).toBeNull();
  });

  it('戻るを飲み込んで口が残ったままなら、項目を1つ積み直す', async () => {
    const source = new FakeWindow();
    const backNavigation = new BackNavigationImpl(source);
    backNavigation.register(() => {}, 'screen');
    await settle(source);

    source.userBack();
    await settle(source);

    // 規則6・8: 送っている間に飲み込んだ回だけは D > A になり、1つ積み直す。
    // 積み直さないと、次の戻るでアプリを離れる。
    expect(source.states).toEqual([elsewhere, null, { fridgeToMealBack: 1 }]);
    expect(source.position).toBe(2);
  });
});

describe('端末の戻るの継ぎ目 BackNavigationImpl の画面の操作で外す回', () => {
  it('戻るを押さずに口を外すと、外した数だけ履歴を戻す', async () => {
    const source = new FakeWindow();
    const backNavigation = new BackNavigationImpl(source);
    backNavigation.register(() => {}, 'screen');
    const unregister = backNavigation.register(() => {}, 'screen');
    await settle(source);

    unregister();
    await settle(source);

    // 規則8: D < A なら `go(-(A-D))` で外す。残すと、戻るが空振りする項目が積もる。
    expect(source.position).toBe(2);
    expect(source.currentState).toEqual({ fridgeToMealBack: 1 });
  });

  it('画面の操作で外して履歴を戻したときは、残った口を呼ばない', async () => {
    const source = new FakeWindow();
    const backNavigation = new BackNavigationImpl(source);
    const closed: string[] = [];
    backNavigation.register(recording(closed, 'remaining'), 'screen');
    const unregister = backNavigation.register(recording(closed, 'removed'), 'screen');
    await settle(source);

    unregister();
    await settle(source);

    // 規則8: 自分で go した分の popstate は予期したものとして読み流す。
    expect(closed).toEqual([]);
  });
});

describe('端末の戻るの継ぎ目 BackNavigationImpl の進む', () => {
  it('進むで印つきの項目へ移っても口を呼ばず、開いている数の深さへ戻す', async () => {
    const source = new FakeWindow();
    const backNavigation = new BackNavigationImpl(source);
    const closed: string[] = [];
    backNavigation.register(recording(closed, 'remaining'), 'screen');
    const holder: { unregister: () => void } = { unregister: () => {} };
    holder.unregister = backNavigation.register(() => {
      closed.push('top');
      holder.unregister();
    }, 'screen');
    await settle(source);
    source.userBack();
    await settle(source);

    source.userForward();
    await settle(source);

    // 7章 行1 / ADR-084 結果: 進むでは開き直さず、口も呼ばない。着いた深さ（2）が積んだ数（1）
    // より大きいので、開いている数（1）の深さまで戻して揃える（規則8）。
    expect(closed).toEqual(['top']);
    expect(source.currentState).toEqual({ fridgeToMealBack: 1 });
  });
});

describe('端末の戻るの継ぎ目 BackNavigationImpl の読み込み', () => {
  it('読み込み時の項目が深さ k の印つきなら、印の無い項目まで k 戻す', async () => {
    const source = new FakeWindow(
      [elsewhere, null, { fridgeToMealBack: 1 }, { fridgeToMealBack: 2 }],
      3,
    );

    new BackNavigationImpl(source);
    await settle(source);

    // 規則9: 再読み込みでは印の無い項目まで戻る。印つきの項目に居残ると、戻るが空振りする。
    expect(source.position).toBe(1);
    expect(source.currentState).toBeNull();
  });

  it('読み込み時に戻したときは、その間に登録された口を呼ばない', async () => {
    const source = new FakeWindow(
      [elsewhere, null, { fridgeToMealBack: 1 }, { fridgeToMealBack: 2 }],
      3,
    );
    const closed: string[] = [];

    const backNavigation = new BackNavigationImpl(source);
    backNavigation.register(recording(closed, 'opened'), 'screen');
    await settle(source);

    // 規則9: その popstate は自分で起こしたものであり、利用者の戻るではない。
    expect(closed).toEqual([]);
  });

  it('読み込み時の項目に印が無ければ、履歴を動かさない', async () => {
    const source = new FakeWindow([elsewhere, null], 1);

    new BackNavigationImpl(source);
    await settle(source);

    // 規則9: 印の無い項目はアプリの外のものか、読み込みの項目そのものである。
    expect(source.states).toEqual([elsewhere, null]);
    expect(source.position).toBe(1);
  });
});

describe('端末の戻るの継ぎ目 BackNavigationImpl の読み込み時のクエリ', () => {
  /** 招待リンクで開いた読み込みの URL。 */
  const invited: LoadedLocation = { search: '?invite=invite-token', pathname: '/', hash: '' };

  it('クエリがあれば、クエリを外した URL に置き換える', async () => {
    const source = new FakeWindow([elsewhere, null], 1, invited);

    new BackNavigationImpl(source);
    await settle(source);

    // ADR-088: トークンを URL に残さない。
    expect(source.currentUrl).toBe('/');
  });

  it('クエリを外してもハッシュは保つ', async () => {
    const source = new FakeWindow([elsewhere, null], 1, {
      search: '?invite=invite-token',
      pathname: '/',
      hash: '#top',
    });

    new BackNavigationImpl(source);
    await settle(source);

    // 規則3: 外すのはクエリだけである。
    expect(source.currentUrl).toBe('/#top');
  });

  it('クエリを外しても、履歴の項目を増やさない', async () => {
    const source = new FakeWindow([elsewhere, null], 1, invited);

    new BackNavigationImpl(source);
    await settle(source);

    // 規則3: 積むと、戻るでクエリつきの項目へ戻ってしまう。
    expect(source.states).toEqual([elsewhere, null]);
    expect(source.position).toBe(1);
  });

  it('クエリを外しても state を保つので、印つきの読み込みでは印の無い項目まで戻る', async () => {
    const source = new FakeWindow([elsewhere, null, { fridgeToMealBack: 1 }], 2, invited);

    new BackNavigationImpl(source);
    await settle(source);

    // 規則3 / 規則9（B-75）: 外したあとに既存の「印つきなら戻る」を行う。印を消すと戻れない。
    expect(source.position).toBe(1);
    expect(source.states[2]).toEqual({ fridgeToMealBack: 1 });
  });

  it('クエリが無ければ、URL を置き換えない', async () => {
    const source = new FakeWindow([elsewhere, null], 1);

    new BackNavigationImpl(source);
    await settle(source);

    // 規則3: 置き換えないことが要件（`docs/testing.md` 2章）。
    expect(source.replacedCount).toBe(0);
  });
});
