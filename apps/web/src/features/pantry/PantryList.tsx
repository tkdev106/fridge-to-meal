/**
 * 在庫一覧の画面（B-11 設計 4章 / 6章 規則9〜11）。`docs/screen-design.md` 第5章に当たる。
 *
 * ここは `PantrySections.ts` と `RemainingDays.ts` を読むだけの薄い層である。帯の判定も
 * 並べ替えも持たない（規則7）— `.tsx` は vitest が拾わない（`include` は `*.test.ts`、
 * `environment: 'node'`）ため、判断を置くと誰も確かめられなくなる。
 *
 * 反対に、**日本語はここにしか置かない**（規則10）。文言も配色も未確定であり
 * （同書 論点3）、純粋関数に持たせるとテストが仮の文言を固定してしまう。
 *
 * 在庫品の列は引数で受け取る。サーバからの取得はこの周では作らない（B-11 設計 2章）。
 */

import type { StockItemDto } from '@fridge-to-meal/contract';
import type { ExpirySection, ListedStockItem } from './PantrySections.js';
import { pantrySectionsOf } from './PantrySections.js';

/**
 * 帯の見出し。**見出し自体がテキストの警告**になっていることで、色を使わなくても
 * 期限の近さが読める（NFR-17 / screen-design 5章）。以下すべて仮の文言である。
 */
const 帯の見出し: Record<ExpirySection, string> = {
  urgent: '期限 今日まで',
  soon: '期限が近い',
  rest: 'その他',
};

/** 期限が未設定のときに残日数の欄へ出す印（FR-13 / screen-design 5章）。 */
const 残日数なしの印 = '－';

/** 在庫が0件のときの案内。登録の導線そのものは B-12 で置くので、ここは文言だけ。 */
const 在庫が0件のときの案内 = '冷蔵庫の中身がまだ登録されていません。登録すると、ここに並びます。';

/**
 * 残日数を読める文にする（NFR-17 / screen-design 9章の「今日」「あと2日」）。
 * 数から文への言い換えだけを行い、どの帯に入るかはここで決めない（規則5 は純粋関数の側）。
 */
function 残日数の文(remainingDays: number | null): string {
  if (remainingDays === null) return 残日数なしの印;
  if (remainingDays === 0) return '今日';
  if (remainingDays < 0) return `${-remainingDays}日過ぎ`;

  return `あと${remainingDays}日`;
}

function StockItemRow({ row }: { row: ListedStockItem }) {
  return (
    <li>
      <span>{row.stockItem.name}</span>
      {row.stockItem.amount !== null && <span>{row.stockItem.amount}</span>}
      {/* 期限の表現は色に頼らず、必ずテキストを出す（NFR-17）。 */}
      <span>{残日数の文(row.remainingDays)}</span>
    </li>
  );
}

export type PantryListProps = {
  stockItems: readonly StockItemDto[];
  /**
   * 残日数を数える基準日（`YYYY-MM-DD`）。**呼び出し側が渡す。**
   * ここで `new Date()` を読むと、現在時刻が本体に埋まる（docs/testing.md 5章）。
   * 実行環境の暦日を作るのは `todayOf` の仕事で、それを呼ぶのは `App.tsx` である。
   */
  today: string;
};

export function PantryList({ stockItems, today }: PantryListProps) {
  const sections = pantrySectionsOf(stockItems, today);

  // 在庫品が0件なら帯を1つも出さない（規則11）。
  if (sections.length === 0) return <p>{在庫が0件のときの案内}</p>;

  return (
    <div>
      {sections.map((section) => (
        <section key={section.section}>
          <h2>{帯の見出し[section.section]}</h2>
          <ul>
            {section.stockItems.map((row) => (
              <StockItemRow key={row.stockItem.id} row={row} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
