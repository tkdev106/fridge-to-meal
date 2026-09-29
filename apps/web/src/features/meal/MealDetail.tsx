/**
 * 献立詳細（B-53）。`docs/screen-design.md` 第4章に当たる。
 *
 * ここは `MealDetailIngredients.ts` と `CookingRecordFailureNotice.ts` を読むだけの薄い層である
 * （先行 `MealsTab.tsx`）— 材料の並びも印も、断りの読み分けも持たない。**出し分けそのもの**
 * （結末のどれを描くか・注意表示を何回出すか）は切り出せないので、
 * `apps/web/test/features/meal/MealDetail.test.tsx` が描いて確かめる（ADR-052）。
 *
 * 反対に、**日本語はここにしか置かない**（先行 `MealsTab.tsx`）。**文言はすべて仮である**
 * （同書 冒頭・論点3）。
 *
 * **表示は生成時のまま不変である**（FR-30 / C-3）— 献立の中身に手を入れる操作を1つも置かない。
 * **充足だけは開いた時点の在庫で算出されたもの**であり（FR-32 / ADR-009）、取り直すのは門の
 * 持ち分である。
 *
 * **記録済みの表示**（B-53b / FR-31 の後半）は、取れた献立の `cooked`（ADR-070）か、この画面で
 * 直前の記録が通ったこと（`recorded`）のどちらかで出す（ADR-070 結果3）。記録の操作は記録済みでも
 * 同じ位置に残る。
 */

import { mealDetailIngredientsOf } from './MealDetailIngredients.js';
import type { MealDetailIngredient } from './MealDetailIngredients.js';
import type { CookingRecordFailureNotice } from './CookingRecordFailureNotice.js';
import type { MealOutput } from '@fridge-to-meal/contract';
import type { MealOutcome } from '../../server/MealRequests.js';

/** 読み込み中の案内（**暫定**）。 */
const LOADING_NOTICE = '献立を読み込んでいます。';

/**
 * 取れなかったときの断り（**暫定**）。**原因を断定しない** — 継ぎ目は通信の失敗・401・500・
 * 壊れた応答をすべて1つの結末に畳んでおり（`MealRequests.ts`）、見分ける材料が無い。
 * **断られた回（`showMeal.mealNotFound`）も同じ文言である** — 画面から指せるのは自世帯の
 * 献立だけで（C-9）、利用者にできることが1つも無い（設計 7章）。
 */
const LOAD_FAILURE_NOTICE = '献立を読み込めませんでした。';

/** 閉じる操作（**仮**。画面設計 4章のワイヤーの「←」）。 */
const CLOSE_LABEL = '戻る';

/** 「これを作った」（FR-22 / 画面設計 4章。**仮の文言**）。 */
const COOKED_LABEL = 'これを作った';

/** 記録が通ったことの案内（**仮**）。`status` で1つだけ出し、閉じるまで残す。 */
const RECORDED_NOTICE = '作ったことを記録しました。';

/**
 * 記録済みの表示（仮の文言。B-53b / FR-31 の後半 / 画面設計 4章）。**記号と文字の両方で出す**
 * （NFR-17 — 色だけで示さない）。
 */
const COOKED_INDICATOR = '✓ 記録済み（作ったことがある献立）';

/**
 * 記録できなかったことの案内（**仮**）。**原因を断定しない** — 読みは
 * `cookingRecordFailureNoticeOf` の1つだけで、いまは案内も1つである。
 */
const RECORD_FAILURE_NOTICES: Record<CookingRecordFailureNotice, string> = {
  unavailable: 'いま記録できませんでした。',
};

/**
 * 材料に付く印（NFR-17。**仮の記号と文言**）。**記号と文字の両方**で区別し、色を1つも
 * 使わない。**調味料（`'none'`）には何も出さない** — 印が無いこと自体が「在庫と照合して
 * いない」という意味になる（C-16 / ADR-023）。
 */
const INGREDIENT_MARKS: Record<MealDetailIngredient['mark'], string | null> = {
  covered: '✓ あり',
  missing: '✗ 不足',
  none: null,
};

/** 材料の欄の見出し（**仮**）。 */
const INGREDIENTS_HEADING = '材料';

/** 手順の欄の見出し（**仮**）。 */
const STEPS_HEADING = '手順';

/**
 * 注意表示（FR-20）。**必ず出す**（規則7）— 一覧では末尾に1回だけだが（D-5）、
 * ここは手順と分量を実際に見る画面である。**FR-20 が例示した字面をそのまま採っただけで、
 * 確定ではない。**
 */
const CAUTION = 'AIによる提案です。分量・加熱時間はご自身で確認してください。';

/**
 * 画面が受け取る結末。取得の結末に「読み込み中」を1つ足しただけのものである
 * （先行 `MealsTabState` / `PantryListState`）。
 */
export type MealDetailState = { readonly outcome: 'loading' } | MealOutcome;

