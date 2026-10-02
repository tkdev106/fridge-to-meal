/**
 * タブの器（B-38 設計 4章 / 5章 / 6章 規則4〜7 / B-60 設計 6章 規則3〜11）。
 * `docs/screen-design.md` 2.1 の帯に当たる。**帯は SP では下タブ、PC（幅 1024px 以上）では左の
 * サイドナビになる**（B-60 規則1〜3）。タブは1組だけで、並べ替えは CSS が担う。
 *
 * 帯全体は `<nav>` で、中にロゴ・`tablist`・帯の「設定」を置く（B-60 規則4）。ロゴと帯の「設定」は
 * SP で出さない（CSS の `display: none`）が、DOM には常にある。
 *
 * **設定は4つ目の行き先である**（B-60 規則7）。`settings` が渡されている間は、中身の欄に
 * タブの中身の代わりにそれを描き、どのタブも選ばない（`aria-selected` が偽・中身の欄を
 * `tabpanel` にしない・`aria-controls` を付けない）。帯の「設定」は `aria-current="page"` を持つ。
 * 開いているかを持つのは門であり、器は押されたことを `onOpenSettings` で伝えるだけである。
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
import type { IconName } from '../icons/Icon.js';
import { Icon } from '../icons/Icon.js';
import styles from './TabbedScreen.module.css';

/**
 * タブの帯に出す文言。**原本 `TabBar` のラベルに揃える**（ADR-074 決定1。`docs/design/` が
 * 文言の正）。在庫タブの識別子は `pantry` のまま変えず、**出す文字だけ** `冷蔵庫` にする。
 */
const TAB_LABELS: Record<TabId, string> = {
  meals: '献立',
  pantry: '冷蔵庫',
  history: '履歴',
};

/**
 * タブに添えるアイコン（原本 `TabBar`）。**飾りであって名前ではない** — タブの名前は
 * ラベルの文字だけが持つ（設計 B-59 6章 規則5）。
 */
const TAB_ICONS: Record<TabId, IconName> = {
  meals: 'meal',
  pantry: 'pantry',
  history: 'history',
};

/**
 * タブ1つに当てる class。**見た目は「選ばれているか」だけで決まる**（B-41 設計 6章 規則7 /
 * ADR-055 決定1）— `TabId` を受け取らないのは、タブごとに見た目を変える分岐を作らせないため。
 * 値はすべて `TabbedScreen.module.css` にあり、ここには class 名しか書かない。
 *
 * `noUncheckedIndexedAccess` のもとで `styles.x` は `string | undefined` であり、
 * そのまま連結すると `"undefined"` が class に混ざる。**在るものだけを空白で繋ぐ。**
 */
const tabClassOf = (selected: boolean): string =>
  [styles.tab, selected ? styles.tabSelected : undefined]
    .filter((name): name is string => name !== undefined)
    .join(' ');

/**
 * 帯の「設定」に当てる class（B-60 規則7）。タブと同じ `.tab` / `.tabSelected` に、
 * **SP で隠し PC で下端へ寄せる** `.settings` を足す。手がかりをタブと同じにするための共有である。
 */
const settingsClassOf = (open: boolean): string =>
  [styles.tab, styles.settings, open ? styles.tabSelected : undefined]
    .filter((name): name is string => name !== undefined)
    .join(' ');

/** 帯の「設定」の文言（原本 `SideNav`。ADR-074 決定1）。 */
const SETTINGS_LABEL = '設定';

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
  /** 設定を開いていれば門が組んだ設定画面、開いていなければ null（ADR-066 と同じく門が持つ） */
  settings: ReactNode | null;
  /** サイドナビの「設定」が押された */
  onOpenSettings: () => void;
};

