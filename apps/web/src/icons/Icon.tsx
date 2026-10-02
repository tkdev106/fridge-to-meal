/**
 * アイコンの部品（設計 B-59 5章 / 6章 規則4・5。原本 `docs/design/src/Icon.dc.html`）。
 *
 * **形は原本の11個をそのまま写す。** `viewBox` も path も変えない — 形を詰めるのはデザインの側で
 * あって、ここで描き直すと原本との突き合わせができなくなる（ADR-074 決定1）。
 *
 * **色は持たない。** 線も塗りも `currentColor` で、置き場の文字色に従う。色をここで決めると、
 * 置き場ごとに配色を変えたい周が部品を分けることになる。
 *
 * **アイコンは飾りである**（同 規則5 / NFR-17 の構え）。`aria-hidden` で読み上げから外し、
 * 名前は置き場の側（文字・`aria-label`）が持つ。アイコンだけで意味を運ぶと、読み上げにも
 * 色や形を見分けにくい利用者にも何も届かない。
 */

import type { JSX, ReactNode } from 'react';
import styles from './Icon.module.css';

export type IconName =
  | 'meal'
  | 'pantry'
  | 'history'
  | 'plus'
  | 'back'
  | 'settings'
  | 'more'
  | 'info'
  | 'check'
  | 'x'
  | 'alert';

export type IconProps = { name: IconName; size?: number };

/** 原本の既定の大きさ。 */
const DEFAULT_SIZE = 24;

/** 線で描く10個の中身。`more` だけは塗りなのでここに置かない（下の `MORE_SHAPE`）。 */
const STROKE_SHAPES: Record<Exclude<IconName, 'more'>, ReactNode> = {
  meal: (
    <>
      <path d="M4 11h16a8 8 0 0 1-16 0Z" />
      <path d="M9 21.5h6" />
      <path d="M10 4v3" />
      <path d="M14 4v3" />
    </>
  ),
  pantry: (
    <>
      <path d="M5.5 2.5h13v19h-13Z" />
      <path d="M5.5 10h13" />
      <path d="M9 5.5v1.5" />
      <path d="M9 13v3" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  back: (
    <>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </>
  ),
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.5h.01" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  alert: (
    <>
      <path d="M12 5v9" />
      <path d="M12 19h.01" />
    </>
  ),
};

/** `more` の3つの点。原本でも塗りで描き、線を持たない。 */
const MORE_SHAPE: ReactNode = (
  <>
    <circle cx="5" cy="12" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="19" cy="12" r="1.5" />
  </>
);

/**
 * 線の太さ。**大きさに反比例させ、描かれる太さを 1.5px 相当に保つ**（原本の `sw`）。
 * 原本と同じく小数2桁に丸めた文字列で持つ。
 */
const strokeWidthOf = (size: number): string => ((1.5 * DEFAULT_SIZE) / size).toFixed(2);

export function Icon({ name, size = DEFAULT_SIZE }: IconProps): JSX.Element {
  // 置き場の側が名前を持つので、アイコンは読み上げにもフォーカスの巡回にも出さない（規則5）。
  // `focusable` は SVG を Tab で辿れてしまう古いブラウザのための指定である。
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    focusable: 'false',
    // 置き方（行の中で浮かせない・縮ませない）は CSS の側に置く（ADR-055 決定1）。
    className: styles.icon,
  } as const;

  if (name === 'more') {
    return (
      <svg {...common} fill="currentColor" stroke="none">
        {MORE_SHAPE}
      </svg>
    );
  }

  return (
    <svg
      {...common}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidthOf(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {STROKE_SHAPES[name]}
    </svg>
  );
}
