/**
 * 端末の「戻る」の継ぎ目の実装（B-74 設計 5章 / 6章 規則4・8・9）。
 *
 * 窓は構造型 `BackNavigationSource` で受ける（先行 `connectivity/ConnectivityImpl.ts`）。
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

export class BackNavigationImpl implements BackNavigation {
  constructor(_source: BackNavigationSource) {
    throw new Error('未実装');
  }

  register(_onBack: () => void, _rank: BackHandlerRank): () => void {
    throw new Error('未実装');
  }
}
