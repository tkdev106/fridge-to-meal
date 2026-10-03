/**
 * 献立詳細（B-53）。`docs/screen-design.md` 第4章に当たる。
 *
 * ここは `MealDetailIngredients.ts` と `CookingRecordFailureNotice.ts` を読むだけの薄い層である
 * （先行 `MealsTab.tsx`）— 材料の並びも印も、断りの読み分けも持たない。**出し分けそのもの**
 * （結末のどれを描くか・注意表示を何回出すか）は切り出せないので、
 * `apps/web/test/features/meal/MealDetail.test.tsx` が描いて確かめる（ADR-052）。
 *
 * 反対に、**日本語はここにしか置かない**（先行 `MealsTab.tsx`）。**デザインに描かれた文言は
 * `docs/design/` に揃えた**（B-63 / ADR-074）。描かれていない4つの案内（読み込み中・取れなかった・
 * 記録が通った・記録できなかった）は今のまま仮である。
 *
 * **見た目の値は `MealDetail.module.css` にだけ置き**、ここには class 名しか書かない
 * （ADR-055 決定1）。**PC（幅 1024px 以上）では材料と「手順・注意表示・記録の操作」の2列になる**
 * （B-63b）。そのための包みは役割を持たない `div` 2つで、**文書順（＝読み上げと Tab の順）は
 * SP と同じ**である（NFR-17 / ADR-076 結果1）。
 *
 * **表示は生成時のまま不変である**（FR-30 / C-3）— 献立の中身に手を入れる操作を1つも置かない。
 * **充足だけは開いた時点の在庫で算出されたもの**であり（FR-32 / ADR-009）、取り直すのは門の
 * 持ち分である。
 *
 * **記録済みの表示**（B-53b / FR-31 の後半）は、取れた献立の `cooked`（ADR-070）か、この画面で
 * 直前の記録が通ったこと（`recorded`）のどちらかで出す（ADR-070 結果3）。記録の操作は記録済みでも
 * 同じ位置に残る。
 */

import type { JSX, ReactNode } from 'react';
import { mealDetailIngredientsOf } from './MealDetailIngredients.js';
import type { MealDetailIngredient } from './MealDetailIngredients.js';
import type { CookingRecordFailureNotice } from './CookingRecordFailureNotice.js';
import type { MealOutput } from '@fridge-to-meal/contract';
import type { MealOutcome } from '../../server/MealRequests.js';
import { Icon } from '../../icons/Icon.js';
import styles from './MealDetail.module.css';
import { useBackHandler } from '../../backNavigation/BackHandler.js';

/** 読み込み中の案内（**暫定**。デザインに描かれていない）。 */
const LOADING_NOTICE = '献立を読み込んでいます。';

/**
 * 取れなかったときの断り（**暫定**）。**原因を断定しない** — 継ぎ目は通信の失敗・401・500・
 * 壊れた応答をすべて1つの結末に畳んでおり（`MealRequests.ts`）、見分ける材料が無い。
 * **断られた回（`showMeal.mealNotFound`）も同じ文言である** — 画面から指せるのは自世帯の
 * 献立だけで（C-9）、利用者にできることが1つも無い（設計 7章）。
 */
const LOAD_FAILURE_NOTICE = '献立を読み込めませんでした。';

/**
 * 閉じる操作の名前（B-63 規則1・5）。**見える文字は持たず**、`back` のアイコンだけを出す。
 * 名前は `aria-label` が運ぶ（原本 `MealDetail`）。
 */
const CLOSE_LABEL = '戻る';

/** 記録の操作（FR-22 / 原本 `MealDetail`）。 */
const COOKED_LABEL = '作った';

/** 記録が通ったことの案内（**仮**。デザインに描かれていない）。`status` で1つだけ出し、閉じるまで残す。 */
const RECORDED_NOTICE = '作ったことを記録しました。';

/**
 * 記録済みの表示（B-53b / FR-31 の後半 / 原本 `MealDetail` cooked）。チェックのアイコン（飾り）と
 * **文字の両方で出す**（NFR-17 — 色だけで示さない）。
 */
const COOKED_INDICATOR = '作ったことがあります';

/**
 * 記録できなかったことの案内（**仮**）。**原因を断定しない** — 読みは
 * `cookingRecordFailureNoticeOf` の1つだけで、いまは案内も1つである。
 */
const RECORD_FAILURE_NOTICES: Record<CookingRecordFailureNotice, string> = {
  unavailable: 'いま記録できませんでした。',
};

/**
 * 主材料の印（NFR-17 / B-63 規則3・4）。**アイコン（飾り）と文字（`note`）の両方**で区別する。
 * 色（緑・赤）は3つ目の手がかりで、色だけに頼らない。
 *
 * - 賄える … チェックのアイコン。デザインに見える文字は無いので、**`note` の文字は読み上げに
 *   だけ渡す**（`visuallyHidden`）。無いと、調味料（印なし）と読み上げで聞き分けられない
 * - 不足 … × のアイコンと、行末に見える文字 `不足`
 *
 * **調味料（`'none'`）はここに無い** — 区切り線の下に印もアイコンも `note` も無しで並べる。
 * 印が無いこと自体が「在庫と照合していない」という意味になる（C-16 / ADR-023）。
 */
