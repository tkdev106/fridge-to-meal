/**
 * 在庫の編集の画面（B-55 設計 4章 / 5章 / 6章 規則1〜8・18・19）。
 * `docs/screen-design.md` 2章 の `pantry --> edit` に当たる。
 *
 * ここは `StockItemFormValues.ts` と `UpdateFailureNotice.ts` を読むだけの薄い層である。
 * 欄の初期値の作り方も、空欄をどう読み替えるかも、**断りからどの案内を選ぶかも持たない**
 * （設計 規則19 / ADR-032 決定3）— 判断を純粋関数に置くほうが速く、仮の文言にも jsdom にも
 * 依存しない。
 *
 * **登録の画面（`StockItemForm.tsx`）と分けてある**（設計 10章）。名称の欄・補完・保存2つ・
 * 登録の入力・断りの表がすべて登録固有であり、旗で分岐させると1つの画面が2つの役割を持つ。
 * **共有するのは判断の純粋関数だけである。**
 *
 * **保存の操作は1つである**（設計 規則5）— 編集は在庫品1件に閉じ、次の1件が無いので
 * 「保存してもう1件」（FR-08 は登録の話）を置かない。
 *
 * 反対に、**日本語はここにしか置かない**（設計 規則19 / B-12 設計 規則9）。見出し・欄の名前・
 * 置き文字・保存の名札は ADR-074 で確定した原本（`docs/design/src/IngredientForm.dc.html` の edit）
 * に揃えてある（B-65）。原本に無い断りと送信中の名札は従来の文言のままである。
 *
 * **見た目の値は `StockItemForm.module.css` にだけ置く**（B-65 設計 規則1 / ADR-055 決定1）—
 * 登録の画面と module を共有する（原本が1部品の add / edit であるため）。
 *
 * 更新の実行は引数で受け取る。**組み立てるのは `main.tsx` だけ**であり、この画面は基点も
 * `fetch` もトークンの取り出し方も知らない（設計 9章 / B-22 設計 規則1・4）。
 */

import type { ChangeEvent, FormEvent, JSX, MouseEvent } from 'react';
import { useState } from 'react';
import type { StockItemDto } from '@fridge-to-meal/contract';
import type { StockItemEditValues } from './StockItemFormValues.js';
import { stockItemEditValuesOf, updateStockItemInputOf } from './StockItemFormValues.js';
import type { UpdateFailureNotice } from './UpdateFailureNotice.js';
import { updateFailureNoticeOf } from './UpdateFailureNotice.js';
import type { UpdateStockItem } from '../../server/StockItemRequests.js';
import { Icon } from '../../icons/Icon.js';
import { AmountField } from './AmountField.js';
import { expiryDateLabelOf, remainingDaysLabelOf } from './ExpiryDateLabel.js';
import type { ExpirySection } from './PantrySections.js';
import { expirySectionOf } from './PantrySections.js';
import { remainingDaysOf } from './RemainingDays.js';
import styles from './StockItemForm.module.css';
import { useBackHandler } from '../../backNavigation/BackHandler.js';

/** 画面の見出し（B-65 規則2 / ADR-074）。名称は見出しにせず、食材名の位置に出す（規則9）。 */
const HEADING = '食材を編集';

/** 名称の位置の名前（B-65 規則9）。欄ではなく、変えられない文字の名前である。 */
const NAME_LABEL = '食材名';

/**
 * 欄の名前。**分量と期限には必須の印を付けない**（設計 規則3 / FR-13）— 空にして保存すれば
 * 「消す」を表す。任意であることは札 `任意`（`OPTIONAL_LABEL`）の文字で伝える（B-65 規則3）。
 * 献立に使うには札を付けない（B-76 規則16）。
 */
const FIELD_LABELS: Record<Exclude<keyof StockItemEditValues, 'amount'>, string> = {
  expiryDate: '期限',
  useForMeals: '献立に使う',
};

/** 任意の欄に添える札（B-65 規則3）。欄の名前の一部として読まれてよい。 */
const OPTIONAL_LABEL = '任意';

/** 期限が空のときに箱に出す文字（B-65 規則6）。 */
const EXPIRY_DATE_PLACEHOLDER = '日付を選ぶ';

/** 保存の操作の名札。**1つである**（設計 規則5 / B-65 規則11）。 */
const SAVE_LABEL = '保存';

/**
 * 保存せずに閉じる操作の名前（設計 規則7・8 / B-65 規則2）。**見える文字は持たず**、`back` の
 * アイコンだけを出す — 名前は `aria-label` で読ませる（先行 `MealDetail.tsx`）。
 */
const CLOSE_LABEL = '戻る';

/**
 * PC のパネルで保存せずに閉じる操作の見える文字（B-65b 設計 規則9 / 原本 `IngredientForm` の `pc`）。
 * 文言はデザインが正である（ADR-074 決定1）。
 */
const CLOSE_TEXT = '閉じる';

