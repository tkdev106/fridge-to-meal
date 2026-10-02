// @vitest-environment jsdom
/**
 * 献立タブの**表示の分岐**（B-49a / `docs/testing.md` 4章 / ADR-052）。
 *
 * カードの中身の組み立て（件数・使う在庫の並び・印を付けるか）は `MealCards.ts` の
 * 純粋関数のテストが既に押さえている。ここで確かめるのは**受け取った結末のどれを描くか**と、
 * **1枚のカードに何が載るか**だけである。
 *
 * **`docs/design/` から取った文言は期待値に書く** — デザインが決まり（ADR-074）、
 * `docs/screen-design.md` 論点3 は閉じたので仮ではない（見出し・凡例・件数・再利用の札・
 * 注意表示は B-61、「新しい献立を見る」の面・生成中・失敗の帯・S-4 / S-7 は B-62）。
 * **それ以外の文言（デザインに無いもの — 読み込み中・取れなかった回・読み上げにだけ届く文字）は
 * 仮であり、期待値に書かない**（ADR-052 結果2）— 留めると文言を変えただけで赤くなる。
 * その観察は次の3つで行う。
 *
 * - **役割** … カードは `listitem`、再利用の印は `note`、注意表示は `complementary`
 * - **こちらが渡したデータ** … 献立の名称と、賄える材料の名称
 * - **件数** … カードがいくつ出るか
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShowLatestSuggestionOutput, SuggestionEntryOutput } from '@fridge-to-meal/contract';
import { act, fireEvent, render, screen, within } from '../../support/dom/renderComponent.js';
import { MealsTab } from '../../../src/features/meal/MealsTab.js';

const TODAY = '2026-09-20';

/** 生成を求めた時刻（ミリ秒の epoch。B-62）。経過秒数は、これと渡した時計の差から出る。 */
const T = 1_790_000_000_000;

/** 「新しい献立を見る」の面の文言（B-62 / 原本 `RequestBlock`・案内の帯）。 */
const REQUEST_BUTTON_NAME = '新しい献立を見る';
const WAITING_HINT = '時間がかかる場合があります';
const PANTRY_CHANGED_HINT = '冷蔵庫の食材が変わりました';
const THINKING = '考えています…';
const REQUEST_FAILED_BAND = '献立をつくれませんでした。もう一度お試しください';

function entry(overrides: Partial<SuggestionEntryOutput> = {}): SuggestionEntryOutput {
  return {
    mealId: 'meal-1',
    origin: 'generated',
    title: '豚こま肉と白菜の生姜焼き',
    ingredients: [],
    steps: [],
    coverage: { covered: [], missing: [] },
    ...overrides,
  };
}

function suggested(
  ...entries: readonly SuggestionEntryOutput[]
): Extract<ShowLatestSuggestionOutput, { outcome: 'suggested' }> {
  return {
    outcome: 'suggested',
    pantryChanged: false,
    suggestion: {
      id: 'suggestion-1',
      generatedAt: '2026-09-20T09:00:00.000Z',
      entries: [...entries],
    },
  };
}

type RenderTabOverrides = Partial<Omit<Parameters<typeof MealsTab>[0], 'suggestion' | 'today'>>;

/**
 * 「新しい献立を求める」操作まわりの props は**既定値を持たせておく**（B-49b / B-62）。
 * 表示の分岐だけを見る既存の観点が、新しい props を意識せずに済むようにする。
 *
 * **既定は送っていない（`newMealsRequestedAt` が `null`）**。時計の既定は `() => 0` で、
 * 送っていない回は読まれても描くものに効かない。
 */
function tabElement(
  suggestion: Parameters<typeof MealsTab>[0]['suggestion'],
  overrides: RenderTabOverrides = {},
) {
  return (
    <MealsTab
      suggestion={suggestion}
      today={TODAY}
      onRequestNewMeals={overrides.onRequestNewMeals ?? (() => {})}
      newMealsRequestedAt={overrides.newMealsRequestedAt ?? null}
      now={overrides.now ?? (() => 0)}
      newMealsFailed={overrides.newMealsFailed ?? false}
      onGoToPantry={overrides.onGoToPantry ?? (() => {})}
      onOpenMeal={overrides.onOpenMeal ?? (() => {})}
      mealDetail={overrides.mealDetail ?? null}
      offline={overrides.offline ?? false}
    />
  );
}

function renderTab(
  suggestion: Parameters<typeof MealsTab>[0]['suggestion'],
  overrides: RenderTabOverrides = {},
) {
  return render(tabElement(suggestion, overrides));
}

/** 並びを位置で見るための取り出し。件数は呼ぶ側が先に確かめている。 */
function cardAt(cards: readonly HTMLElement[], index: number): HTMLElement {
  const card = cards[index];
  if (card === undefined) throw new Error(`${index} 番目のカードが無い`);

  return card;
}

/**
 * 「新しい献立を求める」操作。**末尾の1つである**（B-49b / D-4）— カードの中にも
 * 詳細を開く操作が1つずつ在るので（B-53）、`getByRole('button')` では引けない。
 * **名札は見ない**（仮の文言である）。
 */
function requestControl(): HTMLButtonElement {
  const buttons = screen.getAllByRole('button');
  const control = buttons[buttons.length - 1];
  if (control === undefined) throw new Error('操作が1つも無い');

  return control as HTMLButtonElement;
}

