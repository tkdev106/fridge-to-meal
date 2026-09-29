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
 * **設定への入口**（B-56c）は「`aria-pressed` を持たず、`listitem` の中にも無い `button`」で
 * 引く（名札は仮なので見ない。B-56c 設計 10章 前提4）。
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
    settings: overrides.settings ?? null,
  };
}

function renderTab(meals: HistoryTabState, overrides: Partial<HistoryTabProps> = {}) {
  return render(<HistoryTab {...propsOf(meals, overrides)} />);
}

/** 列の切り替え。**`aria-pressed` を持つ操作だけ**を引く（行の開く操作は持たない）。 */
function columnToggles(): readonly HTMLElement[] {
  return screen.queryAllByRole('button').filter((button) => button.hasAttribute('aria-pressed'));
}

/** `aria-pressed` を持たない操作（行の開く操作など）。 */
function otherButtons(): readonly HTMLElement[] {
  return screen.queryAllByRole('button').filter((button) => !button.hasAttribute('aria-pressed'));
}

/**
 * 設定への入口の候補。**`aria-pressed` を持たず（列の切り替えではない）、`listitem` の中にも
 * 無い（行の開く操作ではない）** `button` である（B-56c 規則4）。
 */
function settingsEntries(): readonly HTMLElement[] {
  return screen
    .queryAllByRole('button')
    .filter((button) => !button.hasAttribute('aria-pressed') && button.closest('li') === null);
}

/** 設定への入口。**先に1つだけであることを確かめる。** */
function settingsEntry(): HTMLElement {
  const entries = settingsEntries();
  expect(entries).toHaveLength(1);

  const [entry] = entries;
  if (entry === undefined) throw new Error('設定への入口が無い');

  return entry;
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

  it('取れなかった回に置く操作は設定への入口1つだけで、取り直す操作を置かない', () => {
    // B-54b 規則7: 再試行の手段を置かず、自動でも取り直さない。
    // B-56c 規則2 / 設計 7章 行2: ただし設定への入口は出す — 取れなかった回にログアウトへ
    // 届かなくなってはならない。置く1つがその入口であることを、押して届く求めで観る。
    const openedSettings: string[] = [];
    renderTab({ outcome: 'failed' }, { onOpenSettings: () => openedSettings.push('settings') });

    const buttons = otherButtons();
    expect(buttons).toHaveLength(1);

    const [entry] = buttons;
    if (entry === undefined) throw new Error('操作が無い');
    fireEvent.click(entry);

    expect(openedSettings).toHaveLength(1);
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

  // --- 設定への入口と設定の口（B-56c 規則1〜5・8） ---

  it('行が出ている回に、設定への入口を1つ置く', () => {
    // B-56c 規則2 / `docs/screen-design.md` 2.1・7章: 入口は履歴タブの右上にある。
    renderTab(bothColumns);

    expect(settingsEntries()).toHaveLength(1);
  });

  it('読み込み中にも、設定への入口を置く', () => {
    // B-56c 規則2: 一覧を出す3つの状態すべてで出す。
    renderTab({ outcome: 'loading' });

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.hasAttribute('aria-pressed')).toBe(false);
  });

  it('選んでいる列が0件でも、設定への入口を置く', () => {
    // B-56c 規則2: 0件の列を含む。
    renderTab(loaded({ seen: [], cooked: [summaryOf('meal-c', STIR_FRY)] }));

    expect(settingsEntries()).toHaveLength(1);
  });

  it('入口を押すと、設定を開く求めが届く', () => {
    // B-56c 規則1 / `docs/screen-design.md` 2.1: 設定を開いているかは門が持つ。
    const openedSettings: string[] = [];
    renderTab(bothColumns, { onOpenSettings: () => openedSettings.push('settings') });

    fireEvent.click(settingsEntry());

    expect(openedSettings).toHaveLength(1);
  });

  it('入口を押しても、設定が渡されなければ一覧のままである', () => {
    // B-56c 規則1: `HistoryTab` は設定を開いているかをローカルに持たない。
    renderTab(bothColumns, { onOpenSettings: () => {} });

    fireEvent.click(settingsEntry());

    expect(screen.queryByText(NIKUJAGA)).not.toBeNull();
  });

  it('入口は、列の切り替えと行より前にある', () => {
    // B-56c 規則3 / `docs/screen-design.md` 7章: 見出しの行の右端に置く。
    renderTab(bothColumns);

    const entry = settingsEntry();
    const [firstToggle] = columnToggles();
    if (firstToggle === undefined) throw new Error('列の切り替えが無い');

    expect(precedes(entry, firstToggle)).toBe(true);
    expect(precedes(entry, rowAt(0))).toBe(true);
  });

  it('取れなかった回も、入口は案内より前にある', () => {
    // B-56c 規則3 / 設計 7章 行2
    renderTab({ outcome: 'failed' });

    const entry = settingsEntry();
    const [notice] = screen.getAllByRole('status');
    if (notice === undefined) throw new Error('案内が無い');

    expect(precedes(entry, notice)).toBe(true);
  });

  it('入口の名札は記号だけでなく文字を含む', () => {
    // B-56c 規則4 / NFR-16: 記号だけの名札は読み上げに乗らない。文言は仮なので、
    // 文字（`\p{L}`）が1つ以上あることだけを見る。
    renderTab(bothColumns);

    const entry = settingsEntry();

    expect(screen.getAllByRole('button', { name: /\p{L}/u })).toContain(entry);
  });

  it('入口は押された状態を持たない', () => {
    // B-56c 規則4: 列の切り替えと区別する。
    renderTab(bothColumns);

    // 行の外の操作は、列の切り替え2つと入口1つの3つ。押された状態を持つのは切り替えの2つだけ。
    const outsideRows = screen
      .getAllByRole('button')
      .filter((button) => button.closest('li') === null);

    expect(outsideRows).toHaveLength(3);
    expect(outsideRows.filter((button) => button.hasAttribute('aria-pressed'))).toHaveLength(2);
  });

  it('設定が渡されていれば、行の代わりに設定を描く', () => {
    // B-56c 規則5 / 先行 `mealDetail`
    renderTab(bothColumns, { settings: <p>目印の設定</p> });

    expect(screen.queryByText('目印の設定')).not.toBeNull();
    expect(screen.queryByText(NIKUJAGA)).toBeNull();
  });

  it('設定が渡されている間は、列の切り替えも入口も出さない', () => {
    // B-56c 規則5: 入れ替わりであって足し算ではない。
    renderTab(bothColumns, { settings: <p>目印の設定</p> });

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('詳細と設定の両方が渡されていれば、詳細を描く', () => {
    // B-56c 規則5: 描き分けの優先は詳細 → 設定 → 一覧。
    renderTab(bothColumns, { mealDetail: <p>目印の詳細</p>, settings: <p>目印の設定</p> });

    expect(screen.queryByText('目印の詳細')).not.toBeNull();
    expect(screen.queryByText('目印の設定')).toBeNull();
  });

  it('設定を閉じて一覧に戻っても、選んでいた列のままである', () => {
    // B-56c 規則8 / B-54b 規則6: 設定を出している間も `HistoryTab` は mount されたまま。
    const { rerender } = renderTab(bothColumns);
    fireEvent.click(unpressedToggle());

    rerender(<HistoryTab {...propsOf(bothColumns, { settings: <p>目印の設定</p> })} />);
    rerender(<HistoryTab {...propsOf(bothColumns)} />);

    expect(screen.queryByText(STIR_FRY)).not.toBeNull();
    expect(screen.queryByText(NIKUJAGA)).toBeNull();
  });
});