/**
 * 残日数の色を帯で選ぶ（B-65 規則8）。帯の決め方は一覧と同じ `expirySectionOf` に任せる。
 * **色だけに頼らない** — 文字（`remainingDaysLabelOf`）が常に出る（NFR-17）。
 */
const REMAINING_DAYS_CLASSES: Record<ExpirySection, string | undefined> = {
  urgent: styles.remainingDaysUrgent,
  soon: styles.remainingDaysSoon,
  rest: styles.remainingDaysRest,
};

/**
 * 送っている間の名札。受け付けないこと（設計 規則7）を、操作の見た目だけでなく文字でも伝える。
 */
const SENDING_LABEL = '保存しています…';

/**
 * 保存できなかったときの案内。**断りの `rule` から選ぶ**（ADR-032 決定3）— 選ぶ判断は
 * `UpdateFailureNotice.ts` にあり、ここはその識別子に文言を当てるだけである（設計 規則19）。
 *
 * **`gone` は削除の側に無い案内である**（**ADR-050 結果5** / 設計 規則10）— 消えた相手に
 * 書き戻せない以上、利用者に伝えるべきことがある。**画面は閉じない。**
 *
 * **直せる誤りだけ、どこを直すかを言う。** `unavailable` は原因を断定しない — サーバ側の不備も
 * 通信の失敗もここに落ちており、見分ける材料が無い（先行 `StockItemForm.tsx` と同じ構え）。
 */
const NOTICES: Record<UpdateFailureNotice, string> = {
  gone: 'この在庫はもう見つかりませんでした。',
  expiryDateInvalid: '期限を確かめてください。',
  unavailable: '保存できませんでした。入力はそのままです。もう一度お試しください。',
};

export type StockItemEditFormProps = {
  /** 編集する在庫品1件。**行から受け取る**（設計 規則17）。 */
  stockItem: StockItemDto;
  /** 更新の実行（設計 5章）。**結末で返り、例外を投げない**（`server/README.md`）。 */
  onUpdate: UpdateStockItem;
  /** 一覧へ戻す（設計 規則7・8）。**通った回と、保存せずに閉じた回に呼ぶ。** */
  onClose: () => void;
  /** 接続が切れているか（B-70 / FR-41）。省略は `false`。 */
  offline?: boolean;
  /** 残日数を数える基準日（YYYY-MM-DD）。呼び出し側が渡す。ここで new Date() を読まない */
  today: string;
};

