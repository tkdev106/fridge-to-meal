// @vitest-environment jsdom
/**
 * 献立タブの**表示の分岐**（B-49a / `docs/testing.md` 4章 / ADR-052）。
 *
 * カードの中身の組み立て（件数・使う在庫の並び・印を付けるか）は `MealCards.ts` の
 * 純粋関数のテストが既に押さえている。ここで確かめるのは**受け取った結末のどれを描くか**と、
 * **1枚のカードに何が載るか**だけである。
 *
 * **仮の文言を期待値に書かない**（ADR-052 結果2）。文言は `docs/screen-design.md` 論点3 で
 * 未確定であり、留めると文言を変えただけで赤くなる。観察は次の3つで行う。
 *
 * - **役割** … カードは `listitem`、再利用の印は `note`、注意表示は `complementary`
 * - **こちらが渡したデータ** … 献立の名称と、賄える材料の名称
 * - **件数** … カードがいくつ出るか
 */

import { describe, expect, it } from 'vitest';
import type { ShowLatestSuggestionOutput, SuggestionEntryOutput } from '@fridge-to-meal/contract';
import { fireEvent, render, screen, within } from '../../support/dom/renderComponent.js';
import { MealsTab } from '../../../src/features/meal/MealsTab.js';

const TODAY = '2026-09-20';

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
 * 「新しい献立を求める」操作まわりの3つの props は**既定値を持たせておく**（B-49b）。
 * 表示の分岐だけを見る既存の観点が、新しい props を意識せずに済むようにする。
 */
function renderTab(
  suggestion: Parameters<typeof MealsTab>[0]['suggestion'],
  overrides: RenderTabOverrides = {},
) {
  return render(
    <MealsTab
      suggestion={suggestion}
      today={TODAY}
      onRequestNewMeals={overrides.onRequestNewMeals ?? (() => {})}
      requestingNewMeals={overrides.requestingNewMeals ?? false}
      newMealsFailed={overrides.newMealsFailed ?? false}
      onGoToPantry={overrides.onGoToPantry ?? (() => {})}
    />,
  );
}

/** 並びを位置で見るための取り出し。件数は呼ぶ側が先に確かめている。 */
function cardAt(cards: readonly HTMLElement[], index: number): HTMLElement {
  const card = cards[index];
  if (card === undefined) throw new Error(`${index} 番目のカードが無い`);

  return card;
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
    // 両方に付けると印が背景になって消える（FR-35 / D-3）。**印の文言は見ない** — 仮である。
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
 * - 押す前からの待ち時間の案内（NFR-04）… `role="note"`。送信中かどうかによらず常に出す
 * - `pantryChanged` の手がかり（規則9）… これも `role="note"`。真のときだけ1つ増える
 * - 送信中の案内（S-5）と失敗の案内（S-6）… どちらも `role="status"`。同時には出ない
 *
 * **仮の文言を期待値に固定しない**（ADR-052 結果2）。観察は役割と、渡したデータ（献立の名称）で行う。
 */
describe('献立タブ MealsTab の「新しい献立を求める」操作', () => {
  it('提案が出ている回、末尾に「新しい献立を求める」操作を1つ出す', () => {
    renderTab(suggested(entry()));

    expect(screen.getAllByRole('button')).toHaveLength(1);
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

  it('押す前から待ち時間の案内を出し、送信中も出したままにする', () => {
    // カードなし・pantryChanged なしの結末（'none'）で観る — カードの中の再利用の印も
    // `note` であるため、そちらと混ざらない結末を選ぶ（検分の指示）。
    const before = renderTab({ outcome: 'none' }, { requestingNewMeals: false });
    expect(screen.getAllByRole('note')).toHaveLength(1);
    before.unmount();

    renderTab({ outcome: 'none' }, { requestingNewMeals: true });
    expect(screen.getAllByRole('note')).toHaveLength(1);
  });

  it('送信中は操作が押せない', () => {
    renderTab(suggested(entry()), { requestingNewMeals: true });

    // `@testing-library/jest-dom` は入れない（依存の追加は止まる条件。`CLAUDE.md`）ので、
    // 素の `disabled` プロパティで見る。
    const operation = screen.getByRole('button') as HTMLButtonElement;
    expect(operation.disabled).toBe(true);
  });

  it('送信中でも、渡された提案のカードはそのまま描かれ続ける', () => {
    renderTab(suggested(entry({ title: '肉じゃが' })), { requestingNewMeals: true });

    expect(screen.queryByText('肉じゃが')).not.toBeNull();
  });

  it('失敗の直後も、渡された提案のカードはそのまま描かれ続ける', () => {
    renderTab(suggested(entry({ title: '肉じゃが' })), { newMealsFailed: true });

    expect(screen.queryByText('肉じゃが')).not.toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('失敗したときは、失敗の案内を出す', () => {
    renderTab({ outcome: 'none' }, { newMealsFailed: true });

    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('失敗していないときは、失敗の案内を出さない', () => {
    renderTab({ outcome: 'none' }, { newMealsFailed: false });

    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('送信中は、失敗ではなく送信中の案内を出す', () => {
    renderTab({ outcome: 'none' }, { requestingNewMeals: true, newMealsFailed: false });

    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('操作を押すと、渡された口が呼ばれる', () => {
    // **回数は数えない**（検分の指示）。実行されたことだけを観る。
    let called = false;
    renderTab(suggested(entry()), {
      onRequestNewMeals: () => {
        called = true;
      },
    });

    fireEvent.click(screen.getByRole('button'));

    expect(called).toBe(true);
  });

  it('在庫が変わっている回だけ、操作へ誘う手がかりを1つ増やす', () => {
    // カードの中の再利用の印も `note` であるため、混ざらないよう `origin: 'generated'` にする
    // （検分の指示）。
    const unchanged = suggested(entry({ origin: 'generated' }));

    const unchangedRendered = renderTab(unchanged);
    const unchangedNoteCount = screen.getAllByRole('note').length;
    unchangedRendered.unmount();

    renderTab({ ...unchanged, pantryChanged: true });
    const changedNoteCount = screen.getAllByRole('note').length;

    expect(changedNoteCount).toBe(unchangedNoteCount + 1);
  });
});

/**
 * 出せない回の見せ方（B-49c / S-4 / S-7 / `docs/screen-design.md` D-7 / ADR-041 / ADR-049）。
 *
 * どちらの結末も **200 で届く**（ADR-062 決定2）ので、失敗として扱わない。役割の割り当ては
 * 検分で決めた — **S-4 / S-7 の案内は `status`**（この2つは利用者が「新しい献立を求める」を
 * 押した結果としてしか届かないため、B-49b の割り当てに揃える）。
 *
 * **仮の文言を期待値に書かない**（ADR-052 結果2）。観察は操作の有無・件数・押した先の口で行う。
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

    fireEvent.click(screen.getByRole('button'));

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
