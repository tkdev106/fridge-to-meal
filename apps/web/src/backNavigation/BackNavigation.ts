/**
 * 端末の「戻る」の継ぎ目（B-75 設計 4章・5章 / 6章 規則1〜4）。
 *
 * **`features/` が見るのは `BackHandler.tsx` の hook だけである。** この型と実装は
 * `main.tsx` と provider だけが引く（設計 9章）。
 *
 * **`BackNavigation` は用語表の語ではない**（設計 3章）。web の中の継ぎ目の名である。
 */

/** 口の格。`'tab'` は `'screen'` の口がすべて無いときにだけ呼ぶ（規則4）。 */
export type BackHandlerRank = 'screen' | 'tab';

/** 継ぎ目の口。 */
export type BackNavigation = {
  /** 開いたものの口を登録する。戻り値で外す */
  register(onBack: () => void, rank: BackHandlerRank): () => void;
};
