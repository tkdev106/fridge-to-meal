// @vitest-environment jsdom
/**
 * アイコンの部品 `Icon`（設計 B-59 6章 規則5 / NFR-17 の構え / ADR-052）。
 *
 * **アイコンは飾りである。** 名前は置き場の側（文字・`aria-label`）が持ち、アイコンは読み上げに
 * 何も足さない。観るのは**役割の無さと名前の扱い**だけで、形（path）や線の太さ・寸法は
 * 単体テストで見ない（ADR-055 決定3）。
 *
 * **仮の文言を期待値に書かない**（`docs/testing.md` 4.1）。名前は**テストが渡したもの**で観る。
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '../support/dom/renderComponent.js';
import type { IconName } from '../../src/icons/Icon.js';
import { Icon } from '../../src/icons/Icon.js';

/** 原本 `Icon` の `options` の11個（設計 B-59 3章）。 */
const iconNames: readonly IconName[] = [
  'meal',
  'pantry',
  'history',
  'plus',
  'back',
  'settings',
  'more',
  'info',
  'check',
  'x',
  'alert',
];

/** 操作に与える名前。**テストが渡したもの**と読める文字列にしておく。 */
const givenName = 'テストが渡した名前';

describe('アイコン Icon', () => {
  it.each(iconNames)('アイコン %s は、それを置いた操作の名前に何も足さない', (name) => {
    render(
      <button type="button">
        <Icon name={name} />
        {givenName}
      </button>,
    );

    // 設計 B-59 6章 規則5 / NFR-17 の構え: 名前は置き場の側が持つ。アイコンが読み上げに
    // 何かを足すと、操作の名前が渡した文字と一致しなくなる。
    expect(screen.getByRole('button', { name: givenName })).not.toBeNull();
  });

  it.each(iconNames)(
    'アイコン %s を単独で置いても、名前のある画像として読み上げに出ない',
    (name) => {
      render(<Icon name={name} />);

      // 同 規則5: `aria-hidden` で読み上げから外す。画像の役割で見つかったら飾りではない。
      expect(screen.queryByRole('img')).toBeNull();
    },
  );
});