const MAIN_MARKS = {
  covered: {
    icon: 'check',
    iconClass: styles.covered,
    note: 'あり',
    noteClass: styles.visuallyHidden,
  },
  missing: { icon: 'x', iconClass: styles.missing, note: '不足', noteClass: styles.missingNote },
} as const;

/** 材料の欄の見出し。 */
const INGREDIENTS_HEADING = '材料';

/**
 * 材料の見出しの右に添える人数（原本 `MealDetail`）。**分量は2人分に固定**
 * （`docs/prompt-design.md` 第4章 規則2）。**見出しの名前には入れない**（B-63 規則2）。
 */
const SERVINGS = '2人分';

/** 手順の欄の見出し。 */
const STEPS_HEADING = '手順';

/**
 * 注意表示（FR-20 / 原本 `AiNotice`）。**必ず出す**（規則7）— 一覧では末尾に1回だけだが（D-5）、
 * ここは手順と分量を実際に見る画面である。
 */
const CAUTION = 'AI による提案です。分量・加熱時間等はご自身でご確認ください';

/**
 * 画面が受け取る結末。取得の結末に「読み込み中」を1つ足しただけのものである
 * （先行 `MealsTabState` / `PantryListState`）。
 */
export type MealDetailState = { readonly outcome: 'loading' } | MealOutcome;

export type MealDetailProps = {
  meal: MealDetailState;
  /** 詳細を閉じる（一覧へ戻る）。**送っている間は効かない**（規則10）。 */
  onClose: () => void;
  /** 「作った」（FR-22 / B-51 の経路）。**確認ダイアログを出さない**（規則8）。 */
  onAddCookingRecord: () => void;
  /** 記録を送っている間か。 */
  recording: boolean;
  /** 直前の記録が断られた読み（`null` なら案内を出さない）。 */
  recordFailureNotice: CookingRecordFailureNotice | null;
  /** 直前の記録が通ったか（規則11・12。**開き直した回には出ない**）。 */
  recorded: boolean;
  /** 接続が切れているか（B-70 / FR-41）。省略は `false`。 */
  offline?: boolean;
};

/**
 * 材料1行。**印は `note`** で、名称と分量とは別の要素に置く（先行 `UsedIngredients`）。
 * 印を名称に混ぜない — 利用者が読む単位と画面が持つ単位がずれ、読み上げも名称で止まれなくなる。
 */
function IngredientRow({ ingredient }: { ingredient: MealDetailIngredient }) {
  const mark = ingredient.mark === 'none' ? null : MAIN_MARKS[ingredient.mark];

  return (
    <li className={styles.ingredient}>
      <span className={mark === null ? styles.markIcon : `${styles.markIcon} ${mark.iconClass}`}>
        {mark !== null && <Icon name={mark.icon} size={20} />}
      </span>
      <span className={styles.ingredientName}>{ingredient.name}</span>
      {/* **`null` のときは欄を出さない**（ADR-010）。空文字はそのまま空として出す。 */}
      {ingredient.amount !== null && <span className={styles.amount}>{ingredient.amount}</span>}
      {mark !== null && (
        <span role="note" className={mark.noteClass}>
          {mark.note}
        </span>
      )}
    </li>
  );
}

/**
 * 材料の一覧1つ。同じ名称の材料が2件ある献立をサーバは禁じていないので、手順と同じく位置を
 * 混ぜた key にする（名称だけだと衝突する）。
 */
function IngredientList({ ingredients }: { ingredients: readonly MealDetailIngredient[] }) {
  return (
    <ul className={styles.ingredients}>
      {ingredients.map((ingredient, index) => (
        <IngredientRow key={`${index}-${ingredient.name}`} ingredient={ingredient} />
      ))}
    </ul>
  );
}

/**
 * 献立の中身（材料・手順・注意表示）。**結末の分岐はここに置かない。**
 * `children` は右の列の末尾に置く記録の操作の並びである（B-63b）。
 */
