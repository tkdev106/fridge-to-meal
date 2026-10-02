/**
 * 見出しの行（B-60 設計 4章 / 5章 / 6章 規則12〜14）。`h1` とその右の歯車（`aria-label="設定"`）。
 *
 * 献立・在庫（一覧）・履歴の3つの一覧の先頭に置かれる。`features/` から import してよい唯一の
 * `navigation/` の部品である（同 規則14）。`navigation/` から `features/` は import しない。
 *
 * - **`h1` には題の文字だけを入れる**（規則13）。歯車を `h1` の中に入れると見出しの名前が崩れる
 * - **歯車は文書順で `h1` の後ろ**に置き、名前は `aria-label="設定"` だけ（アイコンは飾り。
 *   `icons/README.md` / NFR-16）
 * - **設定を開いているかは門が持つ**（ADR-066）。ここは押下を口で渡すだけである
 * - **PC（幅 1024px 以上）では歯車を出さない**（規則4）。PC の入口はサイドナビの下端の「設定」で、
 *   出し分けは `ScreenHeader.module.css` のメディアクエリだけで行う（規則2。JS で幅を読まない）
 */

import type { JSX, ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import styles from './ScreenHeader.module.css';

export type ScreenHeaderProps = {
  title: string;
  onOpenSettings: () => void;
  /**
   * 題の行の下に添えるもの（献立の凡例など。B-61 規則3）。見出しの行の外枠（`header`）の中に
   * 置く — `header` は入れ子にできないので、画面の側で別の `header` を作らせない。
   */
  children?: ReactNode;
};

/** 歯車の名前（原本の `aria-label`。ADR-074 決定1 — 文言の正は `docs/design/`）。 */
const SETTINGS_LABEL = '設定';

export function ScreenHeader({ title, onOpenSettings, children }: ScreenHeaderProps): JSX.Element {
  return (
    <header className={styles.header}>
      <div className={styles.row}>
        <h1 className={styles.title}>{title}</h1>
        <button
          type="button"
          className={styles.settings}
          aria-label={SETTINGS_LABEL}
          onClick={onOpenSettings}
        >
          <Icon name="settings" />
        </button>
      </div>
      {children}
    </header>
  );
}
