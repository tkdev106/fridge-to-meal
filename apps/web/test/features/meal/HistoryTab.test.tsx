// @vitest-environment jsdom
/**
 * 履歴タブの**表示の分岐**（B-54b 2周目 / `docs/testing.md` 4.1 / ADR-052。先行
 * `MealsTab.test.tsx`）。
 *
 * **仮の文言を期待値に書かない**（`docs/screen-design.md` 論点3）。観察は次の4つで行う。
 *
 * - **役割** … 行は `listitem`、案内は `status`、列の切り替えは `aria-pressed` を持つ `button`
 * - **こちらが渡したデータ** … 献立の名称と主材料の件数
 * - **件数** … 行がいくつ出るか
 * - **案内どうしの違い** … 2つの案内の textContent が異なること（文言そのものは見ない）
 *
 * **`vi.fn()` で呼び出しを検めない**（`docs/testing.md` 2章）。行から届いた識別子は、
 * テストが渡した関数が配列に積んだものを観る。
 *
 * **設定への入口は見出しの行の歯車である**（B-60 設計 6章 規則12〜13）。題 `履歴` と歯車の名前
 * `設定` は原本から取った文言で仮ではない（ADR-074 決定1）ので、**名前で引く**。B-56c の
 * 「⚙ 設定」（名札が仮で、役割と置き場で引いていた）は B-60 で見出しの歯車に置き換わった。
 */

import { describe, expect, it } from 'vitest';
import type { ListMealsOutput, MealSummaryOutput } from '@fridge-to-meal/contract';
import { fireEvent, render, screen, within } from '../../support/dom/renderComponent.js';
import { HistoryTab } from '../../../src/features/meal/HistoryTab.js';
import type { HistoryTabProps, HistoryTabState } from '../../../src/features/meal/HistoryTab.js';

const NIKUJAGA = '肉じゃが';
const GINGER_PORK = '豚こま肉と白菜の生姜焼き';
const STIR_FRY = 'にんじんと卵の炒めもの';
const MISO_SOUP = '大根の味噌汁';

function summaryOf(mealId: string, title: string, ingredientCount = 2): MealSummaryOutput {
  return { mealId, title, ingredientCount };
}

function loaded(meals: ListMealsOutput): HistoryTabState {
  return { outcome: 'loaded', meals };
}

/** 以前見た献立 A と、つくった献立 C を1件ずつ持つ履歴（ADR-068 決定3）。 */
const bothColumns = loaded({
  seen: [summaryOf('meal-a', NIKUJAGA)],
  cooked: [summaryOf('meal-c', STIR_FRY)],
});

function propsOf(meals: HistoryTabState, overrides: Partial<HistoryTabProps> = {}) {
  return {
    meals,
    onOpenMeal: overrides.onOpenMeal ?? (() => {}),
    mealDetail: overrides.mealDetail ?? null,
    onOpenSettings: overrides.onOpenSettings ?? (() => {}),
  };
}

function renderTab(meals: HistoryTabState, overrides: Partial<HistoryTabProps> = {}) {
  return render(<HistoryTab {...propsOf(meals, overrides)} />);
}

/** 列の切り替え。**`aria-pressed` を持つ操作だけ**を引く（行の開く操作は持たない）。 */
function columnToggles(): readonly HTMLElement[] {
  return screen.queryAllByRole('button').filter((button) => button.hasAttribute('aria-pressed'));
}

/** `aria-pressed` を持たない操作（行の開く操作と見出しの歯車）。 */
function otherButtons(): readonly HTMLElement[] {
  return screen.queryAllByRole('button').filter((button) => !button.hasAttribute('aria-pressed'));
}

/** 見出しの行の歯車（B-60 規則13）。名前 `設定` で引く。 */
function headerSettingsButtons(): readonly HTMLElement[] {
  return screen.queryAllByRole('button', { name: '設定' });
}

