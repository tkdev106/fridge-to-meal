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
 * **選んでいるタブの見た目は、当たっている class をタブどうしで比べて観る**（ADR-055 決定1 /
 * backlog B-59）。見た目の値（色・寸法・太さ）は単体テストで見ず（ADR-055 決定3）、**class 名の
 * literal も書かない** — 名前は CSS Modules が生成するものであり、留めると名前を変えただけで
 * 赤くなる。観るのは「選んでいるタブと選んでいないタブで違う」「選んでいないタブどうしは同じ」
 * という関係だけである。
 *
 * **タブは並びの位置で引く。** 名前で引けない以上、`TAB_ORDER` の何番目かで指す。
 * **`TAB_ORDER` の値をここに再掲しない** — 並びそのものは `Tabs.test.ts` が押さえている。
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '../support/dom/renderComponent.js';
import type { TabId } from '../../src/navigation/Tabs.js';
import { TAB_ORDER } from '../../src/navigation/Tabs.js';
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
  settings: '渡された設定の中身',
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
      settings={null}
      onOpenSettings={() => {}}
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
 * 帯の「設定」（B-60 設計 6章 規則4・7）。**帯（`navigation`）の中で名前で引く** — 見出しの
 * 歯車（2周目）も同じ名前「設定」を持つため、置き場で絞る（同 8章）。文言は原本
 * （`docs/design/src/SideNav.dc.html`）から取ったもので仮ではない（ADR-074 決定1）。
 */
