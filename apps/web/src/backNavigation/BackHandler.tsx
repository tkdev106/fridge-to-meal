/**
 * 端末の「戻る」の context・provider・hook（B-74 設計 4章・5章 / 6章 規則5・10）。
 *
 * **`features/` が import してよいのはこのファイルだけである**（設計 9章）。
 */

import type { JSX, ReactNode } from 'react';
import type { BackHandlerRank, BackNavigation } from './BackNavigation.js';

export function BackNavigationProvider(_props: {
  backNavigation: BackNavigation;
  children: ReactNode;
}): JSX.Element {
  throw new Error('未実装');
}

/** active の間だけ登録する。onBack は最新のものが呼ばれる */
export function useBackHandler(
  _active: boolean,
  _onBack: () => void,
  _rank?: BackHandlerRank /* 既定 'screen' */,
): void {
  throw new Error('未実装');
}