/** `before` が文書順で `after` より前にあるか（jsdom はレイアウトを持たない。B-56c 規則3）。 */
function precedes(before: Node, after: Node): boolean {
  return (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** 押されていない側の切り替え。**先に1つだけであることを確かめる。** */
function unpressedToggle(): HTMLElement {
  const toggles = screen.getAllByRole('button', { pressed: false });
  expect(toggles).toHaveLength(1);

  const [toggle] = toggles;
  if (toggle === undefined) throw new Error('押されていない切り替えが無い');

  return toggle;
}

/** 押されている側の切り替え。**先に1つだけであることを確かめる。** */
function pressedToggle(): HTMLElement {
  const toggles = screen.getAllByRole('button', { pressed: true });
  expect(toggles).toHaveLength(1);

  const [toggle] = toggles;
  if (toggle === undefined) throw new Error('押されている切り替えが無い');

  return toggle;
}

function rowAt(index: number): HTMLElement {
  const row = screen.getAllByRole('listitem')[index];
  if (row === undefined) throw new Error(`${index} 番目の行が無い`);

  return row;
}

/** 案内1つぶんの textContent。**先に1つだけであることを確かめる。** */
function soleNoticeText(): string | null {
  const notices = screen.getAllByRole('status');
  expect(notices).toHaveLength(1);

  return notices[0]?.textContent ?? null;
}

describe('履歴タブ HistoryTab', () => {
  it('開いた直後は、以前見た献立の行を出す', () => {
    // B-54b 規則5 / FR-28: 開いた直後は「以前見た献立」（画面設計 7章 ワイヤーの左）。
    renderTab(bothColumns);

    expect(screen.queryByText(NIKUJAGA)).not.toBeNull();
  });

  it('開いた直後は、つくった献立の行を出さない', () => {
    // B-54b 規則3・5: 同時に見せるのは1列だけである。
    renderTab(bothColumns);

    expect(screen.queryByText(STIR_FRY)).toBeNull();
  });

  it('開いた直後は、以前見た側の切り替えだけが押された状態で読める', () => {
    // B-54b 規則5 / NFR-17: 選んでいる側は文字だけでなく `aria-pressed` で読める。
    renderTab(bothColumns);

    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(1);

    // 押された側が「以前見た」であること — 押しても以前見た献立が出たままである。
    fireEvent.click(pressedToggle());
    expect(screen.queryByText(NIKUJAGA)).not.toBeNull();
  });

  it('つくった側に切り替えると、つくった献立の行を出す', () => {
    // B-54b 規則5 / FR-29
    renderTab(bothColumns);

    fireEvent.click(unpressedToggle());

    expect(screen.queryByText(STIR_FRY)).not.toBeNull();
  });

  it('つくった側に切り替えると、以前見た献立の行は消える', () => {
    // B-54b 規則3: 1つの献立を両列に出さない。同時に見せるのは1列だけである。
    renderTab(bothColumns);

    fireEvent.click(unpressedToggle());

    expect(screen.queryByText(NIKUJAGA)).toBeNull();
  });

  it('切り替えると、押された状態がつくった側へ移る', () => {
    // B-54b 規則5 / NFR-17
    renderTab(bothColumns);
    const [seenToggle] = screen.getAllByRole('button', { pressed: true });
    const cookedToggle = unpressedToggle();

    fireEvent.click(cookedToggle);

    expect(cookedToggle.getAttribute('aria-pressed')).toBe('true');
    expect(seenToggle?.getAttribute('aria-pressed')).toBe('false');
  });

  it('行を渡された順のまま出し、並べ替えない', () => {
    // B-54b 規則3 / ADR-068 決定2: 並びを決めるのはサーバである。
    renderTab(
      loaded({
        seen: [
          summaryOf('meal-b', GINGER_PORK),
          summaryOf('meal-a', NIKUJAGA),
          summaryOf('meal-d', MISO_SOUP),
        ],
        cooked: [],
      }),
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(within(rowAt(0)).queryByText(GINGER_PORK)).not.toBeNull();
    expect(within(rowAt(1)).queryByText(NIKUJAGA)).not.toBeNull();
    expect(within(rowAt(2)).queryByText(MISO_SOUP)).not.toBeNull();
  });

  it('同じ名称の献立が2件あっても、畳まずに2行出す', () => {
    // B-54b 規則3: web で畳まない。名称が同じでも別の献立である。
    renderTab(
      loaded({
        seen: [summaryOf('meal-a', NIKUJAGA), summaryOf('meal-b', NIKUJAGA)],
        cooked: [],
      }),
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('行に、献立の名称と主材料の件数を出す', () => {
    // B-54b 規則4 / ADR-068 決定4: 1行に出すのは名称と主材料の件数だけ。
    // 件数の文言（「材料N件」）は仮なので、数字が読めることだけを見る。
    renderTab(loaded({ seen: [summaryOf('meal-a', NIKUJAGA, 7)], cooked: [] }));

    const row = rowAt(0);
    expect(within(row).queryByText(NIKUJAGA)).not.toBeNull();
    expect(row.textContent).toContain('7');
  });

  it('行1つごとに、詳細を開く操作を1つ置く', () => {
    // B-54b 規則8
    renderTab(
      loaded({
        seen: [summaryOf('meal-a', NIKUJAGA), summaryOf('meal-b', GINGER_PORK)],
        cooked: [],
      }),
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).getAllByRole('button')).toHaveLength(1);
    }
  });

  it('行の開く操作を押すと、その行の献立の識別子が届く', () => {
    // B-54b 規則8 / 画面設計 2.3: 開くのは門であり、画面は識別子を渡すだけである。
    const openedMealIds: string[] = [];
    renderTab(
      loaded({
        seen: [summaryOf('m1', NIKUJAGA), summaryOf('m2', GINGER_PORK)],
        cooked: [],
      }),
      { onOpenMeal: (mealId) => openedMealIds.push(mealId) },
    );

    fireEvent.click(within(rowAt(1)).getByRole('button'));

    expect(openedMealIds).toEqual(['m2']);
  });

  it('読み込み中は、行を1つも出さない', () => {
    // B-54b 規則7
    renderTab({ outcome: 'loading' });

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('読み込み中と取れなかった回では、違う案内を出す', () => {
    // B-54b 規則7: それぞれ別の案内を出す。文言は仮なので、違うことだけを見る。
    const { unmount } = renderTab({ outcome: 'loading' });
    const loadingNotice = soleNoticeText();
    unmount();

    renderTab({ outcome: 'failed' });
    const failureNotice = soleNoticeText();

    expect(loadingNotice).not.toBe(failureNotice);
  });

  it('取れなかった回は、行を1つも出さない', () => {
    // B-54b 規則7 / 7章 行1
    renderTab({ outcome: 'failed' });

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('取れなかった回に置く操作は歯車1つだけで、取り直す操作を置かない', () => {
    // B-54b 規則7: 再試行の手段を置かず、自動でも取り直さない。
    // B-60 規則12: ただし見出しの歯車は置く — 取れなかった回にもログアウトへ届かなくなっては
    // ならない（B-56c 規則2 の趣旨）。置く1つがその歯車であることを名前で観る。
    renderTab({ outcome: 'failed' });

    expect(otherButtons()).toEqual(headerSettingsButtons());
    expect(headerSettingsButtons()).toHaveLength(1);
  });

  it('選んでいる列が0件なら、行を出さずに案内を出す', () => {
    // B-54b 規則7
    renderTab(loaded({ seen: [], cooked: [summaryOf('meal-c', STIR_FRY)] }));

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('0件の案内は、取れなかった回の案内とは違う', () => {
    // B-54b 規則7: 0件は失敗ではない。
    const { unmount } = renderTab(loaded({ seen: [], cooked: [summaryOf('meal-c', STIR_FRY)] }));
    const emptyNotice = soleNoticeText();
    unmount();

    renderTab({ outcome: 'failed' });
    const failureNotice = soleNoticeText();

    expect(emptyNotice).not.toBe(failureNotice);
  });

  it('以前見た列が0件でも、つくった側に切り替えれば行が出る', () => {
    // B-54b 規則5・7: 片方だけ0件の境界。
    renderTab(loaded({ seen: [], cooked: [summaryOf('meal-c', STIR_FRY)] }));

    fireEvent.click(unpressedToggle());

    expect(screen.queryByText(STIR_FRY)).not.toBeNull();
  });

  it('詳細が渡されていれば、行の代わりに詳細を描く', () => {
    // B-54b 規則8 / 先行 `MealsTab.mealDetail`
    renderTab(bothColumns, { mealDetail: <p>目印の詳細</p> });

    expect(screen.queryByText('目印の詳細')).not.toBeNull();
    expect(screen.queryByText(NIKUJAGA)).toBeNull();
  });

  it('詳細が渡されている間は、列の切り替えを出さない', () => {
    // B-54b 規則8: 詳細は一覧の代わりに描かれる（検分で決定）。
    renderTab(bothColumns, { mealDetail: <p>目印の詳細</p> });

    expect(columnToggles()).toHaveLength(0);
  });

  it('詳細を閉じて一覧に戻っても、選んでいた列のままである', () => {
    // B-54b 規則6: 列の選択は `HistoryTab` が持ち、詳細の開閉では失われない。
    const { rerender } = renderTab(bothColumns);
    fireEvent.click(unpressedToggle());

    rerender(<HistoryTab {...propsOf(bothColumns, { mealDetail: <p>目印の詳細</p> })} />);
    rerender(<HistoryTab {...propsOf(bothColumns)} />);

    expect(screen.queryByText(STIR_FRY)).not.toBeNull();
    expect(screen.queryByText(NIKUJAGA)).toBeNull();
  });

  // --- 見出しの行（B-60 規則12〜13。B-56c の「⚙ 設定」を置き換えた） ---

  it.each<[string, HistoryTabState]>([
    ['読み込み中', { outcome: 'loading' }],
    ['取れなかった', { outcome: 'failed' }],
    ['取れた', bothColumns],
  ])('詳細を出していない回は、3つの状態のどれでも歯車を置く（%s）', (_label, meals) => {
    // B-60 規則12: 取れなかった回にも置く — どのタブからもログアウトに届く。
    renderTab(meals);

    expect(headerSettingsButtons()).toHaveLength(1);
  });

  it('見出しは「履歴」である', () => {
    // B-60 規則13（原本 `index.dc.html`）。1つの一覧に `h1` は1つ。
    renderTab(bothColumns);

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['履歴']);
  });

  it('歯車を押すと、設定を開く求めが届く', () => {
    // B-60 規則12 / ADR-066: 設定を開いているかは門が持ち、画面は押下を口で渡すだけである。
    const openedSettings: string[] = [];
    renderTab(bothColumns, { onOpenSettings: () => openedSettings.push('settings') });

    fireEvent.click(screen.getByRole('button', { name: '設定' }));

    expect(openedSettings).toEqual(['settings']);
  });

  it('見出しの行は、列の切り替えと行より前にある', () => {
    // B-60 規則12（原本: 見出しは一覧の先頭）。B-56c 規則3「入口は列の切り替えと行より前」の置き換え。
    renderTab(bothColumns);

    const heading = screen.getByRole('heading', { level: 1, name: '履歴' });
    const gear = screen.getByRole('button', { name: '設定' });
    const [firstToggle] = columnToggles();
    if (firstToggle === undefined) throw new Error('列の切り替えが無い');

    for (const headerPart of [heading, gear]) {
      expect(precedes(headerPart, firstToggle)).toBe(true);
      expect(precedes(headerPart, rowAt(0))).toBe(true);
    }
  });

  it('行と列の切り替えの外にある操作は、歯車の1つだけである', () => {
    // B-60 規則12・13: 履歴の「⚙ 設定」は撤去し、入口は見出しの歯車1つに畳む。
    renderTab(bothColumns);

    const outsideRowsAndToggles = screen
      .getAllByRole('button')
      .filter((button) => button.closest('li') === null && !button.hasAttribute('aria-pressed'));

    expect(outsideRowsAndToggles).toEqual(headerSettingsButtons());
    expect(outsideRowsAndToggles).toHaveLength(1);
  });

  it('詳細を出している間は、見出しの行を出さない', () => {
    // B-60 規則12 / 2章: 献立詳細に歯車を置かない（原本に無い）。
    renderTab(bothColumns, { mealDetail: <p>目印の詳細</p> });

    expect(headerSettingsButtons()).toHaveLength(0);
    expect(screen.queryAllByRole('heading', { level: 1, name: '履歴' })).toHaveLength(0);
  });
});
