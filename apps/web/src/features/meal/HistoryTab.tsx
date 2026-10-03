/**
 * 履歴タブ（B-54b）。`docs/screen-design.md` 第7章に当たる。
 *
 * `GET /meals`（B-54a / ADR-068）の2つの列 — 「以前見た献立」（`seen`）と「作った献立」
 * （`cooked`）— を**切り替えて1列ずつ**見せる。2つの列は同じ献立を調理記録の有無で
 * 振り分けたものであり、**振り分けも並びもサーバが決める**（ADR-068 決定3 / ADR-083 決定1）—
 * ここでは並べ替えず、渡された順のまま描く（設計 規則3）。
 *
 * **行は日ごとにまとめ、まとまりの前に見出しを置く**（ADR-083 決定3・4）。以前見た献立は
 * 献立の生成日時、作った献立は直近の調理記録の日時で、端末の時刻帯の暦日に分ける
 * （`HistoryDays.ts`）。見出しは `h2` の中の `button`（`▼ 2026年10月3日`）で、押すとその日の
 * 行を畳み、もう一度押すと開く。開閉は `aria-expanded` で読め、`aria-controls` はその日の
 * 一覧を指す。畳んだ一覧は木に残して `hidden` を当てる — 消すと指す先が無くなる。
 * **開いた直後はすべて開いている。** 開閉は列ごとに「畳んだ日付の集合」で持つので、取り直しで
 * 新しい日が届いてもその日は開いて出る。
 *
 * **1行に出すのは名称と主材料の件数だけである**（設計 規則4）。日付は見出しにだけ出し、
 * 充足も記録の有無の印も出さない — 充足は開いたときに算出すれば足りる（FR-32）。
 *
 * **列の選択と日ごとの開閉はここが持つ**（設計 規則6 / ADR-083 決定4 / 先行 `PantryTab`）。
 * 門も器も知らない — 詳細を開いて戻っても保たれ、器は選んだタブしか描かないので、タブを移ると
 * 初期（以前見た・すべて開く）に戻る。保存はしない。
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
 * **見た目はデザイン 12 に揃えた**（B-67。値は `HistoryTab.module.css`）。題・切り替え・件数の
 * 文言はデザインが正である（ADR-074 決定1）。読み込み中・取れなかった・0件の案内はデザインに
 * 無いので暫定のまま。
 */

