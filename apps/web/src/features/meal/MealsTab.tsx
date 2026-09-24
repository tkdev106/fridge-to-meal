/**
 * 献立タブ（B-49a）。`docs/screen-design.md` 第3章に当たる。**中身が入った。**
 *
 * ここは `MealCards.ts` を読むだけの薄い層である。件数の数え方も「使う:」の並びも印の有無も
 * 持たない（先行 `PantryList.tsx`）— 判断は純粋関数に置くほうが速く、仮の文言にも jsdom にも
 * 依存しない。**出し分けそのもの**（結末のどれを描くか・注意表示を何回出すか）は切り出せない
 * ので、`apps/web/test/features/meal/MealsTab.test.tsx` が描いて確かめる（ADR-052）。
 *
 * 反対に、**日本語はここにしか置かない**（先行 `PantryList.tsx`）。**文言はすべて仮である**
 * （同書 冒頭・論点3）。
 *
 * **この周で置いていないもの:**
 * - 「新しい献立を見る」（FR-36 / D-2）と、送っている間（S-5 / D-6）と失敗（S-6）… **B-49b**
 * - 在庫が足りない回（S-4 / D-7）と上限に達した回（S-7）の見せ方 … **B-49c**。どちらも
 *   結末としては届いており、**提案として描かないこと**だけをここで守る
 * - 手順と材料の内訳（FR-19 / FR-31）… **B-53**（献立詳細）。カードから開く導線もそちらである
 */

import type { MealCardStockItem } from './MealCards.js';
import { mealCardsOf } from './MealCards.js';
import type { LatestSuggestionOutcome } from '../../server/SuggestionRequests.js';

/** 読み込み中の案内（**暫定**）。`docs/screen-design.md` は S-5 しか決めていない。 */
const LOADING_NOTICE = '献立を読み込んでいます。';

/**
 * 取れなかったときの断り（**暫定**）。**原因を断定しない** — 継ぎ目は通信の失敗・401・500・
 * 壊れた応答をすべて1つの結末に畳んでおり（`SuggestionRequests.ts`）、見分ける材料が無い。
 * **再試行の手段も置かない**（自動でも取りに行き直さない）。
 */
const LOAD_FAILURE_NOTICE = '献立を読み込めませんでした。';

/**
 * まだ1件も提案していない世帯への案内（S-8。**文言は暫定**）。
 *
 * **失敗ではない。** この経路は保存済みを読むだけで生成を呼ばないので（ADR-065 決定1）、
 * 一度も生成していなければ取れるものが無い。**出すべきは「新しい献立を求める」操作**だが、
 * それを置くのは B-49b なので、この周は案内だけを出す（feature flag で隠さない。`CLAUDE.md`）。
 */
const NO_SUGGESTION_YET_NOTICE = 'まだ献立の提案がありません。';

/**
 * 提案が0件だったときの断り。**サーバはこの形を返さない** — 提案は1件以上の献立を持つ
 * （C-15）。届いたら継ぎ目かサーバの不具合なので、**0件の一覧として静かに描かず**、
 * 献立が無いことを言う。
 */
const EMPTY_SUGGESTION_NOTICE = NO_SUGGESTION_YET_NOTICE;

/** 再利用の印（FR-35 / D-3。**文言と形は未確定**である）。 */
const REUSED_MARK = '前に見た献立';

/**
 * 注意表示（FR-20）。**FR-20 が例示した字面をそのまま採っただけで、確定ではない。**
 * 同条が求めているのは「これに**相当する**注意表示」であり、文言は他と同じく仮である
 * （`docs/screen-design.md` 冒頭・論点3）。
 */
const CAUTION = 'AIによる提案です。分量・加熱時間はご自身で確認してください。';

/** 期限が今日の在庫に添える印（D-4）。**色だけに頼らない**（NFR-17）。 */
const TODAY_MARK = '今日';

/** 不足の件数の言い回し（D-4）。**件数はどちらも主材料で数える**（C-16）。 */
function coverageText(ingredientCount: number, missingCount: number): string {
  const missing = missingCount === 0 ? '不足なし' : `不足${missingCount}件`;

  return `材料${ingredientCount}件 · ${missing}`;
}

/** 「使う:」の欄（FR-18 の結果を見せる。D-4）。**並べ替えは `MealCards.ts` の持ち分。** */
function UsedStockItems({ stockItems }: { stockItems: readonly MealCardStockItem[] }) {
  if (stockItems.length === 0) return null;

  return (
    <p>
      <span>使う:</span>
      {stockItems.map((stockItem) => (
        // 名称と印を別の要素に分けておく。**印を名称に混ぜると、利用者が読む単位と
        // 画面が持つ単位がずれる**（読み上げも名称で止まれなくなる）。
        <span key={stockItem.name}>
          <span>{stockItem.name}</span>
          {stockItem.expiringToday && <span>（{TODAY_MARK}）</span>}
        </span>
      ))}
    </p>
  );
}

/**
 * 画面が受け取る結末。取得の結末に「読み込み中」を1つ足しただけのものである
 * （先行 `PantryListState`）。
 */
export type MealsTabState = { readonly outcome: 'loading' } | LatestSuggestionOutcome;

export type MealsTabProps = {
  suggestion: MealsTabState;
  /**
   * 「使う:」の印を決める基準日（`YYYY-MM-DD`）。**呼び出し側が渡す。**
   * ここで `new Date()` を読むと、現在時刻が本体に埋まる（`docs/testing.md` 5章）。
   */
  today: string;
};

export function MealsTab({ suggestion, today }: MealsTabProps) {
  // 出し分けだけを行い、計算を持たない（先行 `PantryList`）。
  //
  // **取りに行く条件はここに無い** — 門が持つ（先行 `PantryList`）。この画面は
  // 「開かれた」ことを誰にも伝えない。**読み取り専用の経路には費用が無い**ので
  // （ADR-065 決定2）、開かれるまで待つ理由がそもそも無い。
  if (suggestion.outcome === 'loading') return <p>{LOADING_NOTICE}</p>;
  if (suggestion.outcome === 'failed') return <p>{LOAD_FAILURE_NOTICE}</p>;
  if (suggestion.outcome !== 'suggested') return <p>{NO_SUGGESTION_YET_NOTICE}</p>;

  const cards = mealCardsOf(suggestion.suggestion.entries, today);
  if (cards.length === 0) return <p>{EMPTY_SUGGESTION_NOTICE}</p>;

  // **件数が1〜3件で変わることを隠さない**（D-1）。空きをプレースホルダで埋めると
  // 「壊れている」と読まれる。カードを詰めて並べるだけにする。
  return (
    <div>
      <ul>
        {cards.map((card) => (
          <li key={card.mealId}>
            <h2>{card.title}</h2>
            {/* 再利用にだけ印を置く（FR-35 / D-3）。`note` は本文に添える補助であり、
                読み上げにも印として届く。**色は1つも使わない**（NFR-17 の構え）。 */}
            {card.reused && <span role="note">{REUSED_MARK}</span>}
            <p>{coverageText(card.ingredientCount, card.missingCount)}</p>
            <UsedStockItems stockItems={card.usedStockItems} />
          </li>
        ))}
      </ul>

      {/* 一覧では末尾に1回だけ（FR-20 / D-5）。カードごとに出すと読まれなくなる。
          詳細画面（B-53）では必ず出す。 */}
      <aside>{CAUTION}</aside>
    </div>
  );
}
