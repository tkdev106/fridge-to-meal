import { hashOf, screenIdOf } from './ScreenLocation.js';
import type { ScreenId, ScreenLocation } from './ScreenLocation.js';

/**
 * 窓のうち、ここが使うものだけを見る形（B-81 設計 5章）。**DOM の型を口に出さない** —
 * `main.tsx` は `window` を渡し、テストは偽の窓を渡す（先行 `connectivity/ConnectivityImpl.ts`）。
 */
export type ScreenLocationSource = {
  readonly location: { readonly pathname: string; readonly search: string; readonly hash: string };
  readonly history: {
    readonly state: unknown;
    replaceState(state: unknown, unused: string, url: string): void;
  };
  addEventListener(type: 'popstate', listener: () => void): void;
};

/**
 * `ScreenLocation` の実装（B-81 設計 6章 規則3〜5）。
 *
 * 書くのは `replaceState` だけで、`pushState` は呼ばない（ADR-084 決定3）。state は今の項目に
 * あるものをそのまま渡す — 戻るの継ぎ目が置いた深さの印を消さないため（ADR-084 決定2）。
 * 経路とクエリは書くたびに今の `location` から引き、構築時の値を覚えない — 戻るの継ぎ目が
 * 構築時にクエリを外すため（ADR-088）。
 *
 * 戻る・進むで着いた項目には、最後に書いた行き先を書き直す（ADR-092 決定2・結果3）。
 * 購読はアプリの寿命と同じなので外さない。
 */
export class ScreenLocationImpl implements ScreenLocation {
  readonly initial: ScreenId;
  readonly #source: ScreenLocationSource;
  #current: ScreenId;

  constructor(source: ScreenLocationSource) {
    this.#source = source;
    this.initial = screenIdOf(source.location.hash);
    this.#current = this.initial;

    source.addEventListener('popstate', () => {
      this.#write();
    });
  }

  replace(screen: ScreenId): void {
    this.#current = screen;
    this.#write();
  }

  #write(): void {
    const { location, history } = this.#source;

    history.replaceState(
      history.state,
      '',
      `${location.pathname}${location.search}${hashOf(this.#current)}`,
    );
  }
}
