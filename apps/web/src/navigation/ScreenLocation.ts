/**
 * 画面の行き先の継ぎ目（B-81 設計 5章 / ADR-092）。
 *
 * **画面（門）が見るのはこのファイルの型だけである。** `history.replaceState` と `popstate` は
 * `ScreenLocationImpl` の背後に閉じる（先行 `connectivity/Connectivity.ts`）。
 *
 * **`ScreenLocation` は用語表の語ではない**（設計 3章）。web の中の継ぎ目の名である。
 */

import type { TabId } from './Tabs.js';

/** 行き先。下タブの3つと設定。 */
export type ScreenId = TabId | 'settings';

/** 継ぎ目の口。門はこの型だけを受け取る。 */
export type ScreenLocation = {
  /** 構築時に URL のハッシュから読んだ行き先 */
  readonly initial: ScreenId;
  /** 行き先を URL のハッシュに書く。履歴の項目は増やさない */
  replace(screen: ScreenId): void;
};

/** 献立以外の行き先とそのハッシュ。献立は既定の行き先なのでハッシュを持たない（ADR-092 決定1）。 */
const HASH_OF_SCREEN = {
  pantry: '#pantry',
  history: '#history',
  settings: '#settings',
} as const satisfies Record<Exclude<ScreenId, 'meals'>, string>;

/**
 * URL のハッシュから行き先を読む（設計 6章 規則1）。
 *
 * 完全一致で読み、大文字の違いや前後の空白を吸収しない。書く形以外はすべて献立に倒す
 * （ADR-092 決定1）— 読めないハッシュで投げる口を作らない。
 */
export function screenIdOf(hash: string): ScreenId {
  for (const [screen, screenHash] of Object.entries(HASH_OF_SCREEN)) {
    if (hash === screenHash) return screen as ScreenId;
  }

  return 'meals';
}

/** 行き先を URL のハッシュに写す（設計 6章 規則2）。献立は空文字で、`#` も付けない。 */
export function hashOf(screen: ScreenId): string {
  return screen === 'meals' ? '' : HASH_OF_SCREEN[screen];
}
