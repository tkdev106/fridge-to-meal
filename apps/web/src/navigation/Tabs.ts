/**
 * 下タブの識別子・並び・既定（B-38 設計 5章 / 6章 規則1〜3）。
 *
 * **判断はここに置き、`.tsx` に置かない** — 並びと既定は置き場所を誤ると黙って変わるうえ、
 * ここなら仮の文言にも jsdom にも依存せずに確かめられる（先行 `SwipeGesture.ts` /
 * `PantrySections.ts` と同じ置き方）。切り出せない出し分けのほうは `TabbedScreen.tsx` が持ち、
 * 描いて確かめる（ADR-052）。
 *
 * **日本語（タブのラベル）はここに置かない**（B-38 設計 6章 規則13）。文言は `.tsx` の側。
 *
 * **選んでいるタブを覚えるのは web の記憶の中だけである**（同 規則8）。URL にも
 * `localStorage` にも書かないため、外から文字列を受け取る口は無い — `TabId` の3つ以外が
 * 現れることは型として起こらない（同 7章）。
 */

/** 下タブ1つ分の識別子。`docs/screen-design.md` 2.3 の遷移図の節名をそのまま使う。 */
export type TabId = 'meals' | 'pantry' | 'history';

/**
 * 画面に並ぶ順のタブ（B-38 設計 6章 規則2）。`docs/screen-design.md` 2.1 のワイヤーの
 * 左から右（献立 → 在庫 → 履歴）である。
 */
export const TAB_ORDER: readonly TabId[] = ['meals', 'pantry', 'history'];

/**
 * 起動して最初に開くタブ（同 規則1）。
 *
 * **決定は「献立」である**（2026-09-24 にユーザーが決定。ADR-064。要件 第7章と
 * `docs/screen-design.md` 2.2 はもう献立と書いてある）。**それでもこの値が `'pantry'` のままなのは、
 * 反映を B-49（web の献立タブ）と同じ周に置いたためである** — 既定タブだけを先に反転させると、
 * 仮置きの段落（`features/meal/MealsTab.tsx`）が起動画面になる（ADR-064 決定 / 結果3）。
 *
 * **B-49 でここを `'meals'` に変える。** 文書とこの値が食い違っているのは、その1周のあいだだけである。
 */
export const DEFAULT_TAB: TabId = 'pantry';
