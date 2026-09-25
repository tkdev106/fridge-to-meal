// @vitest-environment jsdom
/**
 * `TabbedScreen` の**出し分け**（B-38 設計 6章 規則4〜7 / ADR-066 / `docs/testing.md` 4.1 /
 * ADR-052）。
 *
 * **器は選んでいるタブを持たない**（ADR-066 決定1）。`selectedTab` と `onSelectTab` を props で
 * 受け取り、状態は門（`App.tsx`）が持つ — 画面の側からタブを移す手段が要るためである
 * （`docs/screen-design.md` D-7 / B-49c）。**B-38 設計 6章 規則8（器の `useState`）はここで
 * 置き換わった**（ADR-066 結果1）。そのため「押したら中身が入れ替わる」観点は、
 * **押したことが口に届くか**と、**渡された `selectedTab` のとおりに描くか**の2つに分かれる。
 *
 * 既定のタブ・並び・その整合（規則1〜3）は `Tabs.test.ts` の持ち分である。ここで確かめるのは
 * **切り出せないもの**だけ — 帯と中身の前後、選んでいるタブの示し方、渡されたタブの中身だけを
 * 出すこと、中身の無いタブも隠さないこと。
 *
 * **仮の文言を期待値に書かない**（ADR-052 結果2 / `docs/testing.md` 4.1）。タブのラベルは未確定で
 * あり（`docs/screen-design.md` 論点3）、留めると**文言を変えただけで赤くなる**。代わりに
 * **役割（`tab` / `tablist` / `tabpanel`）と `aria-selected`**、そして**テストが渡した中身**で観察する。
 *
 * **`vi.fn()` で呼び出し回数を数えない**（`docs/testing.md` 2章）。`onSelectTab` が受け取った
 * `TabId` を**控えて観る**。
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

/**
 * `onSelectTab` が受け取った `TabId` の控え。**回数は数えない**（`docs/testing.md` 2章）—
 * 観るのは「どのタブの識別子が届いたか」だけである。
 *
 * 控え先を**オブジェクトの属性**にしているのは型の都合である（`let` に控えると、
 * 初期値の `null` に絞り込まれたまま `toBe` の相手と噛み合わなくなる）。
 */
function selectedTabRecord(): { latest: TabId | null } {
  return { latest: null };
}

/**
 * 器を描く。**`selectedTab` は必ず外から渡る**（ADR-066 決定1）ので、既定を置くのは
 * テストの都合であり、器の既定ではない。
 */
function tabbedScreen(overrides: Partial<TabbedScreenProps> = {}) {
  return (
    <TabbedScreen
      meals={contents.meals}
      pantry={contents.pantry}
      history={contents.history}
      selectedTab="meals"
      onSelectTab={() => {}}
      {...overrides}
    />
  );
}

