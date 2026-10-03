// @vitest-environment jsdom
/**
 * 履歴タブの**表示の分岐**（B-54b 2周目 / `docs/testing.md` 4.1 / ADR-052。先行
 * `MealsTab.test.tsx`）。
 *
 * **暫定の文言を期待値に書かない**（`docs/screen-design.md` 論点3）。読み込み中・取れなかった・0件の
 * 案内はデザインに無い暫定の文言なので字面を見ない。切り替えの名前と `材料N件` は `docs/design/` から
 * 取った文言で仮ではない（ADR-074 決定1）ので、末尾の節（B-67）で字面を確かめる。日の見出しの
 * `2026年10月3日` と ▼ は ADR-083 決定3・4 が定めた形で仮ではないので、名前で引く（B-74 設計 規則8・10）。
 * 観察は次の4つで行う。
 *
 * - **役割** … 行は `listitem`、案内は `status`、列の切り替えは `aria-pressed` を持つ `button`、
 *   日の見出しは `aria-expanded` で開閉を、`aria-controls` でその日の行の一覧を指す `button`
 *   （B-74 設計 規則10。畳んだ日の行は役割で引けなくなることで「見えない」を観る — 規則11）
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
import type {
  CookedMealSummaryOutput,
  ListMealsOutput,
  SeenMealSummaryOutput,
} from '@fridge-to-meal/contract';
import { fireEvent, render, screen, within } from '../../support/dom/renderComponent.js';
import { HistoryTab } from '../../../src/features/meal/HistoryTab.js';
import type { HistoryTabProps, HistoryTabState } from '../../../src/features/meal/HistoryTab.js';

const NIKUJAGA = '肉じゃが';
const GINGER_PORK = '豚こま肉と白菜の生姜焼き';
const STIR_FRY = 'にんじんと卵の炒めもの';
const MISO_SOUP = '大根の味噌汁';

/** 端末の時刻で組んだ日時を UTC の ISO 8601 にする（サーバが届ける形。ADR-083 決定2）。 */
function localDateTime(year: number, monthIndex: number, day: number, hour: number): string {
  return new Date(year, monthIndex, day, hour, 0).toISOString();
}

/** 日の見出しが本題でないケースの日時。**同じ日に置く** — 行が1つの一覧に並ぶ。 */
const DEFAULT_SEEN_AT = localDateTime(2026, 9, 3, 8);
const DEFAULT_COOKED_AT = localDateTime(2026, 9, 3, 19);

function seenOf(
  mealId: string,
  title: string,
  overrides: { ingredientCount?: number; generatedAt?: string } = {},
): SeenMealSummaryOutput {
  return {
    mealId,
    title,
    ingredientCount: overrides.ingredientCount ?? 2,
    generatedAt: overrides.generatedAt ?? DEFAULT_SEEN_AT,
  };
}

function cookedOf(
  mealId: string,
  title: string,
  overrides: { cookedAt?: string } = {},
): CookedMealSummaryOutput {
  return { mealId, title, ingredientCount: 2, cookedAt: overrides.cookedAt ?? DEFAULT_COOKED_AT };
}

function loaded(meals: ListMealsOutput): HistoryTabState {
  return { outcome: 'loaded', meals };
}

