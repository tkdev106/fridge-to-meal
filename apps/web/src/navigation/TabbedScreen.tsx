/**
 * 下タブの器（B-38 設計 4章 / 5章 / 6章 規則4〜7）。`docs/screen-design.md` 2.1 の帯に当たる。
 *
 * 3つの中身は `ReactNode` で受け取るだけで、器は在庫の口も献立の口も知らない（同 10章）。
 * 組み立てるのは門（`App.tsx`）である。
 *
 * **役割（ARIA）を3つ使うことは設計で決まっている**（同 5章）。帯は `role="tablist"`、
 * 各タブは `role="tab"` と `aria-selected`、中身は `role="tabpanel"`。文言が未確定である以上
 * （同書 論点3）、選んでいるタブを色だけでなく読み取れる形で示す手段がこれしか無い（規則5）。
 *
 * **根拠は NFR-17 そのものではない。** 同条の射程は「**期限の警告**は色のみで表現せず」であって、
 * タブの選択状態は入っていない。**その構えをタブに及ぼしたもの**であり、条文を広げたのではない。
 *
 * **日本語（タブのラベル・仮置きの文言）はここにだけ置く**（同 6章 規則13）。
 *
 * **選んでいるタブを器が持つことはやめた**（ADR-066 決定1・結果1）。B-38 設計 6章 規則8 は
 * 「選んでいるタブは器の `useState` に持つ」と定めていたが、それでは**画面の側からタブを
 * 移す手段が1つも無い**（`docs/screen-design.md` D-7 が在庫タブへ送る操作を求めている）。
 * いまは `selectedTab` / `onSelectTab` を props で受け取るだけの controlled な器であり、
 * 状態は門（`App.tsx`）が持つ（同 決定2）。**器の役割はむしろ減った** — 3つを並べて、
 * 押されたことを `TabId` で伝えるだけである。
 *
 * **URL にも `localStorage` にも書かないことは変えない**（同 結果1）。再読み込みも、
 * サインアウトを挟んで入り直した回も、開くのは既定のタブに戻る。**後者を保つのは門である。**
 */

import type { JSX, ReactNode } from 'react';
import type { TabId } from './Tabs.js';
import { TAB_ORDER } from './Tabs.js';
import { tabStyleOf } from './TabAppearance.js';

/**
 * タブの帯に出す文言。**すべて仮である**（`docs/screen-design.md` 冒頭・論点3）。
 * ワイヤーの絵文字（🍽 🧊 🕘）は紙の上の区別であり、ここに記号を出す決定ではない。
 */
const TAB_LABELS: Record<TabId, string> = {
  meals: '献立',
  pantry: '在庫',
  history: '履歴',
};

/** 中身の欄と、それを説明するタブを結ぶための id。読み上げが対応を辿れるようにする。 */
const PANEL_ID = 'tab-panel';
const tabElementId = (tab: TabId) => `tab-${tab}`;

export type TabbedScreenProps = {
  /**
   * 献立タブの中身。**`DEFAULT_TAB` が指しているのはこのタブである**（同 規則1 / ADR-064）。
   * 中身が無いまま出す回もある（同 規則7）。
   */
  meals: ReactNode;
  /** 在庫タブの中身。 */
  pantry: ReactNode;
  /** 履歴タブの中身。献立タブと同じく、中身が無くても帯から消さない（同 規則7）。 */
  history: ReactNode;
  /**
   * いま選んでいるタブ（ADR-066 決定1）。**器は自分では持たない** — 状態は門が持つ
   * （同 決定2）。器が `DEFAULT_TAB` を読むこともない。
   */
  selectedTab: TabId;
  /**
   * タブが押されたことを伝える口（同 決定1）。**運ぶのは `TabId` だけ**であり、
   * 「在庫タブへ送る」のような意味は器に無い（同 決定3）。
   */
  onSelectTab: (tab: TabId) => void;
};

export function TabbedScreen({
  meals,
  pantry,
  history,
  selectedTab,
  onSelectTab,
}: TabbedScreenProps): JSX.Element {
  // 受け取った3つを識別子で引けるようにするだけ。**器は中身が何かを知らない。**
  const contents: Record<TabId, ReactNode> = { meals, pantry, history };

  // **帯は中身より後ろに置く**（同 規則4 / NFR-14）。親指の届く画面の下端に帯を出すための
  // 文書順であり、**先に描いて CSS で下端に固定する形へ変えたくなったら、実装ではなく
  // 設計の規則4 を先に直す。**
  //
  // **選んだタブの中身だけを描く**（同 規則6）。残る2つは `hidden` で隠すのでもなく、
  // そもそも木に置かない — 隠して置くと、出ていない画面が効果を走らせ続ける。
  return (
    <>
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabElementId(selectedTab)}>
        {contents[selectedTab]}
      </div>

      <div role="tablist">
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            // **中身がまだ無いタブも無効化しない**（同 規則7）。feature flag を置かないのと
            // 同じ理由で、作りかけはそのまま出す（`CLAUDE.md`）。
            type="button"
            role="tab"
            id={tabElementId(tab)}
            // 選んでいるタブを**色に依らず**読み取れる形で示す（同 規則5。NFR-17 の構え）。
            aria-selected={tab === selectedTab}
            aria-controls={PANEL_ID}
            // **色に依らない見た目の手がかりを上乗せする**（B-41 設計 6章 規則5・6）。
            // `aria-selected` の置き換えではない。**値は `TabAppearance.ts` にだけ置き、
            // ここに数値も色も書かない** — 戻り値を丸ごと当てる。
            style={tabStyleOf(tab === selectedTab)}
            // **`tabIndex` を振り分けない。** 選んでいないタブを `-1` にするのは矢印キーで
            // 移れる実装と対になる作法であり、その鍵の扱いをまだ持たない今は、素の button の
            // ままにして Tab キーで3つとも辿れるようにしておく。
            onClick={() => onSelectTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>
    </>
  );
}