/** 描いたうえで、**同じ木のまま props を差し替える**口を返す（新しく描き直さない）。 */
function renderTabbedScreen(overrides: Partial<TabbedScreenProps> = {}) {
  const { rerender } = render(tabbedScreen(overrides));

  return {
    rerender: (next: Partial<TabbedScreenProps> = {}) => rerender(tabbedScreen(next)),
  };
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
  it('渡された選択中のタブの中身だけを描く', () => {
    renderTabbedScreen({ selectedTab: 'pantry' });

    // B-38 設計 6章 規則6 / ADR-066 決定1。**残る2つは `hidden` で隠すのでもなく、
    // そもそも木に置かない** — `queryByText` は hidden な要素も**見つける**ので、
    // `null` であることが「そもそも描いていない」を意味する。**役割で書かない** —
    // `queryAllByRole` は既定で hidden を除くため、隠した実装でも緑になってしまう。
    expect(screen.queryByText(contents.pantry)).not.toBeNull();
    expect(screen.queryByText(contents.meals)).toBeNull();
    expect(screen.queryByText(contents.history)).toBeNull();
  });

  it('器は既定のタブを自分では決めない', () => {
    renderTabbedScreen({ selectedTab: 'history' });

    // ADR-066 決定1・結果1: 既定（`DEFAULT_TAB` = 献立）を決めるのは門であり、器ではない。
    // **器が `DEFAULT_TAB` を読んでいたらここが落ちる。**
    expect(screen.queryByText(contents.history)).not.toBeNull();
    expect(screen.queryByText(contents.meals)).toBeNull();
  });

  it('渡された選択中のタブだけが、色に依らない手がかりで選ばれていると読める', () => {
    renderTabbedScreen({ selectedTab: 'pantry' });

    // B-38 設計 6章 規則5（NFR-17 の構え）。**選ばれていない示し方は断定しない**
    // （`'false'` とは限らず、属性が無いこともある）ので、`'true'` でないことだけを見る。
    expect(tabFor('pantry').getAttribute('aria-selected')).toBe('true');
    expect(tabFor('meals').getAttribute('aria-selected')).not.toBe('true');
    expect(tabFor('history').getAttribute('aria-selected')).not.toBe('true');
  });

  it('渡された選択中のタブには、選んでいるときの見た目が当たっている', () => {
    renderTabbedScreen({ selectedTab: 'pantry' });

    // B-41 設計 6章 規則6・規則7: 見た目の値は `TabAppearance.ts` にだけ置き、
    // 「選ばれているか」だけで決まる（`TabId` ごとに変わらない）。**太さの具体値は書かない。**
    expect(appliedStyleOf(tabFor('pantry'), true)).toEqual(expectedStyleOf(true));
    expect(appliedStyleOf(tabFor('meals'), false)).toEqual(expectedStyleOf(false));
    expect(appliedStyleOf(tabFor('history'), false)).toEqual(expectedStyleOf(false));
  });

  it('タブを押すと、そのタブの識別子が渡した口に届く', () => {
    const record = selectedTabRecord();
    renderTabbedScreen({
      selectedTab: 'meals',
      onSelectTab: (tab) => {
        record.latest = tab;
      },
    });

    fireEvent.click(tabFor('pantry'));

    // ADR-066 決定1・決定3: 器が運ぶのは `TabId` だけであり、「在庫タブへ送る」という
    // 意味は器に無い。
    expect(record.latest).toBe('pantry');
  });

  it('押したタブごとに違う識別子が届く', () => {
    const record = selectedTabRecord();
    renderTabbedScreen({
      selectedTab: 'meals',
      onSelectTab: (tab) => {
        record.latest = tab;
      },
    });

    fireEvent.click(tabFor('history'));

    // 同 決定3 の境界: 押したタブに関わらず同じ識別子を渡す実装をここで落とす。
    expect(record.latest).toBe('history');
  });

  it('押しただけでは中身を入れ替えない（器は選んでいるタブを持たない）', () => {
    renderTabbedScreen({ selectedTab: 'meals' });

    fireEvent.click(tabFor('pantry'));

    // ADR-066 決定1: 状態は門が持つ。**器が自分で切り替えると、門の持つ状態と
    // 画面の見えが二重になる** — 門がタブを移しても器が従わない回が生まれる。
    expect(screen.queryByText(contents.meals)).not.toBeNull();
    expect(screen.queryByText(contents.pantry)).toBeNull();
  });

  it('渡される選択中のタブが変わると、中身が入れ替わる', () => {
    const { rerender } = renderTabbedScreen({ selectedTab: 'meals' });

    rerender({ selectedTab: 'pantry' });

    // B-38 設計 6章 規則6: **入れ替わりであって、足し算ではない。**
    expect(screen.queryByText(contents.pantry)).not.toBeNull();
    expect(screen.queryByText(contents.meals)).toBeNull();
  });

  it('渡される選択中のタブが変わると、選ばれている印も移る', () => {
    const { rerender } = renderTabbedScreen({ selectedTab: 'meals' });

    rerender({ selectedTab: 'pantry' });

    // 同 規則5: **移ることまでが規則である** — 印が増えるだけでは1つに保てない。
    expect(tabFor('pantry').getAttribute('aria-selected')).toBe('true');
    expect(tabFor('meals').getAttribute('aria-selected')).not.toBe('true');
  });

  it('渡される選択中のタブが変わると、色に依らない見た目の手がかりも移る', () => {
    const { rerender } = renderTabbedScreen({ selectedTab: 'meals' });

    rerender({ selectedTab: 'pantry' });

    // B-41 設計 6章 規則1・2 の波及。**手がかりが増えるだけでは1つに保てない。**
    expect(appliedStyleOf(tabFor('pantry'), true)).toEqual(expectedStyleOf(true));
    expect(appliedStyleOf(tabFor('meals'), false)).toEqual(expectedStyleOf(false));
  });

  it('中身がまだ無いタブも帯から消さない', () => {
    renderTabbedScreen({ selectedTab: 'pantry', meals: null, history: null });

    // B-38 設計 6章 規則7 / `CLAUDE.md`（feature flag を置かない）。中身の有無で帯は変わらない。
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('中身がまだ無い履歴タブも押せる', () => {
    const record = selectedTabRecord();
    renderTabbedScreen({
      selectedTab: 'meals',
      history: null,
      onSelectTab: (tab) => {
        record.latest = tab;
      },
    });

    fireEvent.click(tabFor('history'));

    // 同 規則7: **タブも無効化しない。** `disabled` 属性そのものは断定せず、
    // 「押したら口に届く」という観察できる結果で見る。
    expect(record.latest).toBe('history');
  });

  it('タブの帯は中身より後ろに置く', () => {
    renderTabbedScreen({ selectedTab: 'meals' });

    // NFR-14（片手操作）/ B-38 設計 6章 規則4。jsdom はレイアウトを持たないため、
    // 「画面の下端」は**文書順**として読む（設計がそう定めている）。
    const tablist = screen.getByRole('tablist');
    const panel = screen.getByRole('tabpanel');
    // 比較の定数は**ノード自身から引く**（`Node` の大域名を使わない）。
    const tablistFollowsPanel =
      (panel.compareDocumentPosition(tablist) & panel.DOCUMENT_POSITION_FOLLOWING) !== 0;

    expect(tablistFollowsPanel).toBe(true);
  });
});