function MealBody({ meal, children }: { meal: MealOutput; children: ReactNode }) {
  // 並び（主材料が先・調味料が後）と印の判断は `mealDetailIngredientsOf` のまま（C-12）。
  // ここでは印の有無で2つの一覧に分けるだけである（B-63 規則6）。
  const ingredients = mealDetailIngredientsOf(meal);
  const mains = ingredients.filter((ingredient) => ingredient.mark !== 'none');
  const seasonings = ingredients.filter((ingredient) => ingredient.mark === 'none');

  return (
    <>
      <h1 className={styles.title}>{meal.title}</h1>

      {/* **包みは役割を持たない `div` にする**（B-63b）— 区分けの要素にすると、中の名前の無い
          `aside` が `complementary` の役割を失う。 */}
      <div className={styles.columns}>
        <section className={styles.ingredientsSection}>
          <div className={styles.ingredientsHeader}>
            <h2 className={styles.heading}>{INGREDIENTS_HEADING}</h2>
            <span className={styles.servings}>{SERVINGS}</span>
          </div>
          {mains.length > 0 && <IngredientList ingredients={mains} />}
          {/* **区切り線は両方が1件以上あるときだけ**（B-63 規則6）— 区切る相手が無いと、
            上か下に余計な線が出る。 */}
          {mains.length > 0 && seasonings.length > 0 && <hr className={styles.separator} />}
          {seasonings.length > 0 && <IngredientList ingredients={seasonings} />}
        </section>

        <div className={styles.mainColumn}>
          {/* **手順が0件でも断らない**（規則6）— 献立は取れており、断ると材料も読めなくなる。
          番号は `<ol>` に任せず自分で添える: 手順の番号が生成時のまま（FR-30）であることを
          画面の側で読める。 */}
          <section className={styles.stepsSection}>
            <h2 className={styles.heading}>{STEPS_HEADING}</h2>
            <ol className={styles.steps}>
              {meal.steps.map((step, index) => (
                <li key={`${index}-${step}`} className={styles.step}>
                  <span className={styles.stepNumber}>{index + 1}</span>
                  <span className={styles.stepText}>{step}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* **必ず1回出す**（FR-20 / 規則7）。共有の部品にはしない（B-63 規則9）。 */}
          <aside className={styles.caution}>
            <span className={styles.cautionIcon}>
              <Icon name="info" size={20} />
            </span>
            <span className={styles.cautionText}>{CAUTION}</span>
          </aside>

          {children}
        </div>
      </div>
    </>
  );
}

export function MealDetail({
  meal,
  onClose,
  onAddCookingRecord,
  recording,
  recordFailureNotice,
  recorded,
  offline = false,
}: MealDetailProps): JSX.Element {
  const shown = meal.outcome === 'shown' ? meal.meal : null;

  // 端末の戻るは「←」と同じ口で閉じる（B-75 規則1・2）。読み込み中も閉じられる。
  // **調理記録を送っている間は飲み込む**（規則6）— 「←」の `disabled={recording}` と同じ理由。
  useBackHandler(true, () => {
    if (!recording) onClose();
  });

  // **断られた回も取れなかった回と同じ案内に畳む**（設計 7章 / ADR-032 決定3）。
  const notice = meal.outcome === 'loading' ? LOADING_NOTICE : LOAD_FAILURE_NOTICE;

  return (
    <div className={styles.detail}>
      {/* **閉じる操作は取れなかった回にも残す** — 無いと詳細から戻る手段が1つも無くなる。
          **送っている間だけ効かない**（規則10）— 結末が届く前に閉じると、断りの案内が
          出ないまま成否が分からなくなる。見えるのはアイコンだけで、名前は `aria-label`。 */}
      <button
        type="button"
        className={styles.back}
        onClick={onClose}
        disabled={recording}
        aria-label={CLOSE_LABEL}
      >
        <Icon name="back" size={24} />
      </button>

      {shown === null ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : (
        <MealBody meal={shown}>
          {/* **記録の操作は取れた献立の枝にだけ置く**（規則9）— 押しても指す献立が画面に無い。
           **記録済みでも同じ位置に在る**（FR-31 の前半 / 画面設計 4章）。
           **確認ダイアログを出さない**（規則8）。 */}
          <div className={styles.actions}>
            {/* **記録済みの表示は `cooked` か直前の記録の結末のどちらかで出し、重ねない**（規則8 /
           ADR-070 結果3）— 門は記録のあとに詳細を取り直さないので、`cooked` だけでは押した直後に
           出ない。**読み上げの割り込み（`status`）にしない**（規則10）— 利用者の操作の結末ではなく、
           開いた時点の事実である。置き場は記録の操作の上（B-63 規則10）。 */}
            {(shown.cooked || recorded) && (
              <p className={styles.cookedIndicator}>
                <Icon name="check" size={20} />
                {COOKED_INDICATOR}
              </p>
            )}
            {/* 記録の結末の案内は、記録済みの表示と操作の間に置く（B-63 規則10）。 */}
            {recorded && (
              <p role="status" className={styles.notice}>
                {RECORDED_NOTICE}
              </p>
            )}
            {recordFailureNotice !== null && (
              <p role="status" className={styles.notice}>
                {RECORD_FAILURE_NOTICES[recordFailureNotice]}
              </p>
            )}
            {/* **接続が切れている間は押せない**（B-70 規則8）。上の「閉じる」は止めない（規則6）。 */}
            <button
              type="button"
              className={styles.cooked}
              onClick={onAddCookingRecord}
              disabled={recording || offline}
            >
              {COOKED_LABEL}
            </button>
          </div>
        </MealBody>
      )}
    </div>
  );
}