export type MealDetailProps = {
  meal: MealDetailState;
  /** 詳細を閉じる（一覧へ戻る）。**送っている間は効かない**（規則10）。 */
  onClose: () => void;
  /** 「これを作った」（FR-22 / B-51 の経路）。**確認ダイアログを出さない**（規則8）。 */
  onAddCookingRecord: () => void;
  /** 記録を送っている間か。 */
  recording: boolean;
  /** 直前の記録が断られた読み（`null` なら案内を出さない）。 */
  recordFailureNotice: CookingRecordFailureNotice | null;
  /** 直前の記録が通ったか（規則11・12。**開き直した回には出ない**）。 */
  recorded: boolean;
};

/** 材料1行。**印は `note`** で、名称と分量とは別の要素に置く（先行 `UsedIngredients`）。 */
function IngredientRow({ ingredient }: { ingredient: MealDetailIngredient }) {
  const mark = INGREDIENT_MARKS[ingredient.mark];

  return (
    <li>
      {/* 印を名称に混ぜない — 利用者が読む単位と画面が持つ単位がずれ、読み上げも
          名称で止まれなくなる（先行 `UsedIngredients`）。 */}
      {mark !== null && <span role="note">{mark}</span>}
      <span>{ingredient.name}</span>
      {/* **`null` のときは欄を出さない**（ADR-010）。空文字はそのまま空として出す。 */}
      {ingredient.amount !== null && <span>{ingredient.amount}</span>}
    </li>
  );
}

/** 献立の中身（材料・手順・注意表示）。**結末の分岐はここに置かない。** */
function MealBody({ meal }: { meal: MealOutput }) {
  const ingredients = mealDetailIngredientsOf(meal);

  return (
    <div>
      <h2>{meal.title}</h2>

      <h3>{INGREDIENTS_HEADING}</h3>
      <ul>
        {/* 同じ名称の材料が2件ある献立をサーバは禁じていないので、手順と同じく位置を
            混ぜた key にする（名称だけだと衝突する）。 */}
        {ingredients.map((ingredient, index) => (
          <IngredientRow key={`${index}-${ingredient.name}`} ingredient={ingredient} />
        ))}
      </ul>

      {/* **手順が0件でも断らない**（規則6）— 献立は取れており、断ると材料も読めなくなる。
          番号は `<ol>` に任せず自分で添える: 材料の並びと同じ `listitem` として観察でき、
          手順の番号が生成時のまま（FR-30）であることを画面の側で読める。 */}
      <h3>{STEPS_HEADING}</h3>
      <ul>
        {meal.steps.map((step, index) => (
          <li key={`${index}-${step}`}>
            <span>{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ul>

      {/* **必ず1回出す**（FR-20 / 規則7）。 */}
      <aside>{CAUTION}</aside>
    </div>
  );
}

export function MealDetail({
  meal,
  onClose,
  onAddCookingRecord,
  recording,
  recordFailureNotice,
  recorded,
}: MealDetailProps) {
  const shown = meal.outcome === 'shown' ? meal.meal : null;

  // **断られた回も取れなかった回と同じ案内に畳む**（設計 7章 / ADR-032 決定3）。
  const notice = meal.outcome === 'loading' ? LOADING_NOTICE : LOAD_FAILURE_NOTICE;

  return (
    <div>
      {/* **閉じる操作は取れなかった回にも残す** — 無いと詳細から戻る手段が1つも無くなる。
          **送っている間だけ効かない**（規則10）— 結末が届く前に閉じると、断りの案内が
          出ないまま成否が分からなくなる。 */}
      <button type="button" onClick={onClose} disabled={recording}>
        {CLOSE_LABEL}
      </button>

      {shown === null ? <p role="status">{notice}</p> : <MealBody meal={shown} />}

      {/* **記録の操作は取れた献立の枝にだけ置く**（規則9）— 押しても指す献立が画面に無い。
       **記録済みでも同じ位置に在る**（FR-31 の前半 / 画面設計 4章）。
       **確認ダイアログを出さない**（規則8）。 */}
      {shown !== null && (
        <>
          {/* **記録済みの表示は `cooked` か直前の記録の結末のどちらかで出し、重ねない**（規則8 /
           ADR-070 結果3）— 門は記録のあとに詳細を取り直さないので、`cooked` だけでは押した直後に
           出ない。**読み上げの割り込み（`status`）にしない**（規則10）— 利用者の操作の結末ではなく、
           開いた時点の事実である。記録が通った案内とは別に出す（規則11）。 */}
          {(shown.cooked || recorded) && <p>{COOKED_INDICATOR}</p>}
          {recorded && <p role="status">{RECORDED_NOTICE}</p>}
          {recordFailureNotice !== null && (
            <p role="status">{RECORD_FAILURE_NOTICES[recordFailureNotice]}</p>
          )}
          <button type="button" onClick={onAddCookingRecord} disabled={recording}>
            {COOKED_LABEL}
          </button>
        </>
      )}
    </div>
  );
}
