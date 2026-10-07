/**
 * 端末の「戻る」の context・provider・hook（B-75 設計 4章・5章 / 6章 規則5・10 / ADR-084）。
 *
 * **`features/` が import してよいのはこのファイルだけである**（設計 9章）。
 */

import type { JSX, ReactNode } from 'react';
import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import type { BackHandlerRank, BackNavigation } from './BackNavigation.js';

/**
 * 既定は `null` — provider の無い木では `useBackHandler` は何もしない（規則10）。画面のテストは
 * provider で包まずに描ける。
 */
const BackNavigationContext = createContext<BackNavigation | null>(null);

export function BackNavigationProvider({
  backNavigation,
  children,
}: {
  backNavigation: BackNavigation;
  children: ReactNode;
}): JSX.Element {
  return (
    <BackNavigationContext.Provider value={backNavigation}>
      {children}
    </BackNavigationContext.Provider>
  );
}

/**
 * active の間だけ登録する。onBack は最新のものが呼ばれる。
 *
 * 口を登録するのは、開いたものが**木に描かれて見えている間だけ**である（規則5）。送っている間に
 * 戻るを飲み込むのは呼び出し側の口の中身の仕事で、登録は外さない（規則6）— 外すと、その間の
 * 戻るがアプリを離れる側へ落ちる。
 */
export function useBackHandler(
  active: boolean,
  onBack: () => void,
  rank: BackHandlerRank = 'screen',
): void {
  const backNavigation = useContext(BackNavigationContext);
  // 口の中身は描くたびに差し替える。登録し直さないので、履歴の項目は動かない。
  const latestOnBack = useRef(onBack);

  // useEffect にしない — 画面が描き変わってから effect が走るまでの間に戻ると、古い口
  // （送っている間の「飲み込む」口など）が呼ばれる。
  useLayoutEffect(() => {
    latestOnBack.current = onBack;
  });

  useEffect(() => {
    if (!active || backNavigation === null) return;

    return backNavigation.register(() => {
      latestOnBack.current();
    }, rank);
  }, [active, backNavigation, rank]);
}
