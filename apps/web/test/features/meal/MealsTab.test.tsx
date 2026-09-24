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
import { render, screen, within } from '../../support/dom/renderComponent.js';
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

function renderTab(suggestion: Parameters<typeof MealsTab>[0]['suggestion']) {
  render(<MealsTab suggestion={suggestion} today={TODAY} />);
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
