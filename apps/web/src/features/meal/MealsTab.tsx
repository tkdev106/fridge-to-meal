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
 * **出せない回（S-4 / S-7）も、それぞれ別の枝として描く**（B-49c）。どちらも 200 で届く
 * 結末であり（ADR-062 決定2）、失敗（S-6）にも「まだ提案が無い」（S-8）にも畳まない。
 *
 * **カードから献立詳細へ開く導線もここにある**（B-53）。手順と材料の内訳そのものは
 * `MealDetail.tsx` の持ち分で、**開いている献立を持つのは門である**（設計 規則17 /
 * ADR-066 と同じ理由）— ここは渡された詳細を、カードの一覧の代わりに描くだけである。
 */

import type { ReactNode } from 'react';
import type { MealCardIngredient } from './MealCards.js';
import { mealCardsOf } from './MealCards.js';
import type { LatestSuggestionOutcome } from '../../server/SuggestionRequests.js';
import type { SuggestMealsOutput } from '@fridge-to-meal/contract';
import { ScreenHeader } from '../../navigation/ScreenHeader.js';

/** 見出しの行の題（原本 `MealScreen.dc.html`。ADR-074 決定1 — 仮ではない）。 */
const HEADING = '今日の献立';

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
 *
 * **S-8 ではなく「取れなかった」に寄せる**（文言はどちらも仮である）。S-8 に畳むと、
 * 起こるはずのない事象が「まだ提案していないだけ」に見え、**画面からは不具合だと
 * 読めなくなる。** 利用者にできることは取り直しであり、そこは失敗と同じである。
 */
const EMPTY_SUGGESTION_NOTICE = LOAD_FAILURE_NOTICE;

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

/**
 * 献立詳細を開く操作の文言（B-53。**仮**である）。
 *
 * **カード全体を押せるようにしない** — 行そのものを掴む先行（在庫のスワイプ削除）があり、
 * 後で行に操作を足したときに当たり判定が重なる（設計 10章）。
 */
const OPEN_MEAL_LABEL = '作り方を見る';

/**
 * 「新しい献立を求める」操作の文言（**すべて仮**。B-49b / FR-36）。
 *
 * **押す前からの待ち時間の案内**（NFR-04）。生成は費用のかかる呼び出しであり、押してから
 * 応答が届くまで間が空くことを、送信中かどうかによらず先に伝える。
 */
const WAITING_NOTICE = '新しい献立を求めると、少し時間がかかります。';

/** `pantryChanged` の手がかり（規則9）。**在庫を足し引きした後にだけ増える2つめの note。** */
const PANTRY_CHANGED_NOTICE = '在庫が変わりました。新しい献立を求められます。';

/** 送信中の案内（S-5）。 */
const REQUESTING_NOTICE = '新しい献立を求めています…';

/** 失敗の案内（S-6 / NFR-07）。**文言は原因を断定しない** — 継ぎ目が理由を持っていない。 */
const REQUEST_FAILED_NOTICE = '新しい献立を求められませんでした。';

/** 操作そのものの文言（FR-36）。 */
const REQUEST_BUTTON_LABEL = '新しい献立を求める';

/**
 * 在庫が足りない回の案内（S-4 / D-7。**文言は仮**である）。
 *
 * **失敗ではない**（200 で届く結末。ADR-041 / ADR-062 決定2）。**件数を言わない** —
 * 結末に在庫の数も閾値も載っておらず、web で数えない（設計 規則7）。
 */
const INSUFFICIENT_STOCK_ITEMS_NOTICE = '在庫が足りないため、献立を提案できません。';

/** 在庫タブへ送る操作の文言（D-7。**仮**である）。 */
const GO_TO_PANTRY_LABEL = '在庫を登録する';

/**
 * 1日の生成回数の上限に達した回の案内（S-7 / NFR-C2 / ADR-049。**文言は仮**である）。
 *
 * **いつ解けるかを告げない** — 24時間の窓は基準日時から遡って定まり（ADR-049 決定2）、
 * web にその材料が無い（設計 規則8）。**残り回数も持たない**（規則7）。
 */
const GENERATION_LIMIT_REACHED_NOTICE = '今日はこれ以上、新しい献立を求められません。';

/** 不足の件数の言い回し（D-4）。**件数はどちらも主材料で数える**（C-16）。 */
function coverageText(ingredientCount: number, missingCount: number): string {
  const missing = missingCount === 0 ? '不足なし' : `不足${missingCount}件`;

  return `材料${ingredientCount}件 · ${missing}`;
}

/** 「使う:」の欄（FR-18 の結果を見せる。D-4）。**並べ替えは `MealCards.ts` の持ち分。** */
function UsedIngredients({ ingredients }: { ingredients: readonly MealCardIngredient[] }) {
  if (ingredients.length === 0) return null;

  return (
    <p>
      <span>使う:</span>
      {ingredients.map((ingredient) => (
        // 名称と印を別の要素に分けておく。**印を名称に混ぜると、利用者が読む単位と
        // 画面が持つ単位がずれる**（読み上げも名称で止まれなくなる）。
        <span key={ingredient.name}>
          <span>{ingredient.name}</span>
          {ingredient.expiringToday && <span>（{TODAY_MARK}）</span>}
        </span>
      ))}
    </p>
  );
}