function navigationSettings(): HTMLElement {
  return within(screen.getByRole('navigation')).getByRole('button', { name: '設定' });
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

  it('選んでいるタブと選んでいないタブには、違う class が当たる', () => {
    renderTabbedScreen({ selectedTab: 'pantry' });

    // ADR-055 決定1 / backlog B-59: 選んでいるときの見た目は class で当てる（色に依らない手がかり。
    // B-41 規則1・2）。**名前の literal は書かず、タブどうしで比べる。**
    expect(tabFor('pantry').className).not.toBe(tabFor('meals').className);
  });

  it('選んでいないタブには、どのタブにも同じ class が当たる', () => {
    renderTabbedScreen({ selectedTab: 'pantry' });

    // ADR-055 決定1 / backlog B-59（B-41 規則7）: 見た目は「選んでいるか」だけで決まり、
    // `TabId` ごとに分けない。
    expect(tabFor('meals').className).toBe(tabFor('history').className);
  });

  it('選んでいないタブにも見た目の class が当たっている', () => {
    renderTabbedScreen({ selectedTab: 'pantry' });

    // ADR-055 決定1 / backlog B-59: 選んでいない側の見た目も class で明示する
    // （太さを両方明示する。設計 B-59 6章 規則7）。**class が空のまま「違う」を満たす実装をここで落とす。**
    expect(tabFor('meals').className).not.toBe('');
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

  it('渡される選択中のタブが変わると、選んでいるときの class も移る', () => {
    const { rerender } = renderTabbedScreen({ selectedTab: 'meals' });
    const selectedClassBefore = tabFor('meals').className;

    rerender({ selectedTab: 'pantry' });

    // ADR-055 決定1 / backlog B-59（B-41 規則1・2 の波及）: **手がかりが増えるだけでは1つに保てない。**
    expect(tabFor('pantry').className).toBe(selectedClassBefore);
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

  it('設定が渡されていなくても、帯に「設定」の操作を置く', () => {
    renderTabbedScreen({ settings: null });

    // B-60 規則4: サイドナビの「設定」は DOM に常にある（SP で隠すのは CSS）。
    expect(screen.queryAllByRole('button', { name: '設定' })).toHaveLength(1);
  });

  it('ロゴを器に出す', () => {
    renderTabbedScreen();

    // B-60 規則4: ロゴ「fridge to meal」は DOM に常にある（原本 `SideNav`。SP で隠すのは CSS）。
    expect(screen.queryByText('fridge to meal')).not.toBeNull();
  });

  it('帯の「設定」を押すと、設定を開く求めが口に届く', () => {
    const openRequests: string[] = [];
    renderTabbedScreen({ onOpenSettings: () => openRequests.push('settings') });

    fireEvent.click(navigationSettings());

    // B-60 規則7: 器は押されたことを伝えるだけで、開いているかは門が持つ（ADR-066 と同じ理由）。
    expect(openRequests).toEqual(['settings']);
  });

  it('設定を開いている間もタブは3つ出ている', () => {
    renderTabbedScreen({ settings: <p>{contents.settings}</p> });

    // B-60 規則3: タブは1組だけで、設定を開いても帯から消さない。
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('設定が渡されていれば、選んでいるタブの中身の代わりに設定を描く', () => {
    renderTabbedScreen({ selectedTab: 'pantry', settings: <p>{contents.settings}</p> });

    // B-60 規則7: 設定は4つ目の行き先であり、入れ替わりであって足し算ではない。
    expect(screen.queryByText(contents.settings)).not.toBeNull();
    expect(screen.queryByText(contents.pantry)).toBeNull();
  });

  it('設定が渡されている間は、どのタブも選ばれていると読めない', () => {
    renderTabbedScreen({ selectedTab: 'pantry', settings: <p>{contents.settings}</p> });

    // B-60 規則7（原本 `TabBar active="none"`）。
    const selectedTabs = screen
      .getAllByRole('tab')
      .filter((tab) => tab.getAttribute('aria-selected') === 'true');

    expect(selectedTabs).toHaveLength(0);
  });

  it('設定が渡されている間は、選んでいたタブにも選んでいないタブと同じ class が当たる', () => {
    renderTabbedScreen({ selectedTab: 'pantry', settings: <p>{contents.settings}</p> });

    // B-60 規則7 / ADR-055 決定1: 見た目の手がかりも「どのタブも選ばない」に揃える。
    expect(tabFor('pantry').className).toBe(tabFor('meals').className);
  });

  it('設定が渡されている間は、中身の欄を tabpanel にしない', () => {
    renderTabbedScreen({ selectedTab: 'pantry', settings: <p>{contents.settings}</p> });

    // B-60 規則7: ラベルするタブが無い。
    expect(screen.queryByRole('tabpanel')).toBeNull();
  });

  it('設定が渡されている間は、タブの aria-controls が存在しない id を指さない', () => {
    renderTabbedScreen({ selectedTab: 'pantry', settings: <p>{contents.settings}</p> });

    // B-60 規則7: 指す先が無いなら属性を持たない。持つなら実在する要素を指す。
    const danglingTabs = screen.getAllByRole('tab').filter((tab) => {
      const controls = tab.getAttribute('aria-controls');
      return controls !== null && document.getElementById(controls) === null;
    });

    expect(danglingTabs).toHaveLength(0);
  });

  it('設定が渡されている間は、帯の「設定」が今いる場所だと読める', () => {
    renderTabbedScreen({ settings: <p>{contents.settings}</p> });

    // B-60 規則7（原本 `SideNav active="settings"`）。
    expect(navigationSettings().getAttribute('aria-current')).toBe('page');
  });

  it('設定が渡されていない間は、帯の「設定」を今いる場所だと読ませない', () => {
    renderTabbedScreen({ settings: null });

    // B-60 規則7 の裏側: 開いていないのに「今いる場所」と読ませない。
    expect(navigationSettings().getAttribute('aria-current')).not.toBe('page');
  });

  it('設定が渡されると、帯の「設定」に当たる class が変わる', () => {
    const { rerender } = renderTabbedScreen({ settings: null });
    const classBefore = navigationSettings().className;

    rerender({ settings: <p>{contents.settings}</p> });

    // B-60 規則7 / ADR-055 決定1: 開いている間は、選んでいるタブと同じ手がかり（太さ・線）で示す。
    // **名前の literal は書かず、前後で比べる。**
    expect(navigationSettings().className).not.toBe(classBefore);
  });

  it('設定が渡されている間に、選んでいたタブを押してもその識別子が口に届く', () => {
    const record = selectedTabRecord();
    renderTabbedScreen({
      selectedTab: 'pantry',
      settings: <p>{contents.settings}</p>,
      onSelectTab: (tab) => {
        record.latest = tab;
      },
    });

    fireEvent.click(tabFor('pantry'));

    // B-60 規則8: 押したのが開く前に選んでいたタブでも、門が設定を閉じられるよう求めは届く。
    expect(record.latest).toBe('pantry');
  });

  it('設定を描いている間も、帯は中身より後ろに置く', () => {
    renderTabbedScreen({ settings: <p>{contents.settings}</p> });

    // B-60 規則5 / NFR-14: 文書順は「中身 → 帯」のまま。
    const settings = screen.getByText(contents.settings);
    const navigation = screen.getByRole('navigation');
    const navigationFollowsSettings =
      (settings.compareDocumentPosition(navigation) & settings.DOCUMENT_POSITION_FOLLOWING) !== 0;

    expect(navigationFollowsSettings).toBe(true);
  });
});
