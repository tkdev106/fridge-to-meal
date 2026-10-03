/**
 * 端末の「戻る」の継ぎ目の実装（B-75 設計 5章 / 6章 規則4・8・9 / ADR-084）。
 *
 * 窓は構造型 `BackNavigationSource` で受ける（先行 `connectivity/ConnectivityImpl.ts`）。
 * **URL は変えない** — `pushState` の第3引数を渡さず、項目の state に深さの印
 * `{ fridgeToMealBack: 深さ }` だけを持たせる。
 *
 * 持つのは「積んだ項目の数 A」と「登録されている口の列（数 D）」である。
 *
 * - 登録と解除のあとは、マイクロタスクで**まとめて** A を D に揃える（規則8）— 同じ描画で
 *   登録して外した口のために項目を積まない。D > A なら差だけ積み、D < A なら
 *   `history.go(-(A-D))` で外す。外した分の `popstate` は自分で起こしたものとして読み流す
 * - 予期しない `popstate` では、着いた項目の深さ d（印が無ければ 0）を見る。d < A なら
 *   利用者の戻るであり、A を d にしてから最上位の口を1つだけ呼ぶ。d > A なら進むであり、
 *   口を呼ばずに A を d にして揃え直す（開き直さない）
 * - 戻るを飲み込んで口が残った回は D > A になり、揃えるときに1つ積み直す
 * - 構築時に今の項目が印つき（深さ k）なら `go(-k)` で印の無い項目まで戻る（規則9）
 *
 * 自分で起こした `go` の `popstate` が届くまでは揃えない — 届く前に積むと、`go` の着く先が
 * ずれる。
 */

import type { BackHandlerRank, BackNavigation } from './BackNavigation.js';

/** 窓のうち、ここが使うものだけを見る形。`pushState` の第3引数（URL）は渡さない。 */
export type BackNavigationSource = {
  readonly history: {
    readonly state: unknown;
    pushState(state: unknown, unused: string): void;
    back(): void;
    go(delta: number): void;
  };
  addEventListener(type: 'popstate', listener: () => void): void;
  removeEventListener(type: 'popstate', listener: () => void): void;
};

/** 登録された口1つ。同じ関数が2度登録されても別の登録として扱う。 */
type Registration = { readonly onBack: () => void; readonly rank: BackHandlerRank };

/** 項目の state に置く印の鍵。 */
const MARK_KEY = 'fridgeToMealBack';

/** 項目の state から深さを読む。印が無ければ 0（アプリの読み込みの項目か、よその項目）。 */
function depthOf(state: unknown): number {
  if (typeof state !== 'object' || state === null || !(MARK_KEY in state)) return 0;

  const depth: unknown = (state as Record<string, unknown>)[MARK_KEY];
  return typeof depth === 'number' && Number.isInteger(depth) && depth > 0 ? depth : 0;
}

export class BackNavigationImpl implements BackNavigation {
  readonly #source: BackNavigationSource;
  readonly #registrations: Registration[] = [];
  /** 積んだ項目の数（A）。 */
  #pushed = 0;
  /** 自分で起こした `go` のうち、まだ `popstate` が届いていない数。 */
  #pendingPops = 0;
  /** 揃えるマイクロタスクを予約済みか。 */
  #syncScheduled = false;

  constructor(source: BackNavigationSource) {
    this.#source = source;
    this.#source.addEventListener('popstate', () => {
      this.#handlePopState();
    });

    // 再読み込みは既定の画面から始まる。印つきの項目に居残ると、戻るが空振りする（規則9）。
    const depth = depthOf(this.#source.history.state);
    if (depth > 0) {
      this.#pendingPops += 1;
      this.#source.history.go(-depth);
    }
  }

  register(onBack: () => void, rank: BackHandlerRank): () => void {
    const registration: Registration = { onBack, rank };
    this.#registrations.push(registration);
    this.#scheduleSync();

    return () => {
      const index = this.#registrations.indexOf(registration);
      if (index < 0) return;

      this.#registrations.splice(index, 1);
      this.#scheduleSync();
    };
  }

  #handlePopState(): void {
    const depth = depthOf(this.#source.history.state);

    if (this.#pendingPops > 0) {
      // 自分で起こした `go` の着地。口は呼ばない。
      this.#pendingPops -= 1;
      this.#pushed = depth;
      this.#scheduleSync();
      return;
    }

    if (depth < this.#pushed) {
      // 利用者の戻る。A を先に減らしておくので、口が閉じれば D と揃い、何も動かさない。
      this.#pushed = depth;
      this.#topmost()?.onBack();
    } else {
      // 進む（または外から積まれた項目）。開き直さず、開いている数の深さへ揃え直す。
      this.#pushed = depth;
    }
    this.#scheduleSync();
  }

  /** 最上位の口。`'screen'` の最後の登録、それが無ければ `'tab'` の最後の登録（規則4）。 */
  #topmost(): Registration | undefined {
    return this.#latestOf('screen') ?? this.#latestOf('tab');
  }

  #latestOf(rank: BackHandlerRank): Registration | undefined {
    return this.#registrations.filter((registration) => registration.rank === rank).at(-1);
  }

  #scheduleSync(): void {
    if (this.#syncScheduled) return;

    this.#syncScheduled = true;
    queueMicrotask(() => {
      this.#syncScheduled = false;
      this.#sync();
    });
  }

  /** A を D に揃える（規則8）。自分の `go` の着地を待っている間は揃えない。 */
  #sync(): void {
    if (this.#pendingPops > 0) return;

    const wanted = this.#registrations.length;
    if (wanted > this.#pushed) {
      for (let depth = this.#pushed + 1; depth <= wanted; depth += 1) {
        this.#source.history.pushState({ [MARK_KEY]: depth }, '');
      }
      this.#pushed = wanted;
      return;
    }

    if (wanted < this.#pushed) {
      this.#pendingPops += 1;
      this.#source.history.go(-(this.#pushed - wanted));
    }
  }
}