/**
 * 画面が受け取る結末。取得の結末に「読み込み中」を1つ足しただけのものである
 * （先行 `PantryListState`）。
 *
 * **在庫が足りない（S-4）・上限に達した（S-7）も受け取る**（B-49b / ADR-049 結果7）。
 * どちらも「新しい献立を求める」の結末であって、保存済みの提案の読み取り（`showLatestSuggestion`）
 * には無い — 門が `requestNewMeals` の結末をそのままここへ渡すために両方を型に足す。
 * **それぞれ専用の枝で描く**（B-49c）。
 */
export type MealsTabState =
  | { readonly outcome: 'loading' }
  | LatestSuggestionOutcome
  | Extract<SuggestMealsOutput, { outcome: 'insufficientStockItems' | 'generationLimitReached' }>;

export type MealsTabProps = {
  suggestion: MealsTabState;
  /**
   * 「使う:」の印を決める基準日（`YYYY-MM-DD`）。**呼び出し側が渡す。**
   * ここで `new Date()` を読むと、現在時刻が本体に埋まる（`docs/testing.md` 5章）。
   */
  today: string;
  /** 「新しい献立を求める」操作（B-49b / FR-36）。 */
  onRequestNewMeals: () => void;
  /** 要求を送っている間か（S-5）。 */
  requestingNewMeals: boolean;
  /** 直前の要求が失敗したか（S-6 を含む）。 */
  newMealsFailed: boolean;
  /**
   * 在庫タブへ送る（D-7 / B-49c）。**押した先で何が起きるかを画面は知らない。**
   * 呼ぶのは在庫が足りない回（S-4）の枝だけである。
   */
  onGoToPantry: () => void;
  /**
   * カードの献立を開く（B-53 / 画面設計 2.3）。**開いている献立を持つのは門である**
   * （設計 規則17 / ADR-066 と同じ理由）— タブを移っても閉じず、履歴タブ（B-54b）も
   * 同じ状態から開く。詳細を出どころのタブにだけ描き分けるのも門である（B-54b 規則9）。
   */
  onOpenMeal: (mealId: string) => void;
  /**
   * 開いている献立詳細。**`null` でなければ、カードの一覧の代わりにこれを描く**
   * （先行 `PantryTab` の一覧 ⇄ 登録の入れ替わり）。
   */
  mealDetail: ReactNode | null;
  /** 接続が切れているか（B-70 / FR-41）。省略は `false`。 */
  offline?: boolean;
  /** 見出しの行の歯車が押された（B-60 設計 6章 規則12）。設定を開いているかは門が持つ。 */
  onOpenSettings: () => void;
};

/**
 * 提案の中身（一覧と注意表示）だけを描く。**結末のどれを描くかの分岐はここに置かない**
 * （下の `MealsTab` が既に済ませている）。
 */
function SuggestionBody({
  suggestion,
  today,
  onOpenMeal,
}: {
  suggestion: MealsTabState;
  today: string;
  onOpenMeal: (mealId: string) => void;
}) {
  if (suggestion.outcome === 'loading') return null;
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
            <UsedIngredients ingredients={card.usedIngredients} />
            {/* 手順と材料の内訳は詳細の持ち分である（FR-19 / B-53）。**カードの中に置く** —
                カード全体を押せるようにすると、行の操作を足した日に当たり判定が重なる。 */}
            <button type="button" onClick={() => onOpenMeal(card.mealId)}>
              {OPEN_MEAL_LABEL}
            </button>
          </li>
        ))}
      </ul>

      {/* 一覧では末尾に1回だけ（FR-20 / D-5）。カードごとに出すと読まれなくなる。
          詳細画面（B-53）では必ず出す。 */}
      <aside>{CAUTION}</aside>
    </div>
  );
}

/**
 * 「新しい献立を求める」操作まわり（B-49b）。役割の割り当ては検分で決めた
 * （設計8章の一部として `/tdd` が引き継いだもの）。
 *
 * - 押す前からの待ち時間の案内（NFR-04）… `note`。送信中かどうかによらず常に出す
 * - `pantryChanged` の手がかり（規則9）… これも `note`。真のときだけ1つ増える
 * - 送信中の案内（S-5）と失敗の案内（S-6）… どちらも `status`。**同時には出さない**
 *   （送信中を優先する — 押した時点で失敗の案内を消すのは門の役目だが、ここでも
 *   両方が真になり得ないよう送信中を先に見る）
 */