describe('献立タブ MealsTab', () => {
  it('提案の1件ごとにカードを1枚、渡された順に描く', () => {
    // 件数が1〜3件で変わることを隠さず、空きを埋めない（D-1 / FR-16）。
    renderTab(
      suggested(
        entry({ mealId: 'meal-1', title: '豚こま肉と白菜の生姜焼き' }),
        entry({ mealId: 'meal-2', title: 'にんじんと卵の炒めもの' }),
      ),
    );

    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cardAt(cards, 0)).queryByText('豚こま肉と白菜の生姜焼き')).not.toBeNull();
    expect(within(cardAt(cards, 1)).queryByText('にんじんと卵の炒めもの')).not.toBeNull();
  });

  it('カードに、使う在庫の名称を出す', () => {
    // FR-18 の結果を見せる欄である（D-4）。並べ替えそのものは `MealCards.ts` の持ち分。
    renderTab(
      suggested(
        entry({
          coverage: {
            covered: [
              { name: '豚こま肉', kind: 'main', amount: '300g', expiryDate: TODAY },
              { name: '白菜', kind: 'main', amount: null, expiryDate: null },
            ],
            missing: [],
          },
        }),
      ),
    );

    const card = cardAt(screen.getAllByRole('listitem'), 0);
    expect(within(card).queryByText('豚こま肉')).not.toBeNull();
    expect(within(card).queryByText('白菜')).not.toBeNull();
  });

  it('カードに材料を全部は並べない', () => {
    // 縦に伸びると3件を見比べられなくなる（D-4）。**不足する材料の名称はカードに出さず、
    // 件数だけを出す** — 内訳は献立詳細（B-53）の持ち分である。
    renderTab(
      suggested(
        entry({
          coverage: {
            covered: [{ name: '豚こま肉', kind: 'main', amount: null, expiryDate: null }],
            missing: [{ name: 'しょうが', kind: 'main', amount: '1かけ' }],
          },
        }),
      ),
    );

    const card = cardAt(screen.getAllByRole('listitem'), 0);
    expect(within(card).queryByText('しょうが')).toBeNull();
  });

  it('再利用のカードにだけ印を置く', () => {
    // 両方に付けると印が背景になって消える（FR-35 / D-3）。印の文言は別のケースが見る
    // （B-61 規則8。デザインから取った文言である）。ここで見るのは置くカードだけである。
    renderTab(
      suggested(
        entry({ mealId: 'meal-1', origin: 'reused', title: '生姜焼き' }),
        entry({ mealId: 'meal-2', origin: 'generated', title: '炒めもの' }),
      ),
    );

    const cards = screen.getAllByRole('listitem');
    expect(within(cardAt(cards, 0)).queryAllByRole('note')).toHaveLength(1);
    expect(within(cardAt(cards, 1)).queryAllByRole('note')).toHaveLength(0);
  });

  it('注意表示を、カードの数によらず画面に1つだけ出す', () => {
    // カードごとに出すと読まれなくなる（FR-20 / D-5。一覧では末尾に1回）。
    renderTab(suggested(entry({ mealId: 'meal-1' }), entry({ mealId: 'meal-2' })));

    expect(screen.getAllByRole('complementary')).toHaveLength(1);
  });

  it('読み込み中は献立を1件も出さない', () => {
    renderTab({ outcome: 'loading' });

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('取れなかったときも献立を1件も出さない', () => {
    renderTab({ outcome: 'failed' });

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('提案の1件が0件で届いても、0件の一覧として静かに描かない', () => {
    // **サーバはこの形を返さない**（提案は1件以上の献立を持つ。C-15）。届いたら継ぎ目か
    // サーバの不具合なので、注意表示だけが残る形にしない。
    renderTab(suggested());

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryAllByRole('complementary')).toHaveLength(0);
  });

  it('まだ提案が無い回は、献立も注意表示も出さない', () => {
    // S-8。**失敗ではない**が、提案として描くものが1つも無い。「新しい献立を求める」
    // 操作を置くのは B-49b の持ち分である。
    renderTab({ outcome: 'none' });

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryAllByRole('complementary')).toHaveLength(0);
  });

  it('在庫が変わっていても、出すのは保存済みの提案のままである', () => {
    // ADR-065 決定4・結果2: `pantryChanged` は手がかりであって、献立の出し分けではない。
    // **見せ方を決めるのは後の周**なので、ここでは描くものが変わらないことだけを確かめる。
    renderTab({
      ...suggested(entry({ title: '肉じゃが' })),
      outcome: 'suggested',
      pantryChanged: true,
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('肉じゃが')).not.toBeNull();
  });
});

/**
 * 「新しい献立を求める」操作（B-49b / FR-36 / NFR-04 / S-5 / S-6 / ADR-065 決定4）。
 *
 * 役割の割り当ては検分で決めた（設計8章の一部として `/tdd` が引き継いだもの）。
 * - 待ち時間の案内（NFR-04）… `role="note"`。**待機中だけ出す**（B-62 規則1。生成中は出さない）
 * - `pantryChanged` の手がかり（規則9）… これも `role="note"`。真で、生成中でないときだけ出る
 * - 送信中の案内（S-5）と失敗の案内（S-6）… どちらも `role="status"`。同時には出ない
 *
 * 文言は原本 `RequestBlock` / 案内の帯から取ったもので、期待値に書いてよい（B-62 / ADR-074）。
 */
describe('献立タブ MealsTab の「新しい献立を求める」操作', () => {
  it('提案が出ている回、末尾に「新しい献立を求める」操作を1つ出す', () => {
    // **カード1枚ごとに詳細を開く操作が1つ在る**（B-53）ので、カード1枚の回は2つである。
    renderTab(suggested(entry()));

    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('まだ提案が無い回にも、操作を出す', () => {
    renderTab({ outcome: 'none' });

    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('取れなかった回にも、操作を出す', () => {
    renderTab({ outcome: 'failed' });

    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('読み込み中は操作を出さない', () => {
    renderTab({ outcome: 'loading' });

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('送信中は操作が押せない', () => {
    renderTab(suggested(entry()), { newMealsRequestedAt: T, now: () => T });

    // `@testing-library/jest-dom` は入れない（依存の追加は止まる条件。`CLAUDE.md`）ので、
    // 素の `disabled` プロパティで見る。
    expect(requestControl().disabled).toBe(true);
  });

  it('送信中でも、渡された提案のカードはそのまま描かれ続ける', () => {
    renderTab(suggested(entry({ title: '肉じゃが' })), { newMealsRequestedAt: T, now: () => T });

    expect(screen.queryByText('肉じゃが')).not.toBeNull();
  });

  it('失敗の直後も、渡された提案のカードはそのまま描かれ続ける', () => {
    renderTab(suggested(entry({ title: '肉じゃが' })), { newMealsFailed: true });

    expect(screen.queryByText('肉じゃが')).not.toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('失敗した回は案内の帯「献立をつくれませんでした。もう一度お試しください」を status として出す', () => {
    // 規則9 / S-6 / NFR-07: 文言は原本の「案内の帯」。添える `!` は別のケースが見る。
    renderTab({ outcome: 'none' }, { newMealsFailed: true });

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toContain(REQUEST_FAILED_BAND);
  });

  it('失敗していないときは、失敗の案内を出さない', () => {
    renderTab({ outcome: 'none' }, { newMealsFailed: false });

    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('送信中は、失敗ではなく送信中の案内を出す', () => {
    // 規則6・9: status は「送信中か失敗のどちらか1つ」。両方が真でも送信中を先に見る。
    renderTab({ outcome: 'none' }, { newMealsRequestedAt: T, now: () => T, newMealsFailed: true });

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toBe('考えています…');
  });

  it('操作を押すと、渡された口が呼ばれる', () => {
    // **回数は数えない**（検分の指示）。実行されたことだけを観る。
    let called = false;
    renderTab(suggested(entry()), {
      onRequestNewMeals: () => {
        called = true;
      },
    });

    fireEvent.click(requestControl());

    expect(called).toBe(true);
  });

  it('在庫が変わっている回だけ、「冷蔵庫の食材が変わりました」を手がかりとして出す', () => {
    // 規則2 / D-8: 手がかりは `note`。カードの中の再利用の印も `note` であるため、
    // 混ざらないよう `origin: 'generated'` にする（検分の指示）。
    const unchanged = suggested(entry({ origin: 'generated' }));

    const unchangedRendered = renderTab(unchanged);
    const unchangedHints = screen
      .queryAllByRole('note')
      .filter((note) => note.textContent === PANTRY_CHANGED_HINT);
    unchangedRendered.unmount();

    renderTab({ ...unchanged, pantryChanged: true });
    const changedHints = screen
      .getAllByRole('note')
      .filter((note) => note.textContent === PANTRY_CHANGED_HINT);

    expect(unchangedHints).toHaveLength(0);
    expect(changedHints).toHaveLength(1);
  });
});

/**
 * 「新しい献立を見る」の面の待機中・生成中・手がかり・失敗の帯（B-62 設計 6章 規則1〜6・9 /
 * 7章 / NFR-04 / NFR-07 / NFR-17 / S-5 / S-6 / D-6・D-8）。
 *
 * 文言は原本 `RequestBlock` と「案内の帯」から取ったもので、期待値に書く（ADR-074）。
 * **秒数は実時間を待たない** — 時計は書き換えられる値で渡し、1秒ごとの間隔は偽のタイマーで進める
 * （`docs/testing.md` 5章）。
 */
describe('献立タブ MealsTab の「新しい献立を見る」の面', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('待機中は「新しい献立を見る」の操作を出す', () => {
    // 規則1 / FR-36: ボタンの文言は原本 `RequestBlock`。
    renderTab({ outcome: 'none' });

    expect(screen.getByRole('button', { name: REQUEST_BUTTON_NAME })).not.toBeNull();
  });

  it('待機中は「時間がかかる場合があります」を手がかりとして出す', () => {
    // 規則1 / NFR-04 / D-2 の追記: 押す前から待ち時間を伝える。
    renderTab({ outcome: 'none' }, { newMealsRequestedAt: null });

    const notes = screen.getAllByRole('note');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toBe(WAITING_HINT);
  });

  it('生成中は「時間がかかる場合があります」を出さない', () => {
    // 規則1: 生成中は代わりに `考えています…` と経過秒数を出す（原本 pending）。
    renderTab({ outcome: 'none' }, { newMealsRequestedAt: T, now: () => T });

    expect(screen.queryByText(WAITING_HINT)).toBeNull();
  });

  it('生成中は「考えています…」を出す', () => {
    // 規則1 / S-5。
    renderTab({ outcome: 'none' }, { newMealsRequestedAt: T, now: () => T });

    expect(screen.getByText(THINKING)).not.toBeNull();
  });

  it('生成を求めた直後は「0秒」を出す', () => {
    // 規則4: 押した直後は `0秒`。
    renderTab({ outcome: 'none' }, { newMealsRequestedAt: T, now: () => T });

    expect(screen.getByText('0秒')).not.toBeNull();
  });

  it('経過秒数は渡された開始時刻と時計から出す', () => {
    // 規則4・12: 起点は門が持つ開始時刻。本体は時計を自分で読まない。
    renderTab({ outcome: 'none' }, { newMealsRequestedAt: T, now: () => T + 18_500 });

    expect(screen.getByText('18秒')).not.toBeNull();
  });

  it('生成中は1秒たつごとに秒数が進む', () => {
    // 規則5: 送信中だけ 1000ms ごとに時計を読み直して描き直す。
    vi.useFakeTimers();
    let clock = T;
    renderTab({ outcome: 'none' }, { newMealsRequestedAt: T, now: () => clock });

    clock = T + 1_000;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByText('1秒')).not.toBeNull();
  });

  it('描き直すたびに時計を読み直すので、間隔の遅れが秒数に溜まらない', () => {
    // 規則5: 間隔の回数を数えるのではなく、描き直すたびに `now()` を読む。
    vi.useFakeTimers();
    let clock = T;
    renderTab({ outcome: 'none' }, { newMealsRequestedAt: T, now: () => clock });

    clock = T + 5_000;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByText('5秒')).not.toBeNull();
  });

  it('生成が終わると、時間がたっても秒数を出さない', () => {
    // 規則5: 送信が終わったら止める。
    vi.useFakeTimers();
    let clock = T;
    const { rerender } = renderTab(
      { outcome: 'none' },
      { newMealsRequestedAt: T, now: () => clock },
    );

    rerender(tabElement({ outcome: 'none' }, { newMealsRequestedAt: null, now: () => clock }));
    clock = T + 3_000;
    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(screen.queryByText(/秒$/)).toBeNull();
    expect(screen.queryByText(THINKING)).toBeNull();
  });

  it('生成中の status は「考えています…」だけで、秒数を含まない', () => {
    // 規則6 / NFR-04: 秒数を status に入れると毎秒読み上げで割り込む。
    renderTab({ outcome: 'none' }, { newMealsRequestedAt: T, now: () => T + 18_000 });

    expect(screen.getByRole('status').textContent).toBe(THINKING);
  });

  it('経過秒数は読み上げから隠さない', () => {
    // 規則6: status の外に置くが、たどれば読める。
    renderTab({ outcome: 'none' }, { newMealsRequestedAt: T, now: () => T + 18_000 });

    expect(screen.getByText('18秒').closest('[aria-hidden="true"]')).toBeNull();
  });

  it('生成中は在庫が変わっていても「冷蔵庫の食材が変わりました」を出さない', () => {
    // 規則2: 原本 `changed && !pending`。
    renderTab(
      { ...suggested(entry({ origin: 'generated' })), pantryChanged: true },
      { newMealsRequestedAt: T, now: () => T },
    );

    expect(screen.queryByText(PANTRY_CHANGED_HINT)).toBeNull();
  });

  it('失敗の帯に添える ! は読み上げに出さない', () => {
    // 規則9 / NFR-17: 先行 `SignInForm` の記号。ARIA の約束を見る手段がほかに無いため DOM を辿る。
    renderTab({ outcome: 'none' }, { newMealsFailed: true });

    const mark = within(screen.getByRole('status')).getByText('!');
    expect(mark.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('失敗の帯は最後のカードより後ろ、「新しい献立を見る」より前に置く', () => {
    // 規則9 / 10章 前提2: 押したボタンの近く（面の直前）に置く。
    renderTab(suggested(entry({ mealId: 'meal-1' }), entry({ mealId: 'meal-2' })), {
      newMealsFailed: true,
    });

    const lastCard = cardAt(screen.getAllByRole('listitem'), 1);
    const band = screen.getByRole('status');
    const button = screen.getByRole('button', { name: REQUEST_BUTTON_NAME });
    expect(precedes(lastCard, band)).toBe(true);
    expect(precedes(band, button)).toBe(true);
  });

  it('失敗した回も「新しい献立を見る」は押せる', () => {
    // 規則9 / S-6: 再試行は同じボタンで行う。
    renderTab(suggested(entry()), { newMealsFailed: true });

    const button = screen.getByRole('button', { name: REQUEST_BUTTON_NAME }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('取れなかった回の面にも「新しい献立を見る」と「時間がかかる場合があります」を出す', () => {
    // 規則17: `failed` の後ろの面は規則1〜11の見た目。
    renderTab({ outcome: 'failed' });

    expect(screen.getByRole('button', { name: REQUEST_BUTTON_NAME })).not.toBeNull();
    expect(screen.getByText(WAITING_HINT)).not.toBeNull();
  });
});

/**
 * まだ提案が無い・在庫が足りない・上限に達した回の、原本どおりの文言（B-62 設計 6章 規則13〜15 /
 * S-4 / S-7 / S-8 / D-7 / D-9 / 原本 `MealScreen` の state=first / short / limit）。
 */
describe('献立タブ MealsTab の原本どおりの結末', () => {
  it('まだ提案が無い回は、旧文言の断りを出さない', () => {
    // 規則13: S-8 は文言を出さず、面だけを置く。見出しの行（B-60 が要素を足す）には依存しない。
    renderTab({ outcome: 'none' }, { newMealsRequestedAt: null });

    expect(screen.queryByText('まだ献立の提案がありません。')).toBeNull();
    const notes = screen.getAllByRole('note');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toBe(WAITING_HINT);
  });

  it('まだ提案が無い回に押して生成中になると、「考えています…」と「0秒」を出す', () => {
    // 規則13: 同じ位置で規則1・6を満たす。
    renderTab({ outcome: 'none' }, { newMealsRequestedAt: T, now: () => T });

    expect(screen.getByText(THINKING)).not.toBeNull();
    expect(screen.getByText('0秒')).not.toBeNull();
  });

  it('在庫が足りない回は、主文「冷蔵庫にあるものを」「2つ以上登録してください」を案内の中に出す', () => {
    // 規則14 / D-7: 主文は2つの塊。案内（status）は今どおり1つ。
    renderTab({ outcome: 'insufficientStockItems' });

    expect(screen.getAllByRole('status')).toHaveLength(1);
    const status = screen.getByRole('status');
    expect(within(status).getByText('冷蔵庫にあるものを')).not.toBeNull();
    expect(within(status).getByText('2つ以上登録してください')).not.toBeNull();
  });

  it('在庫が足りない回は、補足「献立は冷蔵庫の食材から考えます」を主文と同じ案内の中に出す', () => {
    // 規則14: 主文と補足を合わせて status 1つにする。
    renderTab({ outcome: 'insufficientStockItems' });

    expect(
      within(screen.getByRole('status')).getByText('献立は冷蔵庫の食材から考えます'),
    ).not.toBeNull();
  });

  it('在庫が足りない回の操作の名前は「食材を登録する」である', () => {
    // 規則14 / D-7: 押すと今どおり在庫タブへ送る（別のケースが見る）。
    renderTab({ outcome: 'insufficientStockItems' });

    expect(screen.getByRole('button', { name: '食材を登録する' })).not.toBeNull();
  });

  it('上限に達した回は「今日の新しい献立は以上です」を案内として出す', () => {
    // 規則15 / D-9: 操作は無い。残り回数も解ける時刻も言わない。
    renderTab({ outcome: 'generationLimitReached' });

    expect(screen.getByRole('status').textContent).toBe('今日の新しい献立は以上です');
  });
});

/**
 * 出せない回の見せ方（B-49c / S-4 / S-7 / `docs/screen-design.md` D-7 / ADR-041 / ADR-049）。
 *
 * どちらの結末も **200 で届く**（ADR-062 決定2）ので、失敗として扱わない。役割の割り当ては
 * 検分で決めた — **S-4 / S-7 の案内は `status`**（この2つは利用者が「新しい献立を求める」を
 * 押した結果としてしか届かないため、B-49b の割り当てに揃える）。
 *
 * ここでの観察は操作の有無・件数・押した先の口で行う。原本の文言（B-62）は
 * 「原本どおりの結末」の describe が見る。
 */
describe('献立タブ MealsTab の在庫が足りない回（S-4）', () => {
  it('在庫が足りない回は、在庫タブへ送る操作を1つだけ出す', () => {
    // 規則1・2: 案内と在庫タブへの導線を1つ。**「新しい献立を求める」は出さない** —
    // 押しても呼べない操作を置かない（D-7）。
    renderTab({ outcome: 'insufficientStockItems' });

    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('在庫が足りない回の操作を押すと、在庫タブへ送る口が呼ばれる', () => {
    // **回数は数えない**（`docs/testing.md` 2章）。実行されたことだけを観る。
    let wentToPantry = false;
    renderTab(
      { outcome: 'insufficientStockItems' },
      {
        onGoToPantry: () => {
          wentToPantry = true;
        },
      },
    );

    fireEvent.click(screen.getByRole('button'));

    expect(wentToPantry).toBe(true);
  });

  it('在庫が足りない回は、「新しい献立を求める」を出さない', () => {
    // 規則2: 在庫が足りないまま求めても同じ結末が返る（S-4）。
    let requested = false;
    renderTab(
      { outcome: 'insufficientStockItems' },
      {
        onRequestNewMeals: () => {
          requested = true;
        },
      },
    );

    fireEvent.click(screen.getByRole('button'));

    expect(requested).toBe(false);
  });

  it('在庫が足りない回は、献立を1件も出さない', () => {
    // 規則6: 提案として描くものが無い。
    renderTab({ outcome: 'insufficientStockItems' });

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('在庫が足りない回は、注意表示を出さない', () => {
    // 規則6: 注意表示（FR-20）は提案に添えるものである。
    renderTab({ outcome: 'insufficientStockItems' });

    expect(screen.queryAllByRole('complementary')).toHaveLength(0);
  });

  it('在庫が足りない回は、案内を1つ出す', () => {
    renderTab({ outcome: 'insufficientStockItems' });

    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('在庫が足りない回は、直前の要求が失敗していても案内を増やさない', () => {
    // 規則4: **失敗として扱わない**。S-6 の失敗の案内と同時に出さない（ADR-041）。
    const notFailed = renderTab({ outcome: 'insufficientStockItems' }, { newMealsFailed: false });
    const notFailedCount = screen.getAllByRole('status').length;
    notFailed.unmount();

    renderTab({ outcome: 'insufficientStockItems' }, { newMealsFailed: true });

    expect(screen.getAllByRole('status')).toHaveLength(notFailedCount);
  });
});

describe('献立タブ MealsTab の上限に達した回（S-7）', () => {
  it('上限に達した回は、操作を1つも出さない', () => {
    // 規則3: 案内だけを出す。**在庫タブへは送らない**（在庫は原因ではない）。
    renderTab({ outcome: 'generationLimitReached' });

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('上限に達した回は、案内を1つ出す', () => {
    renderTab({ outcome: 'generationLimitReached' });

    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('上限に達した回は、献立を1件も出さない', () => {
    renderTab({ outcome: 'generationLimitReached' });

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('上限に達した回は、注意表示を出さない', () => {
    renderTab({ outcome: 'generationLimitReached' });

    expect(screen.queryAllByRole('complementary')).toHaveLength(0);
  });

  it('上限に達した回は、直前の要求が失敗していても案内を増やさない', () => {
    // 規則4: **失敗として扱わない**（ADR-041 / ADR-062 決定2）。
    const notFailed = renderTab({ outcome: 'generationLimitReached' }, { newMealsFailed: false });
    const notFailedCount = screen.getAllByRole('status').length;
    notFailed.unmount();

    renderTab({ outcome: 'generationLimitReached' }, { newMealsFailed: true });

    expect(screen.getAllByRole('status')).toHaveLength(notFailedCount);
  });
});

describe('献立タブ MealsTab の出せない回と他の枝の見分け', () => {
  it('上限に達した回は、まだ提案が無い回と違って操作を1つも出さない', () => {
    // 規則5: S-8 に畳まない。畳まれていれば両方に操作が出る。
    const limitReached = renderTab({ outcome: 'generationLimitReached' });
    const limitReachedButtons = screen.queryAllByRole('button').length;
    limitReached.unmount();

    renderTab({ outcome: 'none' });

    expect(limitReachedButtons).toBe(0);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('在庫が足りない回の操作は、まだ提案が無い回の操作とは別の口を呼ぶ', () => {
    // 規則5: S-4 も S-8 に畳まない。**押した先が違うこと**で見分ける。
    let wentToPantry = false;
    let requested = false;
    const record = {
      onGoToPantry: () => {
        wentToPantry = true;
      },
      onRequestNewMeals: () => {
        requested = true;
      },
    };

    const insufficient = renderTab({ outcome: 'insufficientStockItems' }, record);
    fireEvent.click(screen.getByRole('button'));
    const wentToPantryOnInsufficient = wentToPantry;
    const requestedOnInsufficient = requested;
    insufficient.unmount();

    renderTab({ outcome: 'none' }, record);
    fireEvent.click(screen.getByRole('button'));

    expect(wentToPantryOnInsufficient).toBe(true);
    expect(requestedOnInsufficient).toBe(false);
    expect(requested).toBe(true);
  });

  it('提案が出ている回は、在庫タブへ送る操作を出さない', () => {
    // 規則14: 提案ありの見せ方は変えない（B-49b のまま）。
    let wentToPantry = false;
    let requested = false;
    renderTab(suggested(entry()), {
      onGoToPantry: () => {
        wentToPantry = true;
      },
      onRequestNewMeals: () => {
        requested = true;
      },
    });

    // 末尾の1つが「新しい献立を求める」である（カードの中の開く操作が1つ在る。B-53）。
    fireEvent.click(requestControl());

    expect(requested).toBe(true);
    expect(wentToPantry).toBe(false);
  });

  it('取れなかった回は、在庫タブへ送る操作を出さない', () => {
    // 規則14: S-6 の枝も変えない。
    let wentToPantry = false;
    let requested = false;
    renderTab(
      { outcome: 'failed' },
      {
        onGoToPantry: () => {
          wentToPantry = true;
        },
        onRequestNewMeals: () => {
          requested = true;
        },
      },
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button'));

    expect(requested).toBe(true);
    expect(wentToPantry).toBe(false);
  });

  it('読み込み中は、在庫タブへ送る操作も出さない', () => {
    // 規則14: 読み込み中は操作を1つも出さない（B-49b のまま）。
    renderTab({ outcome: 'loading' });

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

/**
 * 献立詳細への導線と、一覧 ⇄ 詳細の入れ替わり（B-53 / 画面設計 2.3・4章）。
 *
 * **開いている献立を持つのは門である**（設計 規則17 / ADR-066 と同じ理由）。器は
 * 渡された詳細を描くか、カードの一覧を描くかだけを決める（先行 `PantryTab`）。
 */
describe('献立タブ MealsTab の献立詳細への導線', () => {
  it('カード1枚ごとに、押せる操作は詳細を開く1つだけで、カードそのものは操作として現れない', () => {
    // B-61 規則10: 押下はカード全体で受けるが、読み上げとキーボードに現れる操作は
    // `作り方を見る` のボタン1つだけ。カードに `role="button"` を付けると焦点の止まり先が
    // 2つになり、入れ子の操作になる。
    renderTab(suggested(entry({ mealId: 'meal-1' }), entry({ mealId: 'meal-2' })));

    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cardAt(cards, 0)).getAllByRole('button')).toHaveLength(1);
    expect(within(cardAt(cards, 1)).getAllByRole('button')).toHaveLength(1);
  });

  it('開く操作を押しても、そのカードの献立の識別子は1回だけ届く', () => {
    // B-61 規則9: 押下はカードで受けてボタンからは泡立ちで届く。ボタンとカードの両方で
    // 呼んで二重にしない — 完全一致で見るので、2回届けば赤になる。
    const opened: string[] = [];
    renderTab(suggested(entry({ mealId: 'meal-1' }), entry({ mealId: 'meal-2' })), {
      onOpenMeal: (mealId) => opened.push(mealId),
    });

    const cards = screen.getAllByRole('listitem');
    fireEvent.click(within(cardAt(cards, 1)).getByRole('button'));

    expect(opened).toEqual(['meal-2']);
  });

  it('詳細が渡されていれば、カードの一覧の代わりに詳細を描く', () => {
    // 入れ替わりである（先行 `PantryTab` の一覧 ⇄ 登録）。並べると、どちらを見ているのかが
    // 読めなくなる。
    renderTab(suggested(entry({ title: '肉じゃが' })), {
      mealDetail: <p>詳細の中身</p>,
    });

    expect(screen.queryByText('肉じゃが')).toBeNull();
    expect(screen.queryByText('詳細の中身')).not.toBeNull();
  });

  it('詳細を出している間は「新しい献立を求める」操作を出さない', () => {
    // 求めた提案に差し替わると、開いている詳細がどの提案のものか読めなくなる。
    renderTab(suggested(entry()), { mealDetail: <p>詳細の中身</p> });

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('詳細を出している間は、一覧の注意表示も出さない', () => {
    // 注意表示は詳細の側が必ず1つ出す（FR-20 / 規則7）。2つ並べない。
    renderTab(suggested(entry()), { mealDetail: <p>詳細の中身</p> });

    expect(screen.queryAllByRole('complementary')).toHaveLength(0);
  });

  it('在庫が足りない回は、詳細が渡されていればそれを描く', () => {
    // S-4 の枝も詳細を出せる — 履歴から開いた献立は、在庫が足りない回にも読める（FR-30）。
    renderTab({ outcome: 'insufficientStockItems' }, { mealDetail: <p>詳細の中身</p> });

    expect(screen.queryByText('詳細の中身')).not.toBeNull();
  });
});

/**
 * カード全体を押せること（B-61 規則9・10 / 画面設計 2.3）。
 *
 * カードのどこを押しても、そのカードの献立で詳細を開く。ただし操作として読み上げ・
 * キーボードに現れるのはカードの中のボタン1つだけで、カードそのものは焦点を取らない。
 */
describe('献立タブ MealsTab のカード全体を押せること', () => {
  it('カードの余白を押すと、そのカードの献立の識別子が1回だけ届く', () => {
    // B-61 規則9: ボタン以外（余白）を押しても開く。
    const opened: string[] = [];
    renderTab(suggested(entry({ mealId: 'meal-1' }), entry({ mealId: 'meal-2' })), {
      onOpenMeal: (mealId) => opened.push(mealId),
    });

    const cards = screen.getAllByRole('listitem');
    fireEvent.click(cardAt(cards, 1));

    expect(opened).toEqual(['meal-2']);
  });

  it('カードの名称を押すと、そのカードの献立の識別子が1回だけ届く', () => {
    // B-61 規則9: 名称を含め、カードのどこを押しても開く。
    const opened: string[] = [];
    renderTab(suggested(entry({ mealId: 'meal-1' }), entry({ mealId: 'meal-2' })), {
      onOpenMeal: (mealId) => opened.push(mealId),
    });

    const cards = screen.getAllByRole('listitem');
    fireEvent.click(within(cardAt(cards, 1)).getByRole('heading', { level: 3 }));

    expect(opened).toEqual(['meal-2']);
  });

  it('カードそのものには焦点が当たらない', () => {
    // B-61 規則10: カードに `tabIndex` を付けない。焦点の止まり先はボタン1つだけ。
    renderTab(suggested(entry({ mealId: 'meal-1' }), entry({ mealId: 'meal-2' })));

    const card = cardAt(screen.getAllByRole('listitem'), 1);
    card.focus();

    expect(document.activeElement).not.toBe(card);
  });
});

/**
 * 一覧の見た目のうち、文言と並びで観察できるもの（B-61 / ADR-074 / `docs/design/`）。
 *
 * ここに書く文言（`今日の献立` / `太字の材料は今日が期限です` / `材料4件・不足なし` /
 * `前に見た献立` / 注意表示）は**デザインから取ったもので、仮ではない**（ADR-074 /
 * `docs/screen-design.md` 論点3）。**読み上げにだけ届く文字はデザインに無い仮の文言なので、
 * 期待値に書かない**（`docs/testing.md` 4.1）— 名称の直後に別の要素が付くかどうかで見る。
 * **見た目の値（太さ・余白・列の数）は見ない**（ADR-055 決定3）。
 */
const HEADING = '今日の献立';
const LEGEND = '太字の材料は今日が期限です';
const CAUTION_TEXT = 'AI による提案です。分量・加熱時間等はご自身でご確認ください';

/**
 * 名称の要素の直後に添えられた、読み上げにだけ届く文字の要素（規則6）。無ければ `null`。
 * 文言は仮なので見ず、**中身が空でない別の要素があること**だけを返す。
 */
function screenReaderAddition(name: HTMLElement): Element | null {
  const next = name.nextElementSibling;
  return next !== null && (next.textContent ?? '') !== '' ? next : null;
}

/** カードの無い6つの結末（見出しは出し、凡例は出さない）。 */
const cardlessStates: readonly [string, Parameters<typeof MealsTab>[0]['suggestion']][] = [
  ['読み込み中', { outcome: 'loading' }],
  ['取れなかった回', { outcome: 'failed' }],
  ['まだ提案が無い回', { outcome: 'none' }],
  ['在庫が足りない回', { outcome: 'insufficientStockItems' }],
  ['上限に達した回', { outcome: 'generationLimitReached' }],
  ['提案の1件が0件で届いた回', suggested()],
];

/** `before` が文書の並びで `after` より前にあるか。 */
function precedes(before: Node, after: Node): boolean {
  return (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('献立タブ MealsTab の見出し', () => {
  it('提案が出ている回、見出し「今日の献立」を水準2で1つ出す', () => {
    // 規則1・2: 画面の見出しは h2 が先行（`SettingsScreen` / `StockItemForm`）。
    renderTab(suggested(entry()));

    expect(screen.getAllByRole('heading', { level: 2, name: HEADING })).toHaveLength(1);
  });

  it.each(cardlessStates)('%sにも、見出し「今日の献立」を1つ出す', (_label, state) => {
    // 規則1: 見出しは結末に依らない（原本 `MealScreen` の header は state に依らない）。
    renderTab(state);

    expect(screen.getAllByRole('heading', { level: 2, name: HEADING })).toHaveLength(1);
  });

  it('詳細を出している間は、見出し「今日の献立」を出さない', () => {
    // 規則1: 詳細が自分の見出しを持つ。
    renderTab(suggested(entry()), { mealDetail: <p>詳細の中身</p> });

    expect(screen.queryAllByRole('heading', { name: HEADING })).toHaveLength(0);
  });

  it('カードの献立の名称を、水準3の見出しで出す', () => {
    // 規則2: 原本 `MealCard` も h3。画面の見出し（h2）の下に入る。
    renderTab(suggested(entry({ title: '豚こま肉と白菜の生姜焼き' })));

    const card = cardAt(screen.getAllByRole('listitem'), 0);
    expect(
      within(card).getAllByRole('heading', { level: 3, name: '豚こま肉と白菜の生姜焼き' }),
    ).toHaveLength(1);
  });
});

describe('献立タブ MealsTab の凡例', () => {
  it('カードがあれば、期限が今日の材料が無くても凡例を1つ出す', () => {
    // 規則3: 原本は `hasCards` だけで出す。期限が今日の材料の有無では出し分けない（D-4 の追記）。
    renderTab(
      suggested(
        entry({
          coverage: {
            covered: [{ name: '白菜', kind: 'main', amount: null, expiryDate: '2026-09-25' }],
            missing: [],
          },
        }),
      ),
    );

    expect(screen.getAllByText(LEGEND)).toHaveLength(1);
  });

  it.each(cardlessStates)('%sは、凡例を出さない', (_label, state) => {
    // 規則3: カードが1枚以上あるときだけ出す。
    renderTab(state);

    expect(screen.queryAllByText(LEGEND)).toHaveLength(0);
  });

  it('凡例は見出しの後、最初のカードより前に置く', () => {
    // 規則3: 見出しの下に1つ（原本 `MealScreen`）。
    renderTab(suggested(entry({ mealId: 'meal-1' }), entry({ mealId: 'meal-2' })));

    const heading = screen.getByRole('heading', { level: 2, name: HEADING });
    const legend = screen.getByText(LEGEND);
    const firstCard = cardAt(screen.getAllByRole('listitem'), 0);
    expect(precedes(heading, legend)).toBe(true);
    expect(precedes(legend, firstCard)).toBe(true);
  });

  it('詳細を出している間は、凡例を出さない', () => {
    // 規則1・3: 一覧と詳細は入れ替わりである（B-53）。
    renderTab(suggested(entry()), { mealDetail: <p>詳細の中身</p> });

    expect(screen.queryAllByText(LEGEND)).toHaveLength(0);
  });
});

describe('献立タブ MealsTab のカードの件数と使う在庫', () => {
  it('不足の無いカードに「材料4件・不足なし」と出す', () => {
    // 規則4 / D-4 / C-16: 区切りは中黒。数えるのは主材料だけ（数え方は `MealCards.ts`）。
    renderTab(
      suggested(
        entry({
          coverage: {
            covered: [
              { name: '豚こま肉', kind: 'main', amount: null, expiryDate: null },
              { name: '白菜', kind: 'main', amount: null, expiryDate: null },
              { name: 'にんじん', kind: 'main', amount: null, expiryDate: null },
              { name: '卵', kind: 'main', amount: null, expiryDate: null },
            ],
            missing: [],
          },
        }),
      ),
    );

    const card = cardAt(screen.getAllByRole('listitem'), 0);
    expect(within(card).queryByText('材料4件・不足なし')).not.toBeNull();
  });

  it('不足のあるカードに「材料3件・不足1件」と出す', () => {
    // 規則4 / D-4。
    renderTab(
      suggested(
        entry({
          coverage: {
            covered: [
              { name: '豚こま肉', kind: 'main', amount: null, expiryDate: null },
              { name: '白菜', kind: 'main', amount: null, expiryDate: null },
            ],
            missing: [{ name: 'しょうが', kind: 'main', amount: '1かけ' }],
          },
        }),
      ),
    );

    const card = cardAt(screen.getAllByRole('listitem'), 0);
    expect(within(card).queryByText('材料3件・不足1件')).not.toBeNull();
  });

  it('使う在庫の欄に「使う:」の見出しを出さない', () => {
    // 規則5 / D-4 の追記: 名称だけを並べる（原本 `MealCard`）。
    renderTab(
      suggested(
        entry({
          coverage: {
            covered: [{ name: '豚こま肉', kind: 'main', amount: null, expiryDate: null }],
            missing: [],
          },
        }),
      ),
    );

    const card = cardAt(screen.getAllByRole('listitem'), 0);
    expect(within(card).queryByText('使う:', { exact: false })).toBeNull();
  });

  it('期限が今日の材料にだけ、読み上げの文字を添える', () => {
    // 規則6 / NFR-17: 太字は色ではないが読み上げに届かない。翌日以降の材料には添えない。
    renderTab(
      suggested(
        entry({
          coverage: {
            covered: [
              { name: '豚こま肉', kind: 'main', amount: null, expiryDate: TODAY },
              { name: '白菜', kind: 'main', amount: null, expiryDate: '2026-09-21' },
            ],
            missing: [],
          },
        }),
      ),
    );

    const card = cardAt(screen.getAllByRole('listitem'), 0);
    expect(screenReaderAddition(within(card).getByText('豚こま肉'))).not.toBeNull();
    expect(screenReaderAddition(within(card).getByText('白菜'))).toBeNull();
  });

  it('読み上げの文字は、期限が今日の材料の名称の直後に、名称とは別の要素として並ぶ', () => {
    // 規則6: 名称の要素の文字は名称だけのまま（完全一致で引ける）。並びは `mealCardsOf` の順（規則14）。
    renderTab(
      suggested(
        entry({
          coverage: {
            covered: [
              { name: '豚こま肉', kind: 'main', amount: null, expiryDate: TODAY },
              { name: '白菜', kind: 'main', amount: null, expiryDate: '2026-09-21' },
            ],
            missing: [],
          },
        }),
      ),
    );

    const card = cardAt(screen.getAllByRole('listitem'), 0);
    const pork = within(card).getByText('豚こま肉');
    const expiringToday = screenReaderAddition(pork);
    const napaCabbage = within(card).getByText('白菜');
    if (expiringToday === null) throw new Error('読み上げの文字が無い');
    expect(pork.contains(expiringToday)).toBe(false);
    expect(precedes(expiringToday, napaCabbage)).toBe(true);
  });

  it('読み上げの文字を、読み上げから隠された要素の中に置かない', () => {
    // 規則6: 見た目には出さないが読み上げには届く。`aria-hidden` で隠すと手当ての意味が無い。
    renderTab(
      suggested(
        entry({
          coverage: {
            covered: [{ name: '豚こま肉', kind: 'main', amount: null, expiryDate: TODAY }],
            missing: [],
          },
        }),
      ),
    );

    const expiringToday = screenReaderAddition(
      within(cardAt(screen.getAllByRole('listitem'), 0)).getByText('豚こま肉'),
    );
    expect(expiringToday).not.toBeNull();
    expect(expiringToday?.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('期限が今日の材料があっても、生成のカードに note を置かない', () => {
    // 規則6: 読み上げの文字に `role="note"` を付けない — 再利用の札の `note` と数が混ざる。
    renderTab(
      suggested(
        entry({
          origin: 'generated',
          coverage: {
            covered: [{ name: '豚こま肉', kind: 'main', amount: null, expiryDate: TODAY }],
            missing: [],
          },
        }),
      ),
    );

    const card = cardAt(screen.getAllByRole('listitem'), 0);
    expect(within(card).queryAllByRole('note')).toHaveLength(0);
  });

  it('使う在庫が3件あっても、一覧の項目はカードの枚数だけである', () => {
    // 規則7: 使う在庫を `ul` / `li` にしない（カードを `listitem` で数える読み手と混ざる）。
    renderTab(
      suggested(
        entry({
          coverage: {
            covered: [
              { name: '豚こま肉', kind: 'main', amount: null, expiryDate: TODAY },
              { name: '白菜', kind: 'main', amount: null, expiryDate: '2026-09-21' },
              { name: 'にんじん', kind: 'main', amount: null, expiryDate: null },
            ],
            missing: [],
          },
        }),
      ),
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('献立タブ MealsTab の再利用の札', () => {
  it('再利用の札の文言は「前に見た献立」である', () => {
    // 規則8 / FR-35 / D-3。
    renderTab(suggested(entry({ origin: 'reused' })));

    const card = cardAt(screen.getAllByRole('listitem'), 0);
    expect(within(card).getByRole('note').textContent).toBe('前に見た献立');
  });

  it('再利用の札は、献立の名称より前に置く', () => {
    // 規則8: 名称の上に出す（原本 `MealCard`）。
    renderTab(suggested(entry({ origin: 'reused', title: '生姜焼き' })));

    const card = cardAt(screen.getAllByRole('listitem'), 0);
    const note = within(card).getByRole('note');
    const title = within(card).getByRole('heading', { level: 3, name: '生姜焼き' });
    expect(precedes(note, title)).toBe(true);
  });
});

describe('献立タブ MealsTab の注意表示', () => {
  it('注意表示の文言を、原本 `AiNotice` のとおりに出す', () => {
    // 規則11 / FR-20 / D-5。
    renderTab(suggested(entry()));

    const notice = screen.getByRole('complementary');
    expect(within(notice).queryByText(CAUTION_TEXT)).not.toBeNull();
  });

  it('注意表示は「新しい献立を求める」操作より後ろに置く', () => {
    // 規則11 / D-5「画面末尾に1回」: カード → 操作の面 → 注意表示の順（原本 `MealScreen`）。
    renderTab(suggested(entry()));

    expect(precedes(requestControl(), screen.getByRole('complementary'))).toBe(true);
  });
});

/**
 * 接続が切れている間（B-70 設計 6章 規則6・7 / 7章 行1 / FR-41）。
 *
 * **止めるのは「新しい献立を求める」だけ**で、カードを開くことも在庫タブへ送ることも止めない
 * （規則6 — 閲覧と遷移は止めない）。理由は門が出す帯が示すので、この画面は案内を足さない。
 */
describe('献立タブ MealsTab の接続が切れている間', () => {
  it('接続が切れている間は、「新しい献立を求める」が押せない', () => {
    renderTab(suggested(entry()), { offline: true });

    // 規則7 / FR-41: 生成は書き込みを伴う操作である。
    expect(requestControl().disabled).toBe(true);
  });

  it('接続が切れていても、カードの開く操作は押せ、その献立の識別子が届く', () => {
    const opened: string[] = [];
    renderTab(suggested(entry({ mealId: 'meal-1' }), entry({ mealId: 'meal-2' })), {
      offline: true,
      onOpenMeal: (mealId) => opened.push(mealId),
    });

    const cards = screen.getAllByRole('listitem');
    fireEvent.click(within(cardAt(cards, 1)).getByRole('button'));

    // 規則6: 詳細を開くのは閲覧である。
    expect(opened).toEqual(['meal-2']);
  });

  it('接続が切れていても、在庫が足りない回の在庫タブへ送る操作は効く', () => {
    const wentToPantry: string[] = [];
    renderTab(
      { outcome: 'insufficientStockItems' },
      { offline: true, onGoToPantry: () => wentToPantry.push('pantry') },
    );

    fireEvent.click(screen.getByRole('button'));

    // 規則6: タブを移すのは遷移である（D-7）。
    expect(wentToPantry).toHaveLength(1);
  });

  it('接続が切れていても、画面に新しい案内を足さない', () => {
    const online = renderTab(suggested(entry()), { offline: false });
    const onlineStatusCount = screen.queryAllByRole('status').length;
    online.unmount();

    renderTab(suggested(entry()), { offline: true });

    // 7章 行1: 理由は門の帯が示すので、二重に案内しない。
    expect(screen.queryAllByRole('status')).toHaveLength(onlineStatusCount);
  });
});
