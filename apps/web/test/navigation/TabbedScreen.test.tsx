// @vitest-environment jsdom
/**
 * `TabbedScreen` の**出し分け**（B-38 設計 6章 規則4〜7 / `docs/testing.md` 4.1 / ADR-052）。
 *
 * 既定のタブ・並び・その整合（規則1〜3）は `Tabs.test.ts` の持ち分である。ここで確かめるのは
 * **切り出せないもの**だけ — 帯と中身の前後、選んでいるタブの示し方、選んだタブの中身だけを
 * 出すこと、中身の無いタブも隠さないこと。
 *
 * **仮の文言を期待値に書かない**（ADR-052 結果2 / `docs/testing.md` 4.1）。タブのラベルは未確定で
 * あり（`docs/screen-design.md` 論点3）、留めると**文言を変えただけで赤くなる**。代わりに
 * **役割（`tab` / `tablist` / `tabpanel`）と `aria-selected`**、そして**テストが渡した中身**で観察する。
 *
 * **タブは並びの位置で引く。** 名前で引けない以上、`TAB_ORDER` の何番目かで指す。
 * **`TAB_ORDER` の値をここに再掲しない** — 並びそのものは `Tabs.test.ts` が押さえている。
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '../support/dom/renderComponent.js';
import type { TabId } from '../../src/navigation/Tabs.js';
import { TAB_ORDER } from '../../src/navigation/Tabs.js';
import { tabStyleOf } from '../../src/navigation/TabAppearance.js';
import type { TabbedScreenProps } from '../../src/navigation/TabbedScreen.js';
import { TabbedScreen } from '../../src/navigation/TabbedScreen.js';

/**
 * 3つのタブへ渡す中身。**「テストが渡したもの」と読める文字列**にしておく —
 * 画面が持つ仮の文言（タブのラベル・仮置きの案内）と取り違えないため。
 */
const contents = {
  meals: '渡された献立の中身',
  pantry: '渡された在庫の中身',
  history: '渡された履歴の中身',
} as const;

function renderTabbedScreen(overrides: Partial<TabbedScreenProps> = {}) {
  render(
    <TabbedScreen
      meals={contents.meals}
      pantry={contents.pantry}
      history={contents.history}
      {...overrides}
    />,
  );
}

/** 並びの位置でタブを引く。`getAllByRole` は文書順に返る。 */
function tabFor(tab: TabId): HTMLElement {
  const found = screen.getAllByRole('tab')[TAB_ORDER.indexOf(tab)];
  if (found === undefined) throw new Error(`${tab} のタブが帯に無い`);

  return found;
}

/**
 * `CSSProperties` のキーを CSS の属性名に直す（`borderTopWidth` → `border-top-width`）。
 */