function RequestNewMealsControl({
  pantryChanged,
  requesting,
  failed,
  offline,
  onRequestNewMeals,
}: {
  pantryChanged: boolean;
  requesting: boolean;
  failed: boolean;
  offline: boolean;
  onRequestNewMeals: () => void;
}) {
  return (
    <div>
      {/* NFR-04: 押す前からの待ち時間の案内。送信中かどうかによらず常に出す。 */}
      <span role="note">{WAITING_NOTICE}</span>
      {/* 規則9: 在庫が変わっている回だけ増える2つめの手がかり。 */}
      {pantryChanged && <span role="note">{PANTRY_CHANGED_NOTICE}</span>}

      {requesting && <p role="status">{REQUESTING_NOTICE}</p>}
      {!requesting && failed && <p role="status">{REQUEST_FAILED_NOTICE}</p>}

      {/* 送信中は押せない（S-5）。押し直しても2度目の要求を出さないのは門の役目であり、
          ここは見た目の側から二重に守るだけである。**1度の求めで生成が2回走ると、
          1日10回の枠（NFR-C2）が利用者の意図の倍で減る。**
          **接続が切れている間も押せない**（B-70 規則7）。理由は門の帯が示すので、案内は足さない。 */}
      <button type="button" onClick={onRequestNewMeals} disabled={requesting || offline}>
        {REQUEST_BUTTON_LABEL}
      </button>
    </div>
  );
}

/**
 * 在庫が足りない回（S-4 / D-7）。**案内と、在庫タブへ送る操作1つだけ**を出す。
 *
 * **「新しい献立を求める」を置かない** — 在庫が足りないまま求めても同じ結末が返るので、
 * 押しても呼べない操作になる。**カードも注意表示も出さない**（提案として描くものが無い）。
 * **直前の要求が失敗していても案内を増やさない** — この結末は失敗ではなく、S-6 の断りと
 * 並べると「出せない理由」が2つあるように読める（ADR-041）。
 */
function InsufficientStockItemsNotice({ onGoToPantry }: { onGoToPantry: () => void }) {
  return (
    <div>
      <p role="status">{INSUFFICIENT_STOCK_ITEMS_NOTICE}</p>
      <button type="button" onClick={onGoToPantry}>
        {GO_TO_PANTRY_LABEL}
      </button>
    </div>
  );
}

/**
 * 1日の生成回数の上限に達した回（S-7 / NFR-C2 / ADR-049）。**案内だけ**を出す。
 *
 * **操作を1つも置かない** — 求め直しても同じ結末が返り、**在庫タブへも送らない**
 * （在庫は原因ではない）。この回に利用者ができることは画面の中に無い。
 */
function GenerationLimitReachedNotice() {
  return <p role="status">{GENERATION_LIMIT_REACHED_NOTICE}</p>;
}

export function MealsTab({
  suggestion,
  today,
  onRequestNewMeals,
  requestingNewMeals,
  newMealsFailed,
  onGoToPantry,
  onOpenMeal,
  mealDetail,
  offline = false,
  onOpenSettings,
}: MealsTabProps) {
  // 出し分けだけを行い、計算を持たない（先行 `PantryList`）。
  //
  // **取りに行く条件はここに無い** — 門が持つ（先行 `PantryList`）。この画面は
  // 「開かれた」ことを誰にも伝えない。**読み取り専用の経路には費用が無い**ので
  // （ADR-065 決定2）、開かれるまで待つ理由がそもそも無い。
  // **詳細は結末より先に見る**（B-53）。開いている献立は、提案が読み込み中の回にも
  // 出せない回にも描けなければならない — 履歴から開いた献立は、在庫が足りない日にも
  // 読める（FR-30）。**一覧と並べず入れ替える**（先行 `PantryTab`）。
  if (mealDetail !== null) return <div>{mealDetail}</div>;

  // **詳細を出していないすべての結末で、先頭に見出しの行を置く**（B-60 設計 6章 規則12）。
  // 取れなかった回にも置く — どのタブからもログアウトに届く。結末の出し分けは下の
  // `suggestionOutcome` のまま変えず、見出しの行で包むだけである。
  return (
    <>
      <ScreenHeader title={HEADING} onOpenSettings={onOpenSettings} />
      {suggestionOutcome()}
    </>
  );

  function suggestionOutcome() {
    if (suggestion.outcome === 'loading') return <p>{LOADING_NOTICE}</p>;

    // **出せない回は、提案の枝から先に分ける**（B-49c / 規則1〜6）。どちらも 200 で届く結末で
    // あり、失敗（S-6）にも「まだ提案が無い」（S-8）にも畳まない — 畳むと、利用者が次に何を
    // できるか（在庫を足す／待つ／求め直す）が画面から読み取れなくなる。
    if (suggestion.outcome === 'insufficientStockItems') {
      return <InsufficientStockItemsNotice onGoToPantry={onGoToPantry} />;
    }
    if (suggestion.outcome === 'generationLimitReached') return <GenerationLimitReachedNotice />;

    // **送っている間も、失敗した回も、渡された提案のカードを消さない**（S-5 / S-6 / D-6）。
    // 門が `suggestion` を差し替えるまでは、そのまま描き続ける。
    return (
      <div>
        <SuggestionBody suggestion={suggestion} today={today} onOpenMeal={onOpenMeal} />
        <RequestNewMealsControl
          pantryChanged={suggestion.outcome === 'suggested' && suggestion.pantryChanged}
          requesting={requestingNewMeals}
          failed={newMealsFailed}
          offline={offline}
          onRequestNewMeals={onRequestNewMeals}
        />
      </div>
    );
  }
}