export function TabbedScreen({
  meals,
  pantry,
  history,
  selectedTab,
  onSelectTab,
  settings,
  onOpenSettings,
}: TabbedScreenProps): JSX.Element {
  // 受け取った3つを識別子で引けるようにするだけ。**器は中身が何かを知らない。**
  const contents: Record<TabId, ReactNode> = { meals, pantry, history };

  // **設定は4つ目の行き先である**（B-60 設計 6章 規則7）。開いている間はタブの中身の代わりに
  // 設定を描き、**どのタブも選ばない**（原本 `TabBar active="none"`）。開いているかを持つのは
  // 門であり（ADR-066 と同じ理由）、器は渡されたかどうかを見るだけである。
  const settingsOpen = settings !== null;

  // **帯は中身より後ろに置く**（同 規則4 / NFR-14。B-60 規則5）。親指の届く画面の下端に帯を
  // 出すための文書順である。**SP の下端への固定も PC の左のサイドナビも CSS が担い**（設計 B-59
  // 6章 規則10 / B-60 規則1・2・5）、文書順は変えない — 読み上げと Tab キーの順は中身 → 帯の
  // まま残る。幅を JS で読まない（`matchMedia` を使わない。B-60 規則2）。
  //
  // **選んだタブの中身だけを描く**（同 規則6）。残る2つは `hidden` で隠すのでもなく、
  // そもそも木に置かない — 隠して置くと、出ていない画面が効果を走らせ続ける。設定を開いて
  // いる間は、選んでいたタブの中身も木から外れる（B-60 規則10）。
  //
  // 外枠の1枚は PC で帯を左・中身を右に並べるためのもの（B-60 規則5）。意味は持たない。
  return (
    <div className={styles.frame}>
      {settingsOpen ? (
        // **設定を描く間は `tabpanel` にしない** — ラベルするタブが無い（B-60 規則7）。
        <div className={styles.panel}>{settings}</div>
      ) : (
        <div
          role="tabpanel"
          id={PANEL_ID}
          aria-labelledby={tabElementId(selectedTab)}
          // 下端に固定した帯に、中身の末尾が隠れないための余白（同 規則10。SP のときだけ）。
          className={styles.panel}
        >
          {contents[selectedTab]}
        </div>
      )}

      {/* 帯全体。SP では下タブ、PC では左のサイドナビになる（B-60 規則3）。**タブは1組だけ。** */}
      <nav className={styles.bar}>
        {/* ロゴ（原本 `SideNav`）。**SP では出さない**のは CSS の仕事で、DOM には常にある（規則4）。 */}
        <div className={styles.logo}>fridge to meal</div>

        <div role="tablist" className={styles.tablist}>
          {TAB_ORDER.map((tab) => {
            const selected = !settingsOpen && tab === selectedTab;

            return (
              <button
                key={tab}
                // **中身がまだ無いタブも無効化しない**（同 規則7）。feature flag を置かないのと
                // 同じ理由で、作りかけはそのまま出す（`CLAUDE.md`）。
                type="button"
                role="tab"
                id={tabElementId(tab)}
                // 選んでいるタブを**色に依らず**読み取れる形で示す（同 規則5。NFR-17 の構え）。
                // 設定を開いている間は、どのタブも選ばれていない（B-60 規則7）。
                aria-selected={selected}
                // 指す先（中身の欄）が `tabpanel` でない間は付けない — 存在しない id を指さない
                // （B-60 規則7）。
                aria-controls={settingsOpen ? undefined : PANEL_ID}
                // **色に依らない見た目の手がかりを上乗せする**（B-41 設計 6章 規則5・6）。
                // `aria-selected` の置き換えではない。**値は `TabbedScreen.module.css` にだけ置き、
                // ここに数値も色も書かない**（ADR-055 決定1・2）。
                className={tabClassOf(selected)}
                // **`tabIndex` を振り分けない。** 選んでいないタブを `-1` にするのは矢印キーで
                // 移れる実装と対になる作法であり、その鍵の扱いをまだ持たない今は、素の button の
                // ままにして Tab キーで3つとも辿れるようにしておく。
                //
                // 設定を開いている間に押しても届く（押したのが開く前に選んでいたタブでも）。
                // 設定を閉じてそのタブを出すのは門である（B-60 規則8）。
                onClick={() => onSelectTab(tab)}
              >
                <Icon name={TAB_ICONS[tab]} />
                <span className={styles.label}>{TAB_LABELS[tab]}</span>
              </button>
            );
          })}
        </div>

        {/*
         * 設定の行き先（原本 `SideNav` の下端）。**`tablist` の外に置く** — 4つ目のタブではなく、
         * 開いている間は `aria-current="page"` で「今いる場所」と示す（B-60 規則7）。見た目は
         * 選んでいるタブと同じ手がかり（太さ・線）で、**SP では出さない**（規則4。CSS の仕事）。
         */}
        <button
          type="button"
          aria-current={settingsOpen ? 'page' : undefined}
          className={settingsClassOf(settingsOpen)}
          onClick={onOpenSettings}
        >
          <Icon name="settings" />
          <span className={styles.label}>{SETTINGS_LABEL}</span>
        </button>
      </nav>
    </div>
  );
}