function cssPropertyNameOf(key: string): string {
  return key.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`);
}

/**
 * 見た目を**同じ正規化を通してから**読み出す（`docs/testing.md` 3章 の「同じ正規化を通った
 * 者どうしを比べる」— RLS の述語の突き合わせと同じ構え）。
 *
 * `CSSProperties` 側は数値でも書けるうえ、ブラウザ（jsdom）は `'currentColor'` のような値を
 * 書き換えることがある。そこで**期待の側もいったん要素に当ててから読み戻し**、木から読んだ
 * 値と同じ土俵に乗せる。**具体値はここにも書かない。**
 *
 * **読むキーは `tabStyleOf` が返したものすべてである。** 一部の項目だけを突き合わせると、
 * **戻り値の一部しか当てていない実装でも緑になる**（B-41 設計 6章 規則6 は丸ごと当てることを
 * 求めている）。
 */
function styleValuesOf(
  source: CSSStyleDeclaration,
  keys: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    keys.map((key) => [key, source.getPropertyValue(cssPropertyNameOf(key))]),
  );
}

/** 木に当たっている見た目。読むのは `tabStyleOf` が返したキーだけ。 */
function appliedStyleOf(tab: HTMLElement, selected: boolean): Record<string, string> {
  return styleValuesOf(tab.style, Object.keys(tabStyleOf(selected)));
}

/**
 * 当たっているべき見た目。いったん要素に当てて読み戻し、木の側と同じ正規化を通す。
 */
function expectedStyleOf(selected: boolean): Record<string, string> {
  const expected = tabStyleOf(selected);
  const scratch = document.createElement('button');
  Object.assign(scratch.style, expected);

  return styleValuesOf(scratch.style, Object.keys(expected));
}

describe('下タブの器 TabbedScreen', () => {
  it('最初に出すのは在庫タブに渡された中身である', () => {
    renderTabbedScreen();

    // 要件 第7章（ホームは在庫一覧）/ B-38 設計 6章 規則6。
    expect(screen.queryByText(contents.pantry)).not.toBeNull();
  });

  it('選んでいないタブの中身は描かない（隠して置くのでもない）', () => {
    renderTabbedScreen();

    // **`hidden` で隠すのでもない**（同 規則6 / `docs/screen-design.md` 2.1）。
    // `queryByText` は hidden な要素も**見つける**ので、`null` であることが
    // 「そもそも描いていない」を意味する。**この行を役割で書かない** —
    // `queryAllByRole` は既定で hidden を除くため、隠した実装でも緑になってしまう。
    expect(screen.queryByText(contents.meals)).toBeNull();
    expect(screen.queryByText(contents.history)).toBeNull();
  });

  it('献立タブを選ぶと、献立に渡された中身が出る', () => {
    renderTabbedScreen();

    fireEvent.click(tabFor('meals'));

    // B-38 設計 6章 規則6。
    expect(screen.queryByText(contents.meals)).not.toBeNull();
  });

  it('献立タブを選ぶと、在庫に渡された中身は出なくなる', () => {
    renderTabbedScreen();

    fireEvent.click(tabFor('meals'));

    // **入れ替わりであって、足し算ではない**（同 規則6）。
    expect(screen.queryByText(contents.pantry)).toBeNull();
  });

  it('履歴タブを選ぶと、履歴に渡された中身が出る', () => {
    renderTabbedScreen();

    fireEvent.click(tabFor('history'));

    // B-38 設計 6章 規則6。
    expect(screen.queryByText(contents.history)).not.toBeNull();
  });

  it('最初に選ばれているタブは、色に依らない手がかりで読み取れる', () => {
    renderTabbedScreen();

    // B-38 設計 6章 規則5・規則1（NFR-17 の構え）。`aria-selected` は色を使わずに読める。
    expect(tabFor('pantry').getAttribute('aria-selected')).toBe('true');
  });

  it('選ばれているタブは常に1つだけである', () => {
    renderTabbedScreen();

    // 同 規則5 の境界。**選ばれていない示し方は断定しない**（`'false'` とは限らず、
    // 属性が無いこともある）ので、`'true'` でないことだけを見る。
    expect(tabFor('meals').getAttribute('aria-selected')).not.toBe('true');
    expect(tabFor('history').getAttribute('aria-selected')).not.toBe('true');
  });

  it('献立タブを選ぶと、選ばれている印が在庫タブから献立タブへ移る', () => {
    renderTabbedScreen();

    fireEvent.click(tabFor('meals'));

    // 同 規則5。**移ることまでが規則である** — 印が増えるだけでは1つに保てない。
    expect(tabFor('meals').getAttribute('aria-selected')).toBe('true');
    expect(tabFor('pantry').getAttribute('aria-selected')).not.toBe('true');
  });

  it('中身がまだ無いタブも帯から消さない', () => {
    renderTabbedScreen({ meals: null, history: null });

    // 同 規則7 / `CLAUDE.md`（feature flag を置かない）。中身の有無で帯は変わらない。
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('中身がまだ無い献立タブも押して開ける', () => {
    renderTabbedScreen({ meals: null });

    fireEvent.click(tabFor('meals'));

    // 同 規則7: **タブも無効化しない。** `disabled` 属性そのものは断定せず、
    // 「押したら開く」という観察できる結果で見る。
    expect(tabFor('meals').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText(contents.pantry)).toBeNull();
  });

  it('タブの帯は中身より後ろに置く', () => {
    renderTabbedScreen();

    // NFR-14（片手操作）/ B-38 設計 6章 規則4。jsdom はレイアウトを持たないため、
    // 「画面の下端」は**文書順**として読む（設計がそう定めている）。
    const tablist = screen.getByRole('tablist');
    const panel = screen.getByRole('tabpanel');
    // 比較の定数は**ノード自身から引く**（`Node` の大域名を使わない）。
    const tablistFollowsPanel =
      (panel.compareDocumentPosition(tablist) & panel.DOCUMENT_POSITION_FOLLOWING) !== 0;

    expect(tablistFollowsPanel).toBe(true);
  });

  it('選ばれているタブには、選んでいるときの見た目が当たっている', () => {
    renderTabbedScreen();

    // B-41 設計 6章 規則6・規則1: 見た目の値は `TabAppearance.ts` にだけ置く。
    // **突き合わせる相手は `tabStyleOf` の戻り値**であり、太さの具体値は書かない。
    expect(appliedStyleOf(tabFor('pantry'), true)).toEqual(expectedStyleOf(true));
  });

  it('選ばれていない2つのタブには、どちらも選んでいないときの見た目が当たっている', () => {
    renderTabbedScreen();

    // 同 規則6・規則7: 見た目は「選ばれているか」だけで決まり、`TabId` ごとに変わらない。
    expect(appliedStyleOf(tabFor('meals'), false)).toEqual(expectedStyleOf(false));
    expect(appliedStyleOf(tabFor('history'), false)).toEqual(expectedStyleOf(false));
  });

  it('献立タブを選ぶと、色に依らない手がかりが在庫タブから献立タブへ移る', () => {
    renderTabbedScreen();

    fireEvent.click(tabFor('meals'));

    // 同 規則1・2 の波及。**移ることまでが規則である** — 手がかりが増えるだけでは1つに保てない。
    expect(appliedStyleOf(tabFor('meals'), true)).toEqual(expectedStyleOf(true));
    expect(appliedStyleOf(tabFor('pantry'), false)).toEqual(expectedStyleOf(false));
  });

  it('見た目の手がかりが付いたタブは aria-selected も true である', () => {
    renderTabbedScreen();

    fireEvent.click(tabFor('meals'));

    // 同 規則5 / B-38 設計 6章 規則5: 見た目の手がかりは `aria-selected` の
    // **置き換えではなく上乗せ**である。**同じ1つのタブで**両方が立つことを見る。
    const tab = tabFor('meals');
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(appliedStyleOf(tab, true)).toEqual(expectedStyleOf(true));
  });
});
