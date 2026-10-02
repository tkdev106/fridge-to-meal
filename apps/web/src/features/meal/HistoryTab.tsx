/**
 * 履歴タブ（B-54b）。`docs/screen-design.md` 第7章に当たる。
 *
 * `GET /meals`（B-54a / ADR-068）の2つの列 — 「以前見た献立」（`seen`）と「つくった献立」
 * （`cooked`）— を**切り替えて1列ずつ**見せる。2つの列は同じ献立を調理記録の有無で
 * 振り分けたものであり、**振り分けも並びもサーバが決める**（ADR-068 決定2・3）— ここでは
 * 並べ替えず、畳まず、渡された順のまま描く（設計 規則3）。
 *
 * **1行に出すのは名称と主材料の件数だけである**（設計 規則4 / ADR-068 決定4）。日付も充足も
 * 記録の有無の印も出さない — 充足は開いたときに算出すれば足りる（FR-32）。
 *
 * **列の選択はここが持つ**（設計 規則6 / 先行 `PantryTab`）。門も器も知らない — 詳細を開いて
 * 戻っても保たれ、器は選んだタブしか描かないので、タブを移ると初期（以前見た）に戻る。
 *
 * **開いている献立を持つのは門である**（設計 規則9 / ADR-066 と同じ理由）。ここは行から
 * 識別子を渡し、渡された詳細を一覧の代わりに描くだけである（先行 `MealsTab.mealDetail`）。
 *
 * **先頭に見出しの行（`h1` 履歴と歯車）を置く**（B-60 設計 6章 規則12〜13）。設定への入口は
 * SP では3つのタブの見出しの歯車、PC ではサイドナビの下端の「設定」である（B-56c の
 * 「⚙ 設定」はここで撤去した）。一覧を出す3つの状態（読み込み中・取れなかった・取れた）の
 * すべてで出す — 履歴が取れなかった回にログアウトへ届かなくなってはならない（B-56c 設計
 * 規則2 の趣旨）。**設定を開いているかは門が持ち**（ADR-066 と同じ理由）、ここは歯車の押下を
 * 口で渡すだけである。**設定画面を描くのはここではない** — 設定はタブの外の4つ目の行き先になり、
 * 器（`TabbedScreen`）が選んでいたタブの中身の代わりに描く（B-60 設計 6章 規則7）。
 * `features/identity/` は import しない。
 *
 * 名称での検索（FR-33）はまだ置かない。
 *
 * **文言は仮である**（`docs/screen-design.md` 冒頭・論点3）。
 */

import { useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { MealSummaryOutput } from '@fridge-to-meal/contract';
import type { MealListOutcome } from '../../server/MealRequests.js';
import { ScreenHeader } from '../../navigation/ScreenHeader.js';

/** 門から渡される履歴の状態（設計 5章）。取りに行くまでは「読み込み中」である。 */
export type HistoryTabState = { readonly outcome: 'loading' } | MealListOutcome;

export type HistoryTabProps = {
  meals: HistoryTabState;
  onOpenMeal: (mealId: string) => void;
  /** null でなければ一覧の代わりにこれを描く（先行 MealsTab.mealDetail） */
  mealDetail: ReactNode | null;
  /** 見出しの行の歯車が押された（B-60 設計 6章 規則12）。設定を開いているかは門が持つ。 */
  onOpenSettings: () => void;
};

/** 2つの列（ADR-068 決定3）。キーは `ListMealsOutput` のものをそのまま使う。 */
type Column = 'seen' | 'cooked';

/** 開いた直後の列（設計 規則5。ワイヤーの左を採った — 設計 10章 前提3）。 */
const INITIAL_COLUMN: Column = 'seen';

/** 列の切り替えの文言（**仮**。ワイヤーの字面）。並びも切り替えの左右の順である。 */
const COLUMN_LABELS: readonly { readonly column: Column; readonly label: string }[] = [
  { column: 'seen', label: '以前見た献立' },
  { column: 'cooked', label: 'つくった献立' },
];

/** 読み込み中の案内（**暫定**）。 */
const LOADING_NOTICE = '献立の履歴を読み込んでいます。';

/**
 * 取れなかったときの断り（**暫定**）。**原因を断定しない** — 継ぎ目は通信の失敗・401・500・
 * 壊れた応答をすべて1つの結末に畳んでいる（`MealRequests.ts`）。**再試行の手段も置かない**
 * （自動でも取りに行き直さない。設計 規則7）。
 */
const LOAD_FAILURE_NOTICE = '献立の履歴を読み込めませんでした。';

/** 選んでいる列が0件のときの案内（**暫定**）。**失敗ではない**（設計 規則7）。 */
const EMPTY_COLUMN_NOTICES: Readonly<Record<Column, string>> = {
  seen: '以前見た献立はまだありません。',
  cooked: 'つくった献立はまだありません。',
};

/** 見出しの行の題（原本 `index.dc.html` 12。ADR-074 決定1 — 仮ではない）。 */
const HEADING = '履歴';

/** 主材料の件数（ADR-068 決定4。件数は主材料で数えたものがサーバから届く — C-16）。 */
function ingredientCountText(ingredientCount: number): string {
  return `材料${ingredientCount}件`;
}

/**
 * 列の切り替え（設計 規則5 / NFR-17）。**`role="tab"` にしない** — 下タブの `tablist` と
 * 入れ子になる（設計 10章 前提2）。選んでいる側は文字だけでなく `aria-pressed` で読め、
 * **色は1つも足さない**。
 */
function ColumnToggles({
  selected,
  onSelect,
}: {
  selected: Column;
  onSelect: (column: Column) => void;
}) {
  return (
    <div>
      {COLUMN_LABELS.map(({ column, label }) => (
        <button
          key={column}
          type="button"
          aria-pressed={column === selected}
          onClick={() => onSelect(column)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * 1列ぶんの行（設計 規則3・4・8）。**行そのものを開く操作にする**（ワイヤーに別の操作が無い）。
 * 名称と件数は別の要素に分けておく — 読み上げが名称で止まれるように（先行 `MealsTab`）。
 */
function MealRows({
  meals,
  onOpenMeal,
}: {
  meals: readonly MealSummaryOutput[];
  onOpenMeal: (mealId: string) => void;
}) {
  return (
    <ul>
      {meals.map((meal) => (
        // 識別子で鍵を取る — 名称が同じ別の献立を畳まない（設計 規則3）。
        <li key={meal.mealId}>
          <button type="button" onClick={() => onOpenMeal(meal.mealId)}>
            <span>{meal.title}</span>
            <span>{ingredientCountText(meal.ingredientCount)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function HistoryTab({
  meals,
  onOpenMeal,
  mealDetail,
  onOpenSettings,
}: HistoryTabProps): JSX.Element {
  // 詳細を開いている間もこの部品は mount されたままなので、選んだ列は戻っても保たれる（規則6）。
  // **設定を開くと、ここは木から外れる**（B-60 規則10 / B-38 規則6）— タブを移ったときと同じく、
  // 戻ったときの列は初期に戻る（B-56c 規則8 はここで置き換わった）。
  const [selectedColumn, setSelectedColumn] = useState<Column>(INITIAL_COLUMN);

  // **詳細は結末より先に見る**（先行 `MealsTab`）。一覧と並べず入れ替え、列の切り替えも出さない。
  if (mealDetail !== null) return <div>{mealDetail}</div>;

  return (
    <div>
      {/* 見出しの行は列の切り替え・案内・行より前（B-60 規則12。原本: 見出しは一覧の先頭）。 */}
      <ScreenHeader title={HEADING} onOpenSettings={onOpenSettings} />
      {historyBody()}
    </div>
  );

  function historyBody(): JSX.Element {
    // 読み込み中と取れなかった回は、切り替えを出さない — 切り替えた先にも見せるものが無い。
    if (meals.outcome === 'loading') return <p role="status">{LOADING_NOTICE}</p>;
    if (meals.outcome === 'failed') return <p role="status">{LOAD_FAILURE_NOTICE}</p>;

    const rows = meals.meals[selectedColumn];

    return (
      <>
        <ColumnToggles selected={selectedColumn} onSelect={setSelectedColumn} />
        {rows.length === 0 ? (
          <p role="status">{EMPTY_COLUMN_NOTICES[selectedColumn]}</p>
        ) : (
          <MealRows meals={rows} onOpenMeal={onOpenMeal} />
        )}
      </>
    );
  }
}
