import type { Connectivity, ConnectivityState } from './Connectivity.js';

/**
 * 接続状態を読む相手（B-70 設計 5章）。**DOM の型を口に出さない**（先行 `server/HttpFetch.ts` の
 * 構造型）— `main.tsx` は `window` を渡し、テストは偽の窓を渡す。
 */
export type ConnectivitySource = {
  readonly navigator: { readonly onLine: boolean };
  addEventListener(type: 'online' | 'offline', listener: () => void): void;
  removeEventListener(type: 'online' | 'offline', listener: () => void): void;
};

/**
 * `Connectivity` の実装（B-70 設計 6章 規則1・2）。
 *
 * 購読の始めに `navigator.onLine` を1度読み、以後は `online` / `offline` の出来事だけを写す。
 * **`onLine` が真でも届かないことはある**が、それは見分けない（規則2。既存の失敗の結末に落ちる）。
 */
export class ConnectivityImpl implements Connectivity {
  readonly #source: ConnectivitySource;

  constructor(source: ConnectivitySource) {
    this.#source = source;
  }

  subscribe(onChange: (state: ConnectivityState) => void): () => void {
    const handleOnline = (): void => {
      onChange('online');
    };
    const handleOffline = (): void => {
      onChange('offline');
    };

    this.#source.addEventListener('online', handleOnline);
    this.#source.addEventListener('offline', handleOffline);
    onChange(this.#source.navigator.onLine ? 'online' : 'offline');

    return () => {
      this.#source.removeEventListener('online', handleOnline);
      this.#source.removeEventListener('offline', handleOffline);
    };
  }
}