export function StockItemEditForm({
  stockItem,
  onUpdate,
  onClose,
  offline = false,
  today,
}: StockItemEditFormProps): JSX.Element {
  // 開いた直後の欄はその行の値である（設計 規則2 / NFR-15）。**取り直した一覧で書き換えない**
  // （同 規則17）ので、初期値としてだけ読む — 編集の対象は行から受け取った1件である。
  const [values, setValues] = useState<StockItemEditValues>(() => stockItemEditValuesOf(stockItem));
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<UpdateFailureNotice | null>(null);

  // 端末の戻るは「←」と同じ口で閉じる（B-75 規則1・2）。**送っている間は飲み込む**（規則6）。
  useBackHandler(true, () => {
    if (!sending) onClose();
  });

  function changeField(field: 'expiryDate') {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setValues((previous) => ({ ...previous, [field]: event.target.value }));
    };
  }

  /**
   * 保存の本体。**値が今と同じでも送る**（設計 規則6）— 差分を見て止めると、送るかどうかの
   * 判断が画面とサーバの2か所に増える。**作れない入力は無い**（`updateStockItemInputOf` は
   * `null` を返さない）ので、止めるのは「送っている間」だけである（規則7）。
   */
  async function save() {
    // **接続が切れている間も止める**（B-70 規則10）。Enter もここで止まり、入力は消さない。
    if (sending || offline) return;

    setSending(true);
    setNotice(null);
    // **`catch` を置かない。** 口は結末で返し投げない（`server/README.md`）ので、握り潰すと
    // 本当の不具合が案内に化ける。`finally` だけは残す — 投げられた回に操作が戻らなくなるため。
    try {
      const selectedNotice = updateFailureNoticeOf(
        await onUpdate(stockItem.id, updateStockItemInputOf(values)),
      );
      setNotice(selectedNotice);

      // **通った回だけ閉じる**（設計 規則8 / 規則10）— 断られた回も失敗した回も閉じず、
      // 入力も消さない（NFR-15）。`update.notFound` もここに含まれる（ADR-050 結果5）。
      if (selectedNotice === null) onClose();
    } finally {
      setSending(false);
    }
  }

  // 残日数は期限の欄の**今の値**から数える（B-65 規則8）。空・壊れた値なら `null` で、出さない。
  const remainingDays = remainingDaysOf(values.expiryDate, today);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await save();
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.header}>
        {/* 閉じる操作は見出しの行、つまり**画面のいちばん上**に置く（先行 `StockItemForm.tsx`）。
            **`type="submit"` にしない** — 押した回に保存が走ってしまう。
            **送っている間は押せない**（設計 規則7）— 結末が届く前に閉じると、断りの案内が
            出ないまま画面が消え、打った入力も捨てられる。利用者は保存できたと思い込む。
            見えるのはアイコンだけで、名前は `aria-label`（B-65 規則2）。 */}
        <button
          type="button"
          className={styles.back}
          disabled={sending}
          onClick={onClose}
          aria-label={CLOSE_LABEL}
        >
          <Icon name="back" size={24} />
        </button>

        <h1 className={styles.heading}>{HEADING}</h1>

        {/* `閉じる` は `戻る` と同じ「保存せずに閉じる」（B-65b 設計 規則9）。SP は `戻る`（アイコン）、
            PC は `閉じる`（下線の文字）だけを CSS で見せる — 幅で ARIA を変えられないので、木には
            2つとも置く（ADR-076 結果2 / 前提3）。`type="submit"` にしない・送っている間は押せない
            理由は `戻る` と同じである。 */}
        <button type="button" className={styles.close} disabled={sending} onClick={onClose}>
          {CLOSE_TEXT}
        </button>
      </div>

      <div className={styles.fields}>
        {/* 名称は**出すが変えられない**（設計 規則1 / `UpdateStockItemInput` に名称が無い / B-65
            規則9）— 何を編集しているか分からないまま打たせない。欄にしないのは、送れない値を
            編集させる形になるためである。 */}
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{NAME_LABEL}</span>
          <span className={styles.fixedName}>{stockItem.name}</span>
        </div>

        {/* 開いた直後の焦点は分量の欄である（設計 規則18 / NFR-15）— 編集できる先頭の欄であり、
            編集の画面は開くまで木に無い（`PantryTab`）ので mount のときに当てれば足りる。
            **効果と `ref` を置かない。** */}
        <AmountField
          autoFocus
          values={values.amount}
          onChange={(amount) => setValues((previous) => ({ ...previous, amount }))}
        />

        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            <span>{FIELD_LABELS.expiryDate}</span>
            <span className={styles.optional}>{OPTIONAL_LABEL}</span>
          </span>
          {/* 見える箱の上に素の日付欄を透明に重ねる（B-65 規則6）。箱の文字（日付と残日数）は
              値から作り、`<label>` の中に置くので欄の名前の後ろに続いて読まれる（NFR-17）。 */}
          <span className={styles.dateBox}>
            {values.expiryDate === '' ? (
              <span className={styles.datePlaceholder}>{EXPIRY_DATE_PLACEHOLDER}</span>
            ) : (
              <span>{expiryDateLabelOf(values.expiryDate)}</span>
            )}
            {remainingDays !== null && (
              <span
                className={`${styles.remainingDays} ${REMAINING_DAYS_CLASSES[expirySectionOf(remainingDays)] ?? ''}`}
              >
                {remainingDaysLabelOf(remainingDays)}
              </span>
            )}
            {/* YYYY-MM-DD を返す日付の欄（先行 `StockItemForm.tsx`）。書式の検めは置かない
                （設計 規則4）— 正規化と検めはサーバの1か所に残す。 */}
            <input
              type="date"
              className={styles.dateInput}
              value={values.expiryDate}
              onChange={changeField('expiryDate')}
              onClick={openDatePicker}
            />
          </span>
        </label>

        {/* 献立に使うかどうか（B-76 規則13〜16）。欄群の最後に置き、`<label>` で包んで行全体を
            押せる範囲にする。**札 `任意` を付けない** — 真偽値なので空という状態が無い。 */}
        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={values.useForMeals}
            onChange={(event) => {
              const useForMeals = event.target.checked;
              setValues((previous) => ({ ...previous, useForMeals }));
            }}
          />
          <span>{FIELD_LABELS.useForMeals}</span>
        </label>
      </div>

      {notice !== null && <p className={styles.notice}>{NOTICES[notice]}</p>}

      {/* 保存は画面の下半分に置く（NFR-14 / B-65 規則12）。**1つだけである**（設計 規則5）。
          `<form>` の送信にしてあるので、欄で Enter を打った回もここに落ちる。 */}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={sending || offline}>
          {sending ? SENDING_LABEL : SAVE_LABEL}
        </button>
      </div>
    </form>
  );
}

/**
 * 日付の欄を押したら日付の選択を開く（B-65 規則6。先行 `StockItemForm.tsx` と同じ扱い）。
 * **`showPicker` が無い・投げる環境では素の振る舞いに任せる** — 投げても例外を外へ出さない。
 */
function openDatePicker(event: MouseEvent<HTMLInputElement>): void {
  const input = event.currentTarget;
  if (typeof input.showPicker !== 'function') return;

  try {
    input.showPicker();
  } catch {
    // 開けない環境（利用者の操作と見なされない・iframe の制限など）は素の欄の振る舞いに任せる。
  }
}
