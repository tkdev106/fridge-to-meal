/**
 * タブ1つの見た目（B-41 設計 5章 / 6章 規則1〜4・6・7）。
 *
 * **判断と値はここに置き、`.tsx` に散らさない** — 配色や寸法を詰める周が、ここ1か所を見れば
 * 足りる形にする（同 規則6。先行 `Tabs.ts` / `PantrySections.ts` と同じ置き方）。
 *
 * **見た目は「選ばれているか」だけで決まる**（同 規則7）。`TabId` を受け取らないのは、
 * タブごとに見た目を変える分岐をここに作らせないためである。
 *
 * **スタイルの置き場はインラインの `style`（React の `CSSProperties`）とし、CSS ファイルも
 * CSS Modules も置かない**（ADR-054。先行は `features/pantry/PantryList.tsx` の
 * `style={{ touchAction: 'pan-y' }}`）。vitest の既定は CSS を処理しないため、CSS 側へ置くと
 * ADR-052 の「描いて確かめる」道の上でスタイルが1つも当たらず、検めが無くなる。
 *
 * **NFR-16（コントラスト比 4.5:1 以上）について。** ここは**選んでいる / いないの区別に色を
 * 使っていない**（同 規則3）— 文字色も背景色も選択で変えず、線の印は `currentColor`、
 * 出さない側は `transparent` である。**したがってこの周は新しいコントラスト比を1つも作らない。**
 * 配色そのものは未選定であり（`docs/screen-design.md` 冒頭・論点3）、**色を足す周は
 * WCAG 2.1 AA（4.5:1）を確かめてから足し、そのときも規則1（太さ）・規則2（上辺の線）の
 * 手がかりを消さない** — 色以外の手がかりが残っていることが NFR-17 の構えの側の担保である。
 * **比の実測はテストに入れない**（jsdom はレイアウトも配色の合成も持たない。同 8章）。
 */

import type { CSSProperties } from 'react';

/**
 * 上辺の線の太さ。**選んでいてもいなくても同じ値を置く**（同 規則4 / NFR-14）—
 * 太さが変わると、タブを移るたびに帯の高さが動いて押し間違える。
 */
const MARK_WIDTH = '2px';

/**
 * 上辺の線の引き方。**`border-top-style` の既定は `none`** で、そのとき
 * `border-top-width` は 0 に計算される — 色だけを切り替えても印は出ず、規則4 が確保した
 * はずの場所も消える。**どちらの見た目でも線を引く指定にしておく。**
 */
const MARK_STYLE = 'solid';

/**
 * 選んでいるタブの線の色。**新しい色ではなく、そのタブの文字色そのもの**である
 * （規則3 / NFR-16 — 上の doc を見よ）。
 */
const MARK_COLOR_SELECTED = 'currentColor';

/** 選んでいないタブの線の色。**場所は確保したまま色だけを消す**（規則4）。 */
const MARK_COLOR_UNSELECTED = 'transparent';

/** タブ1つの見た目。`selected` は「そのタブが選ばれているか」。 */
export function tabStyleOf(selected: boolean): CSSProperties {
  return {
    // 規則1: 選んでいるタブの文字は太い。**両方に明示する** — 片方を既定任せにすると、
    // 既定の太さが変わった回に規則1 の差だけが黙って消える。
    fontWeight: selected ? 'bold' : 'normal',
    // 規則2・4: 帯の中身に近い側（上辺）に印を出し、出さない側も場所は確保する。
    borderTopStyle: MARK_STYLE,
    borderTopWidth: MARK_WIDTH,
    borderTopColor: selected ? MARK_COLOR_SELECTED : MARK_COLOR_UNSELECTED,
    // 規則3: `color` と `backgroundColor` はここで決めない。既定がそのまま効く。
  };
}