/** 以前見た献立 A と、作った献立 C を1件ずつ持つ履歴（ADR-068 決定3）。 */
const bothColumns = loaded({
  seen: [seenOf('meal-a', NIKUJAGA)],
  cooked: [cookedOf('meal-c', STIR_FRY)],
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

  it('開いた直後は、作った献立の行を出さない', () => {
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

  it('作った側に切り替えると、作った献立の行を出す', () => {
    // B-54b 規則5 / FR-29
    renderTab(bothColumns);

    fireEvent.click(unpressedToggle());

    expect(screen.queryByText(STIR_FRY)).not.toBeNull();
  });

  it('作った側に切り替えると、以前見た献立の行は消える', () => {
    // B-54b 規則3: 1つの献立を両列に出さない。同時に見せるのは1列だけである。
    renderTab(bothColumns);

    fireEvent.click(unpressedToggle());

    expect(screen.queryByText(NIKUJAGA)).toBeNull();
  });

  it('切り替えると、押された状態が作った側へ移る', () => {
    // B-54b 規則5 / NFR-17
    renderTab(bothColumns);
    const [seenToggle] = screen.getAllByRole('button', { pressed: true });
    const cookedToggle = unpressedToggle();

    fireEvent.click(cookedToggle);

    expect(cookedToggle.getAttribute('aria-pressed')).toBe('true');
    expect(seenToggle?.getAttribute('aria-pressed')).toBe('false');
  });

  it('行を渡された順のまま出し、並べ替えない', () => {
    // B-54b 規則3 / B-74 設計 規則9 / ADR-083 決定1: 並びを決めるのはサーバである。
    // 3件とも同じ日に置く（既定の生成日時）— 1つの見出しの下に並ぶ。
    renderTab(
      loaded({
        seen: [
          seenOf('meal-b', GINGER_PORK),
          seenOf('meal-a', NIKUJAGA),
          seenOf('meal-d', MISO_SOUP),
        ],
        cooked: [],
      }),
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(within(rowAt(0)).queryByText(GINGER_PORK)).not.toBeNull();
    expect(within(rowAt(1)).queryByText(NIKUJAGA)).not.toBeNull();
    expect(within(rowAt(2)).queryByText(MISO_SOUP)).not.toBeNull();
  });

  it('同じ名称の献立が2件あっても、1行にまとめずに2行出す', () => {
    // B-54b 規則3: 名称が同じでも別の献立である。
    renderTab(
      loaded({
        seen: [seenOf('meal-a', NIKUJAGA), seenOf('meal-b', NIKUJAGA)],
        cooked: [],
      }),
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('行に、献立の名称と主材料の件数を出す', () => {
    // B-54b 規則4 / ADR-083 決定2: 1行に出すのは名称と主材料の件数だけ（日付は見出しにだけ出す）。
    // ここでは数字が読めることだけを見る。字面（「材料N件」）は末尾の節（B-67）が見る。
    renderTab(loaded({ seen: [seenOf('meal-a', NIKUJAGA, { ingredientCount: 7 })], cooked: [] }));

    const row = rowAt(0);
    expect(within(row).queryByText(NIKUJAGA)).not.toBeNull();
    expect(row.textContent).toContain('7');
  });

  it('行1つごとに、詳細を開く操作を1つ置く', () => {
    // B-54b 規則8
    renderTab(
      loaded({
        seen: [seenOf('meal-a', NIKUJAGA), seenOf('meal-b', GINGER_PORK)],
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
        seen: [seenOf('m1', NIKUJAGA), seenOf('m2', GINGER_PORK)],
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
    renderTab(loaded({ seen: [], cooked: [cookedOf('meal-c', STIR_FRY)] }));

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('0件の案内は、取れなかった回の案内とは違う', () => {
    // B-54b 規則7: 0件は失敗ではない。
    const { unmount } = renderTab(loaded({ seen: [], cooked: [cookedOf('meal-c', STIR_FRY)] }));
    const emptyNotice = soleNoticeText();
    unmount();

    renderTab({ outcome: 'failed' });
    const failureNotice = soleNoticeText();

    expect(emptyNotice).not.toBe(failureNotice);
  });

  it('以前見た列が0件でも、作った側に切り替えれば行が出る', () => {
    // B-54b 規則5・7: 片方だけ0件の境界。
    renderTab(loaded({ seen: [], cooked: [cookedOf('meal-c', STIR_FRY)] }));

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

  it('行・列の切り替え・日の見出しの外にある操作は、歯車の1つだけである', () => {
    // B-60 規則12・13: 履歴の「⚙ 設定」は撤去し、入口は見出しの歯車1つに畳む。
    // 日の見出し（`aria-expanded` を持つ。B-74 設計 規則10）は日ごとに置かれるので除く。
    renderTab(bothColumns);

    const outsideRowsAndToggles = screen
      .getAllByRole('button')
      .filter(
        (button) =>
          button.closest('li') === null &&
          !button.hasAttribute('aria-pressed') &&
          !button.hasAttribute('aria-expanded'),
      );

    expect(outsideRowsAndToggles).toEqual(headerSettingsButtons());
    expect(outsideRowsAndToggles).toHaveLength(1);
  });

  it('詳細を出している間は、見出しの行を出さない', () => {
    // B-60 規則12 / 2章: 献立詳細に歯車を置かない（原本に無い）。
    renderTab(bothColumns, { mealDetail: <p>目印の詳細</p> });

    expect(headerSettingsButtons()).toHaveLength(0);
    expect(screen.queryAllByRole('heading', { level: 1, name: '履歴' })).toHaveLength(0);
  });

  // --- デザイン 12 の文言と構造（B-67）。切り替えと件数の文言は原本から取ったもので仮ではない
  //     （ADR-074 決定1 / B-67 規則9）ので、字面で引く。 ---

  it('列の切り替えは「以前見た献立」「作った献立」の2つで、この順に並ぶ', () => {
    // B-67 規則4・9 / 原本 12: 左が以前見た、右が作った。
    renderTab(bothColumns);

    expect(columnToggles().map((toggle) => toggle.textContent)).toEqual([
      '以前見た献立',
      '作った献立',
    ]);
  });

  it('開いた直後に押された状態で読めるのは「以前見た献立」の切り替えである', () => {
    // B-67 規則4 / B-54b 規則5 / NFR-17: 選んでいるかは `aria-pressed` で読める。
    renderTab(bothColumns);

    expect(pressedToggle()).toBe(screen.getByRole('button', { name: '以前見た献立' }));
  });

  it('行の主材料の件数を「材料N件」と出す', () => {
    // B-67 規則6・9 / ADR-083 決定2: 件数の文言は原本 12 の字面。
    renderTab(loaded({ seen: [seenOf('meal-a', NIKUJAGA, { ingredientCount: 7 })], cooked: [] }));

    expect(within(rowAt(0)).queryByText('材料7件')).not.toBeNull();
  });

  it('行はひとつの一覧の項目として読める', () => {
    // B-67 規則8: `list-style: none` にしても一覧の役割を保つ（先行 `MealsTab` の `.cards`）。
    // 2件とも同じ日に置く（既定の生成日時）— 一覧は日ごとに1つである（B-74 設計 規則10）。
    renderTab(
      loaded({
        seen: [seenOf('meal-a', NIKUJAGA), seenOf('meal-b', GINGER_PORK)],
        cooked: [],
      }),
    );

    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(1);
    const [list] = lists;
    if (list === undefined) throw new Error('一覧が無い');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });
});

/**
 * 日ごとの見出しと開閉（B-74 設計 6章 規則10〜14・16 / ADR-083 決定3・4）。
 *
 * 見出しは `aria-expanded` を持つ `button` で、名前は日付だけである（▼ は読み上げに出さない）。
 * 畳んだ日の行は役割で引けなくなること（`hidden` の一覧の項目は `listitem` として現れない）で
 * 「見えない」を観る。`aria-controls` の先は `id` で引く — 見出しと一覧を結ぶ関係そのものである。
 */
describe('履歴タブ HistoryTab の日ごとの見出し', () => {
  const OCT_3 = '2026年10月3日';
  const OCT_1 = '2026年10月1日';
  const OCT_4 = '2026年10月4日';

  /** 以前見た列は 10月3日に2件・10月1日に1件、作った列は 10月3日に1件（サーバの降順で届く）。 */
  const twoDays = loaded({
    seen: [
      seenOf('meal-b', GINGER_PORK, { generatedAt: localDateTime(2026, 9, 3, 19) }),
      seenOf('meal-a', NIKUJAGA, { generatedAt: localDateTime(2026, 9, 3, 8) }),
      seenOf('meal-d', MISO_SOUP, { generatedAt: localDateTime(2026, 9, 1, 12) }),
    ],
    cooked: [cookedOf('meal-c', STIR_FRY, { cookedAt: localDateTime(2026, 9, 3, 20) })],
  });

  /** 取り直しで 10月4日の献立が1件増えた履歴。10月3日・10月1日はそのまま。 */
  const refetchedWithNewDay = loaded({
    seen: [
      seenOf('meal-n', '新しいご飯', { generatedAt: localDateTime(2026, 9, 4, 9) }),
      seenOf('meal-b', GINGER_PORK, { generatedAt: localDateTime(2026, 9, 3, 19) }),
      seenOf('meal-a', NIKUJAGA, { generatedAt: localDateTime(2026, 9, 3, 8) }),
      seenOf('meal-d', MISO_SOUP, { generatedAt: localDateTime(2026, 9, 1, 12) }),
    ],
    cooked: [cookedOf('meal-c', STIR_FRY, { cookedAt: localDateTime(2026, 9, 3, 20) })],
  });

  /** 日の見出し（`aria-expanded` を持つ操作）を文書順に。 */
  function dayHeaders(): readonly HTMLElement[] {
    return screen.queryAllByRole('button').filter((button) => button.hasAttribute('aria-expanded'));
  }

  /** 日付を名前に持つ見出し。 */
  function dayHeader(label: string): HTMLElement {
    return screen.getByRole('button', { name: label });
  }

  function expandedOf(header: HTMLElement): string | null {
    return header.getAttribute('aria-expanded');
  }

  /** 見出しの `aria-controls` が指す要素。 */
  function controlledBy(header: HTMLElement): HTMLElement | null {
    const id = header.getAttribute('aria-controls');
    if (id === null) throw new Error('aria-controls が無い');

    return document.getElementById(id);
  }

  /** 見えている（役割で引ける）行に、その名称の行があるか。 */
  function isRowShown(title: string): boolean {
    return screen
      .queryAllByRole('listitem')
      .some((item) => within(item).queryByText(title) !== null);
  }

  it('日ごとに、日付を名前に持つ見出しの操作を届いた順に置く', () => {
    // B-74 規則9・10 / ADR-083 決定3・4
    renderTab(twoDays);

    expect(dayHeaders()).toHaveLength(2);
    expect(dayHeaders()[0]).toBe(dayHeader(OCT_3));
    expect(dayHeaders()[1]).toBe(dayHeader(OCT_1));
  });

  it('見出しは ▼ を持つが、読み上げの名前は日付だけである', () => {
    // B-74 規則10 / NFR-17: ▼ は飾りで読み上げに出さない。名前の一致は全体の一致で引いている。
    renderTab(twoDays);

    expect(dayHeader(OCT_3).textContent).toContain('▼');
  });

  it('見出しの操作は、日付を名前に持つ2段目の見出しとして辿れる', () => {
    // B-74 設計 10章 前提2: 題が `h1`、日の見出しが `h2`。
    renderTab(twoDays);

    const heading = screen.getByRole('heading', { level: 2, name: OCT_3 });
    expect(within(heading).getByRole('button', { name: OCT_3 })).toBe(dayHeader(OCT_3));
  });

  it('見出しの aria-controls は、その日の行だけを持つ一覧を指す', () => {
    // B-74 規則10 / ADR-083 決定4
    renderTab(twoDays);

    const list = controlledBy(dayHeader(OCT_3));
    if (list === null) throw new Error('指す先が無い');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(list).queryByText(GINGER_PORK)).not.toBeNull();
    expect(within(list).queryByText(NIKUJAGA)).not.toBeNull();
    expect(within(list).queryByText(MISO_SOUP)).toBeNull();
  });

  it('開いた直後は、すべての日の見出しが開いた状態で読める', () => {
    // B-74 規則11 / ADR-083 決定4
    renderTab(twoDays);

    expect(dayHeaders().map(expandedOf)).toEqual(['true', 'true']);
  });

  it('開いた直後は、すべての日の行が出ている', () => {
    // B-74 規則11
    renderTab(twoDays);

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('見出しを押すと、その日の見出しは畳んだ状態で読める', () => {
    // B-74 規則10・11 / NFR-17
    renderTab(twoDays);

    fireEvent.click(dayHeader(OCT_3));

    expect(expandedOf(dayHeader(OCT_3))).toBe('false');
  });

  it('見出しを押すと、その日の行は見えなくなる', () => {
    // B-74 規則11: 畳んだ日の行は見えず操作できない。
    renderTab(twoDays);

    fireEvent.click(dayHeader(OCT_3));

    expect(isRowShown(GINGER_PORK)).toBe(false);
    expect(isRowShown(NIKUJAGA)).toBe(false);
  });

  it('ある日を畳んでも、他の日は開いたままである', () => {
    // B-74 規則11: 畳むのは押した日のまとまりだけ。
    renderTab(twoDays);

    fireEvent.click(dayHeader(OCT_3));

    expect(expandedOf(dayHeader(OCT_1))).toBe('true');
    expect(isRowShown(MISO_SOUP)).toBe(true);
  });

  it('畳んでも、aria-controls の指す一覧は文書に残る', () => {
    // B-74 規則11 / 設計 10章 前提3: 指す先を消さない。
    renderTab(twoDays);

    fireEvent.click(dayHeader(OCT_3));

    expect(controlledBy(dayHeader(OCT_3))).not.toBeNull();
  });

  it('同じ見出しをもう一度押すと、開いてその日の行がまた出る', () => {
    // B-74 規則11
    renderTab(twoDays);

    fireEvent.click(dayHeader(OCT_3));
    fireEvent.click(dayHeader(OCT_3));

    expect(expandedOf(dayHeader(OCT_3))).toBe('true');
    expect(isRowShown(GINGER_PORK)).toBe(true);
  });

  it('以前見た列で畳んだ日は、作った列の同じ日を畳まない', () => {
    // B-74 規則12: 開閉は列ごとに独立して持つ。
    renderTab(twoDays);
    fireEvent.click(dayHeader(OCT_3));

    fireEvent.click(unpressedToggle());

    expect(expandedOf(dayHeader(OCT_3))).toBe('true');
    expect(isRowShown(STIR_FRY)).toBe(true);
  });

  it('列を切り替えて戻っても、畳んだ日は畳んだままである', () => {
    // B-74 規則12
    renderTab(twoDays);
    fireEvent.click(dayHeader(OCT_3));

    fireEvent.click(unpressedToggle());
    fireEvent.click(unpressedToggle());

    expect(expandedOf(dayHeader(OCT_3))).toBe('false');
  });

  it('詳細を開いて閉じても、畳んだ日は畳んだままである', () => {
    // B-74 規則12: 詳細を開いている間も `HistoryTab` は木に残る（B-54b 規則6）。
    const { rerender } = renderTab(twoDays);
    fireEvent.click(dayHeader(OCT_3));

    rerender(<HistoryTab {...propsOf(twoDays, { mealDetail: <p>目印の詳細</p> })} />);
    rerender(<HistoryTab {...propsOf(twoDays)} />);

    expect(expandedOf(dayHeader(OCT_3))).toBe('false');
  });

  it('取り直しで新しい日が届くと、その日は開いている', () => {
    // B-74 規則13 / ADR-083 決定4: 開いた直後はすべて開く。
    const { rerender } = renderTab(twoDays);
    fireEvent.click(dayHeader(OCT_3));

    rerender(<HistoryTab {...propsOf(refetchedWithNewDay)} />);

    expect(expandedOf(dayHeader(OCT_4))).toBe('true');
  });

  it('取り直したあとも、畳んだ日と同じ日付の見出しは畳んだままである', () => {
    // B-74 規則13 / 設計 10章 前提5: 畳んだ日付の集合で持つ。
    const { rerender } = renderTab(twoDays);
    fireEvent.click(dayHeader(OCT_3));

    rerender(<HistoryTab {...propsOf(refetchedWithNewDay)} />);

    expect(expandedOf(dayHeader(OCT_3))).toBe('false');
  });

  it('行には日付を出さない', () => {
    // B-74 規則14: 日付は見出しにだけ出す。
    renderTab(twoDays);

    for (const row of screen.getAllByRole('listitem')) {
      expect(row.textContent).not.toContain('10月');
      expect(row.textContent).not.toContain('2026');
    }
  });

  it('選んでいる列が0件なら、日の見出しを出さない', () => {
    // B-74 規則16 / B-54b 規則7: 0件の案内は変えず、見出しも出さない。
    renderTab(loaded({ seen: [], cooked: [cookedOf('meal-c', STIR_FRY)] }));

    expect(dayHeaders()).toHaveLength(0);
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
  });
});
