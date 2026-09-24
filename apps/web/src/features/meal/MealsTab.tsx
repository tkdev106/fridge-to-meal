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

import { useEffect } from 'react';
import type { MealCardStockItem } from './MealCards.js';
import { mealCardsOf } from './MealCards.js';
import type { SuggestMealsOutcome } from '../../server/SuggestionRequests.js';

/** 読み込み中の案内（**暫定**）。`docs/screen-design.md` は S-5 しか決めていない。 */
const LOADING_NOTICE = '献立を読み込んでいます。';

/**
 * 取れなかったときの断り（**暫定**）。**原因を断定しない** — 継ぎ目は通信の失敗・401・500・
 * 壊れた応答をすべて1つの結末に畳んでおり（`SuggestionRequests.ts`）、見分ける材料が無い。
 * **再試行の手段も置かない**（自動でも取りに行き直さない）。
 */
const LOAD_FAILURE_NOTICE = '献立を読み込めませんでした。';

/**
 * 献立を伴わない結末の仮置き（S-4 / S-7。**B-49c が置き換える**）。
 *
 * **2つを1つの文言に畳んでいるのは、この周が見せ方を決めないためである。** S-4 は在庫タブへ
 * 送る案内（D-7）、S-7 は今日はもう出せないことの案内であり、**別の画面になる。**
 * feature flag で隠さず、そのまま出す（`CLAUDE.md`）。
 */
const NO_MEALS_NOTICE = 'いま出せる献立がありません。';

/**
 * 提案が0件だったときの断り。**サーバはこの形を返さない** — 献立が無い回は S-4 か S-7 の
 * 結末になる（`SuggestMeals`）。届いたら継ぎ目かサーバの不具合なので、**0件の一覧として
 * 静かに描かず**、献立が無いことを言う。
 */
const EMPTY_SUGGESTION_NOTICE = NO_MEALS_NOTICE;

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
export type MealsTabState = { readonly outcome: 'loading' } | SuggestMealsOutcome;

export type MealsTabProps = {
  suggestion: MealsTabState;
  /**
   * 「使う:」の印を決める基準日（`YYYY-MM-DD`）。**呼び出し側が渡す。**
   * ここで `new Date()` を読むと、現在時刻が本体に埋まる（`docs/testing.md` 5章）。
   */
  today: string;
  /**
   * **この画面が出たという合図**（B-49a）。取りに行く条件を持つのは門であり、ここは
   * 描かれたことを伝えるだけである。
   *
   * **なぜ門が起動と同時に取りに行かないか。** 既定の提案でも、作れる既存の献立が0件なら
   * 生成を呼ぶ（C-4 / ADR-022）。開かれてもいない画面のために1日10回の枠（NFR-C2）と費用を
   * 使わないよう、**開かれてから1度だけ**取りに行く。器は選んだタブの中身しか描かないので
   * （B-38 設計 6章 規則6）、この合図は「タブが開かれた」と同じ意味になる。
   *
   * **この形は起動時に開くタブが在庫であることに支えられている。** 献立が既定になれば
   * 「起動＝タブが開かれた」になり、費用を避ける効き目が消える。**既定を献立にする決定は
   * 別の周が `提案` の ADR として起こしている最中で、まだ `main` に無い** — 反映もそちらが
   * 持つ。**取りに行く置き方はユーザーの判断を仰いでいる**ので、この doc はいまの形の理由を
   * 書き残すだけにとどめる。
   *
   * **「保存済みの提案だけ出して明示操作を待つ」形は、いまのサーバでは作れない。**
   * `POST /suggestions` は在庫が前回から変われば生成を呼び（C-4 / C-7）、保存済みだけを返す
   * 経路が api に無い（`SuggestionRoutes.ts` は2経路とも生成を通りうる）。採るなら
   * **読み取り専用の経路を足す周が先**であり、その行は backlog にまだ無い。
   */
  onOpened: () => void;
};

export function MealsTab({ suggestion, today, onOpened }: MealsTabProps) {
  // 描かれたことだけを伝える。**取りに行き直す判断はここに無い** — 門が持つ。
  useEffect(() => {
    onOpened();
  }, [onOpened]);

  // 出し分けだけを行い、計算を持たない（先行 `PantryList`）。
  if (suggestion.outcome === 'loading') return <p>{LOADING_NOTICE}</p>;
  if (suggestion.outcome === 'failed') return <p>{LOAD_FAILURE_NOTICE}</p>;
  if (suggestion.outcome !== 'suggested') return <p>{NO_MEALS_NOTICE}</p>;

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
