/**
 * 下タブの識別子・並び・既定（B-38 設計 5章 / 6章 規則1〜3）。
 *
 * **判断はここに置き、`.tsx` に置かない** — vitest の `include` は `*.test.ts` で
 * `environment: 'node'` であり、`.tsx` は拾われない（先行 `SwipeGesture.ts` /
 * `PantrySections.ts` と同じ置き方）。既定タブと並びは、置き場所を誤ると黙って変わる。
 *
 * **日本語（タブのラベル）はここに置かない**（B-38 設計 6章 規則13）。文言は `.tsx` の側。
 *
 * **これは署名だけのスタブである**（`docs/testing.md` 8章）。値は `implementer` が入れる。
 */

/** 下タブ1つ分の識別子。`docs/screen-design.md` 2.3 の遷移図の節名をそのまま使う。 */
export type TabId = 'meals' | 'pantry' | 'history';

/** 画面に並ぶ順のタブ。未実装（B-38 設計 6章 規則2）。 */
export const TAB_ORDER: readonly TabId[] = [];

/** 起動して最初に開くタブ。未実装（B-38 設計 6章 規則1）。 */
export const DEFAULT_TAB: TabId = 'meals';
