// @vitest-environment jsdom
/**
 * `PantryList` の**表示の分岐**（`docs/testing.md` 4章 / ADR-052）。
 *
 * `PantrySections.ts` と `RemainingDays.ts` の計算は、それぞれの純粋関数のテストが既に
 * 押さえている。ここで確かめるのは**受け取った3値のどれを描くか**だけである（B-22 設計 5章）。
 *
 * **仮の文言を期待値に書かない。** 見出しも案内も `docs/screen-design.md` 論点3 で未確定であり
 * （`PantryList.tsx` の doc がそう断っている）、文字列で留めると**文言を変えただけで赤くなる。**
 * 代わりに、**利用者から見える構造**（行が出るか、帯がいくつか、どの順か）と、
 * **こちらが渡したデータ**（在庫品の名称）で観察する。
 */

import { describe, expect, it } from 'vitest';
import type { StockItemDto } from '@fridge-to-meal/contract';
import { render, screen, within } from '../../support/dom/renderComponent.js';
import { PantryList } from '../../../src/features/pantry/PantryList.js';

const TODAY = '2026-09-20';

/** 消せない相手。この観点のテストは削除を起こさないので、呼ばれたら分かる形にしておく。 */
const neverDelete = () => Promise.reject(new Error('この観点では削除を呼ばない'));

function stockItem(overrides: Partial<StockItemDto> & { id: string; name: string }): StockItemDto {
  return { ingredientId: null, amount: null, expiryDate: null, ...overrides };
}

/** 並びを位置で見るための取り出し。件数は呼ぶ側が先に確かめている。 */
function rowAt(rows: readonly HTMLElement[], index: number): HTMLElement {
  const row = rows[index];
  if (row === undefined) throw new Error(`${index} 番目の行が無い`);

  return row;
}

describe('在庫一覧 PantryList', () => {
  it('取れた在庫品を、渡された順に並べる', () => {
    render(
      <PantryList
        today={TODAY}
        onDelete={neverDelete}
        stockItems={{
          outcome: 'loaded',
          stockItems: [
            stockItem({ id: '1', name: '豚こま肉', amount: '300g', expiryDate: '2026-09-20' }),
            stockItem({ id: '2', name: '白菜', expiryDate: '2026-09-22' }),
            stockItem({ id: '3', name: 'にんじん', amount: '2本' }),
          ],
        }}
      />,
    );

    // 並びはサーバが決めた順のまま（FR-04 / B-22 設計 規則3）。
    //
    // **当てるのはテストが渡した名称と分量だけである。** 行には残日数の言い換え（`今日` /
    // `あと2日` / `－`）も出ているが、それは画面が持つ**仮の文言**であり（`PantryList.tsx` の
    // `remainingDaysText` / `NO_REMAINING_DAYS_MARK`、`docs/screen-design.md` 論点3）、
    // 期待値に留めると**文言を変えただけで赤くなる**（ADR-052 結果2 / `docs/testing.md` 4.1）。
    // 残日数の言い換えそのものは `RemainingDays.ts` の純粋関数テストの持ち分である。
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rowAt(rows, 0)).queryByText('豚こま肉')).not.toBeNull();
    expect(within(rowAt(rows, 0)).queryByText('300g')).not.toBeNull();
    expect(within(rowAt(rows, 1)).queryByText('白菜')).not.toBeNull();
    expect(within(rowAt(rows, 2)).queryByText('にんじん')).not.toBeNull();
    expect(within(rowAt(rows, 2)).queryByText('2本')).not.toBeNull();
  });

  it('帯1つにつき見出しを1つ描く', () => {
    render(
      <PantryList
        today={TODAY}
        onDelete={neverDelete}
        stockItems={{
          outcome: 'loaded',
          stockItems: [
            stockItem({ id: '1', name: '豚こま肉', expiryDate: '2026-09-20' }),
            stockItem({ id: '2', name: '白菜', expiryDate: '2026-09-22' }),
            stockItem({ id: '3', name: 'にんじん' }),
          ],
        }}
      />,
    );

    // 3件が3つの帯へ1件ずつ入る（FR-12 / B-11 設計 規則6）。**どう振り分けるかは
    // `PantrySections.ts` の持ち分**で、ここで確かめるのは「帯の数だけ見出しが出ること」である。
    // **見出しの文言は見ない** — 仮である（`docs/screen-design.md` 論点3）。
    expect(screen.getAllByRole('heading')).toHaveLength(3);
  });

  it('在庫が0件なら帯も行も出さない', () => {
    render(
      <PantryList
        today={TODAY}
        onDelete={neverDelete}
        stockItems={{ outcome: 'loaded', stockItems: [] }}
      />,
    );

    // 登録を促す案内だけが出る（B-11 設計 規則11）。**文言は見ない。**
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryAllByRole('heading')).toHaveLength(0);
  });

  it('読み込み中は在庫品を1件も出さない', () => {
    render(<PantryList today={TODAY} onDelete={neverDelete} stockItems={{ outcome: 'loading' }} />);

    // **0件の在庫と同じ見せ方にしない**のが B-22 設計 7章 の眼目だが、ここで確かめられるのは
    // 「在庫があるように見せない」ほうである。**行が出ないこと**を押さえる。
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('取れなかったときも在庫品を1件も出さない', () => {
    render(<PantryList today={TODAY} onDelete={neverDelete} stockItems={{ outcome: 'failed' }} />);

    // 古い在庫を残して出すと、消えたはずのものが見え続ける（B-22 設計 規則9）。
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