import { useId, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { ListMealsOutput, MealSummaryOutput } from '@fridge-to-meal/contract';
import { historyDaysOf } from './HistoryDays.js';
import type { HistoryDay } from './HistoryDays.js';
import type { MealListOutcome } from '../../server/MealRequests.js';
import { ScreenHeader } from '../../navigation/ScreenHeader.js';
import styles from './HistoryTab.module.css';

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

/** 列の切り替えの文言（原本 `index.dc.html` 12。ADR-074 決定1 — デザインが正）。並びも切り替えの左右の順である。 */
const COLUMN_LABELS: readonly { readonly column: Column; readonly label: string }[] = [
  { column: 'seen', label: '以前見た献立' },
  { column: 'cooked', label: '作った献立' },
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
  cooked: '作った献立はまだありません。',
};

/** 見出しの行の題（原本 `index.dc.html` 12。ADR-074 決定1 — 仮ではない）。 */
const HEADING = '履歴';

/** 主材料の件数（ADR-068 決定4。件数は主材料で数えたものがサーバから届く — C-16）。 */
function ingredientCountText(ingredientCount: number): string {
  return `材料${ingredientCount}件`;
}

/**
 * 列の切り替え（設計 規則5 / NFR-17）。**`role="tab"` にしない** — 下タブの `tablist` と
 * 入れ子になる（設計 10章 前提2）。選んでいる側は `aria-pressed` で読め、見た目（地・文字色・
 * 太さ）は**同じ真偽1つ**から class を当てる（B-67 規則4 / 10章 前提5）。
 */
function ColumnToggles({
  selected,
  onSelect,
}: {
  selected: Column;
  onSelect: (column: Column) => void;
}) {
  return (
    <div className={styles.inset}>
      <div className={styles.toggles}>
        {COLUMN_LABELS.map(({ column, label }) => {
          const pressed = column === selected;
          return (
            <button
              key={column}
              type="button"
              className={pressed ? `${styles.toggle} ${styles.toggleSelected}` : styles.toggle}
              aria-pressed={pressed}
              onClick={() => onSelect(column)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 列ごとの畳んだ日の鍵（`HistoryDay.key`）。開いた直後はどちらも空 — すべて開いている。 */
type CollapsedDays = Readonly<Record<Column, ReadonlySet<string>>>;

const INITIAL_COLLAPSED_DAYS: CollapsedDays = { seen: new Set(), cooked: new Set() };

/** 選んでいる列を日ごとに分ける。列ごとに、その列の日時で分ける（ADR-083 決定1・2）。 */
function daysOf(meals: ListMealsOutput, column: Column): readonly HistoryDay<MealSummaryOutput>[] {
  return column === 'seen'
    ? historyDaysOf(meals.seen, (meal) => meal.generatedAt)
    : historyDaysOf(meals.cooked, (meal) => meal.cookedAt);
}

/**
 * 日ごとのまとまり（ADR-083 決定3・4 / NFR-17）。見出しは `h2` の中の `button` 1つで、
 * 読み上げの名前は日付だけ（▼ は飾りなので `aria-hidden`）。畳んだ一覧は `hidden` で残す。
 */
function DayGroups({
  days,
  collapsed,
  onToggleDay,
  onOpenMeal,
}: {
  days: readonly HistoryDay<MealSummaryOutput>[];
  collapsed: ReadonlySet<string>;
  onToggleDay: (key: string) => void;
  onOpenMeal: (mealId: string) => void;
}) {
  // `aria-controls` が指す一覧の id。画面に同じ部品が2つ出ても衝突しないよう `useId` を頭に付ける。
  const idPrefix = useId();
  return (
    <div className={styles.days}>
      {days.map((day, index) => {
        const expanded = !collapsed.has(day.key);
        // 同じ日付が間を挟んで2度現れうる（`HistoryDays.ts`）ので、id には位置も入れる。
        const listId = `${idPrefix}-day-${String(index)}`;
        return (
          <div key={`${day.key}-${String(index)}`}>
            <h2 className={styles.dayHeading}>
              <button
                type="button"
                className={styles.dayToggle}
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => onToggleDay(day.key)}
              >
                <span
                  aria-hidden="true"
                  className={
                    expanded ? styles.dayMarker : `${styles.dayMarker} ${styles.dayMarkerCollapsed}`
                  }
                >
                  ▼
                </span>
                {day.label}
              </button>
            </h2>
            <MealRows id={listId} hidden={!expanded} meals={day.meals} onOpenMeal={onOpenMeal} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * 1日ぶんの行（設計 規則3・4・8）。**行そのものを開く操作にする**（ワイヤーに別の操作が無い）。
 * 名称と件数は別の要素に分けておく — 読み上げが名称で止まれるように（先行 `MealsTab`）。
 */
function MealRows({
  id,
  hidden,
  meals,
  onOpenMeal,
}: {
  id: string;
  hidden: boolean;
  meals: readonly MealSummaryOutput[];
  onOpenMeal: (mealId: string) => void;
}) {
  return (
    // `role="list"` を明示するのは、`list-style: none` で一覧の役割を落とす読み手（Safari）が
    // あるため（B-67 規則8 / 先行 `MealsTab` の `.cards`）。
    <ul id={id} role="list" hidden={hidden} className={styles.rows}>
      {meals.map((meal) => (
        // 識別子で鍵を取る — 名称が同じ別の献立を畳まない（設計 規則3）。
        <li key={meal.mealId}>
          <button type="button" className={styles.row} onClick={() => onOpenMeal(meal.mealId)}>
            <span className={styles.title}>{meal.title}</span>
            <span className={styles.count}>{ingredientCountText(meal.ingredientCount)}</span>
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
  // 日ごとの開閉（ADR-083 決定4）。列の選択と同じく、詳細を開いて戻っても保たれる。
  const [collapsedDays, setCollapsedDays] = useState<CollapsedDays>(INITIAL_COLLAPSED_DAYS);

  // **詳細は結末より先に見る**（先行 `MealsTab`）。一覧と並べず入れ替え、列の切り替えも出さない。
  if (mealDetail !== null) return <div>{mealDetail}</div>;

  return (
    <div className={styles.screen}>
      {/* 見出しの行は列の切り替え・案内・行より前（B-60 規則12。原本: 見出しは一覧の先頭）。 */}
      <div className={styles.inset}>
        <ScreenHeader title={HEADING} onOpenSettings={onOpenSettings} />
      </div>
      {historyBody()}
    </div>
  );

  /** 選んでいる列の、その日の開閉を入れ替える。他の列の開閉には触らない（ADR-083 決定4）。 */
  function toggleDay(key: string): void {
    setCollapsedDays((current) => {
      const next = new Set(current[selectedColumn]);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...current, [selectedColumn]: next };
    });
  }

  function historyBody(): JSX.Element {
    // 読み込み中と取れなかった回は、切り替えを出さない — 切り替えた先にも見せるものが無い。
    if (meals.outcome === 'loading') {
      return (
        <p role="status" className={styles.notice}>
          {LOADING_NOTICE}
        </p>
      );
    }
    if (meals.outcome === 'failed') {
      return (
        <p role="status" className={styles.notice}>
          {LOAD_FAILURE_NOTICE}
        </p>
      );
    }

    const rows = meals.meals[selectedColumn];

    return (
      <>
        <ColumnToggles selected={selectedColumn} onSelect={setSelectedColumn} />
        {rows.length === 0 ? (
          <p role="status" className={`${styles.notice} ${styles.emptyNotice}`}>
            {EMPTY_COLUMN_NOTICES[selectedColumn]}
          </p>
        ) : (
          <DayGroups
            days={daysOf(meals.meals, selectedColumn)}
            collapsed={collapsedDays[selectedColumn]}
            onToggleDay={toggleDay}
            onOpenMeal={onOpenMeal}
          />
        )}
      </>
    );
  }
}
