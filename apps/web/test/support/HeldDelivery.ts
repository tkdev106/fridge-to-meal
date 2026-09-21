/**
 * 差し替えの口が返す結末を**台本どおりに配る**ための道具（B-40 設計 5章 / 6章 規則7）。
 *
 * `FixedSession` と `FixedStockItemRequests` が共有する。**`vi.fn()` を使わない**
 * （`docs/testing.md` 2章）— 受け取ったものは呼ばれた側が自分の状態として持ち、
 * テストが観るのはその配列と、ここが配る結末だけである。
 *
 * **「送っている間」を実時間で作らない**（同 5章）。`heldUntilSettled` を渡した口は
 * `settle()` を呼ぶまで返らず、テストは待たずにその間の振る舞いを観られる。
 */

/** すぐ返る結末か、`settle()` まで返らない結末かの2つ。 */
export type Delivery<Outcome> = Outcome | { readonly heldUntilSettled: Outcome };

function isHeld<Outcome>(
  delivery: Delivery<Outcome>,
): delivery is { readonly heldUntilSettled: Outcome } {
  return typeof delivery === 'object' && delivery !== null && 'heldUntilSettled' in delivery;
}

/**
 * 保留を解く係。**ダブル1つにつき1つ**持ち、そのダブルの口すべてが共有する —
 * テストから見える `settle()` が1つであることと対になっている（設計 5章）。
 */
export class PendingReleases {
  readonly #releases: (() => void)[] = [];

  /** 保留を1つ預かる。解かれるまでその口は返らない。 */
  hold(release: () => void): void {
    this.#releases.push(release);
  }

  /**
   * 預かっている保留をすべて解く。
   *
   * **相手が居なければ落ちる**（設計 7章 行4）— 保留していないのに解こうとしたテストは、
   * 待っているつもりの結末をどこにも作れていない。
   */
  settle(): void {
    const releases = this.#releases.splice(0);
    if (releases.length === 0) {
      throw new Error('保留中の結末が1つも無いので settle() できない');
    }

    for (const release of releases) release();
  }
}

/**
 * 口1つぶんの台本。**尽きたあとは最後のものを繰り返す**（先行 `FixedHttpFetch`）。
 *
 * 台本が空の口は**呼ばれるはずがない口**であり、呼ばれたら落ちる（設計 7章 行1）。
 */
export class DeliveryLine<Outcome> {
  readonly #deliveries: readonly Delivery<Outcome>[];
  readonly #pending: PendingReleases;
  readonly #unexpectedCallMessage: string;
  #deliveredCount = 0;

  constructor(
    deliveries: readonly Delivery<Outcome>[],
    pending: PendingReleases,
    unexpectedCallMessage: string,
  ) {
    this.#deliveries = deliveries;
    this.#pending = pending;
    this.#unexpectedCallMessage = unexpectedCallMessage;
  }

  deliver(): Promise<Outcome> {
    const delivery = this.#deliveries[Math.min(this.#deliveredCount, this.#deliveries.length - 1)];
    this.#deliveredCount += 1;

    if (delivery === undefined) {
      throw new Error(this.#unexpectedCallMessage);
    }

    if (isHeld(delivery)) {
      const held = delivery.heldUntilSettled;

      return new Promise<Outcome>((resolve) => {
        this.#pending.hold(() => resolve(held));
      });
    }

    return Promise.resolve(delivery);
  }
}
