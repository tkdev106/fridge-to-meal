/**
 * 在庫登録の画面（B-12 設計 4章 / 6章 規則7〜12、B-39 設計 6章 規則8〜13）。
 * `docs/screen-design.md` 第6章に当たる。
 *
 * ここは `StockItemFormValues.ts` と `RegisterFailureNotice.ts` を読むだけの薄い層である。
 * 何を保存できるかの判断も、空欄をどう読み替えるかも、**断りからどの案内を選ぶかも持たない**
 * （規則9 / B-24）— **描いて確かめられるようになった今も**（ADR-052）、判断は純粋関数に
 * 置くほうが速く、仮の文言にも jsdom にも依存しない。
 *
 * **保存の操作は2つである**（B-39 設計 規則8）。**B-12 設計 規則5「保存の操作は1つ」は
 * ここで置き換わった** — 規則5 の理由は「閉じる先が無い」ことであり、登録が独立した画面に
 * なった（`PantryTab`）時点でその前提が消えたためである。2つは**同じ口を同じ入力で呼び**、
 * 違うのは通ったあとだけである（規則9）。
 *
 * 反対に、**日本語はここにしか置かない**（B-12 設計 規則9）。見出し・欄の名前・置き文字・
 * 名前が空の断り・保存の名札は ADR-074 で確定した原本（`docs/design/src/IngredientForm.dc.html`
 * の add）に揃えてある（B-65）。原本に無い断りと送信中の名札は従来の文言のままである。
 *
 * **見た目の値は `StockItemForm.module.css` にだけ置く**（B-65 設計 規則1 / ADR-055 決定1）。
 * 編集の画面（`StockItemEditForm.tsx`）と同じ module を共有する — 原本が1部品の add / edit である。
 *
 * 登録の実行は引数で受け取る。**組み立てるのは `main.tsx` だけ**であり、この画面は基点も
 * `fetch` もトークンの取り出し方も知らない（B-24 / B-22 設計 規則1・4）。
 */

import type { ChangeEvent, FormEvent, MouseEvent } from 'react';
import { useId, useState } from 'react';
import type { IngredientNamesState } from './IngredientNameOptions.js';
import { ingredientNameOptionsOf } from './IngredientNameOptions.js';
import { IngredientNameCombobox } from './IngredientNameCombobox.js';
import type { RegisterFailureNotice } from './RegisterFailureNotice.js';
import { registerFailureNoticeOf } from './RegisterFailureNotice.js';
import type { StockItemFormValues } from './StockItemFormValues.js';
import { EMPTY_STOCK_ITEM_FORM, registerStockItemInputOf } from './StockItemFormValues.js';
import type { RegisterStockItem } from '../../server/StockItemRequests.js';
import { Icon } from '../../icons/Icon.js';
import { expiryDateLabelOf } from './ExpiryDateLabel.js';
import styles from './StockItemForm.module.css';
import { useBackHandler } from '../../backNavigation/BackHandler.js';

/** 画面の見出し（B-65 規則2 / ADR-074）。 */
const HEADING = '食材を登録';

/**
 * 欄の名前。**分量と期限には必須の印を付けない**（B-12 設計 規則11 / FR-13）— 空のまま
 * 保存できる。任意であることは名前の横の札 `任意`（`OPTIONAL_LABEL`）の文字で伝える
 * （B-65 規則3）。食材名と献立に使う（B-76 規則16）には札を付けない。
 */
const FIELD_LABELS: Record<keyof StockItemFormValues, string> = {
  name: '食材名',
  amount: '分量',
  expiryDate: '期限',
  useForMeals: '献立に使う',
};

/** 任意の欄に添える札（B-65 規則3）。欄の名前の一部として読まれてよい。 */
const OPTIONAL_LABEL = '任意';

/** 分量の置き文字（B-65 規則5）。値は自由文字列のまま（ADR-010）。 */
const AMOUNT_PLACEHOLDER = '例: 300g';

/** 期限が空のときに箱に出す文字（B-65 規則6）。 */
const EXPIRY_DATE_PLACEHOLDER = '日付を選ぶ';

/**
 * 保存が通ったあとにどうするか（B-39 設計 規則9）。**保存の操作2つの違いはこれだけである** —
 * 送る中身も、断られた回・失敗した回の扱いも同じである（規則10）。
 *
 * 送っている間は、どちらの操作で送ったかを表す値としても使う（下の `sendingFor`）。
 */
type AfterSave = 'stay' | 'close';

/**
 * 保存の操作の名札。**2つあり、前に出すのが「保存してもう1件」である**（B-39 設計 規則8 /
 * FR-08 / `docs/screen-design.md` 6章 決めたこと「既定のボタンは保存してもう1件」）。
 */
const SAVE_LABELS: Record<AfterSave, string> = {
  stay: '保存してもう1件',
  close: '保存して閉じる',
};

/**
 * 保存せずに閉じる操作の名前（B-39 設計 規則7 / B-65 規則2）。**見える文字は持たず**、`back` の
 * アイコンだけを出す — 名前は `aria-label` で読ませる（先行 `MealDetail.tsx`）。
 */
const CLOSE_LABEL = '戻る';

/**
 * PC のパネルで保存せずに閉じる操作の見える文字（B-65b 設計 規則9 / 原本 `IngredientForm` の `pc`）。
 * 文言はデザインが正である（ADR-074 決定1）。
 */
const CLOSE_TEXT = '閉じる';

/**
 * 送っている間の名札。受け付けないこと（B-39 設計 規則11 / B-12 設計 規則8）を、操作の
 * 見た目だけでなく文字でも伝える。**押した側の操作にだけ出す** — どちらも効かないが、
 * 送ったのは片方であり、押していない側に進行を語らせると何が起きているか読めなくなる。
 */
const SENDING_LABEL = '保存しています…';

/**
 * 保存できなかったときの案内。**断りの `rule` から選ぶ**（ADR-032 決定3 / B-24）— 選ぶ判断は
 * `RegisterFailureNotice.ts` にあり、ここはその識別子に文言を当てるだけである（B-12 設計 規則9）。
 *
 * **書き込みの失敗の断り方は、要件にも画面設計にも根拠が無い**（NFR-07 と
 * `docs/screen-design.md` 9章「生成の失敗」は LLM の応答の話であって、ここには及ばない）。
 * 入力を残すのは打ち直しが1件10秒（NFR-15）に収まらないため、自動で送り直さないのは
 * 同名でも統合されない在庫品が2件残るため（ADR-007）。**それ以外は実装上の取り決めである。**
 *
 * **直せる誤りだけ、どこを直すかを言う。** `unavailable` は原因を断定しない — サーバ側の不備も
 * 通信の失敗もここに落ちており、見分ける材料が無い（`PantryList` の断りと同じ構え）。
 */
const NOTICES: Record<RegisterFailureNotice, string> = {
  nameEmpty: '食材名を入れてください',
  expiryDateInvalid: '期限を確かめてください。',
  unavailable: '保存できませんでした。入力はそのままです。もう一度お試しください。',
};

export type StockItemFormProps = {
  /**
   * 登録の実行（B-24）。**結末で返り、例外を投げない**（`server/README.md` / B-22 設計 規則9）。
   * 送り先も認証もこの画面は知らない。
   */
  onRegister: RegisterStockItem;
  /**
   * 一覧へ戻す（B-39 設計 5章 / 規則7・9）。**保存せずに閉じる**「←」を押した回と、
   * 「保存して閉じる」が**通った**回に呼ぶ。
   *
   * 呼ぶ相手が一覧と登録の出し分けを持っている（`PantryTab`）。この画面は戻った先が何かを
   * 知らず、閉じたあとに自分が木から外れることも前提にしない。
   *
   * **断られた回と失敗した回は呼ばない**（規則10）— 送り直せる画面を残す必要がある。
   */
  onClose: () => void;
  /**
   * 補完の元になる食材名の3値（FR-02 / B-50c）。**組み立てるのは `main.tsx` だけ**であり、
   * 取りに行くのは門（`App.tsx`）である。
   *
   * **取れなかった回も「まだ取れていない」回も、この画面の振る舞いは変わらない**
   * （設計 規則4）— 補完が出ないだけで、欄も保存の2つもそのまま効く（FR-03）。
   * どちらを空の列に倒すかの判断は `ingredientNameOptionsOf` が1か所で持つ。
   */
  ingredientNames: IngredientNamesState;
  /** 接続が切れているか（B-70 / FR-41）。省略は `false`。 */
  offline?: boolean;
};

export function StockItemForm({
  onRegister,
  onClose,
  ingredientNames,
  offline = false,
}: StockItemFormProps) {
  // 食材名の見出しと欄を結ぶ識別子。**固定の文字列にしない**（B-50c 設計 規則8）— 同じ画面が
  // 2つ描かれた回に `id` が衝突し、片方の見出しがもう片方の欄を指す。
  const ingredientNameFieldId = useId();
  const ingredientNameOptions = ingredientNameOptionsOf(ingredientNames);
  const [values, setValues] = useState<StockItemFormValues>(EMPTY_STOCK_ITEM_FORM);
  // 送っている間は、どちらの保存で送ったかを持つ（null なら送っていない）。**どちらも
  // 効かなくするのはこの値1つで足りる**（規則11）。
  const [sendingFor, setSendingFor] = useState<AfterSave | null>(null);
  const [notice, setNotice] = useState<RegisterFailureNotice | null>(null);

  const registerInput = registerStockItemInputOf(values);
  const sending = sendingFor !== null;
  // 保存の2つに当てる条件。**「←」には `sending` だけが当たる**（下の閉じる操作の注記）—
  // 食材名が空でも「捨てて戻る」は効かねばならないので、`registerInput === null` は含めない。
  // **接続が切れている間も保存の2つと Enter を止める**（B-70 規則9）。入力は消さない。
  const saveDisabled = registerInput === null || sending || offline;

  // 端末の戻るは「←」と同じ口で閉じる（B-75 規則1・2）。**送っている間は飲み込む**（規則6）—
  // 「←」と同じく、結末が届く前に閉じると断りの案内が出ないまま入力が捨てられる。
  useBackHandler(true, () => {
    if (!sending) onClose();
  });

  function changeField(field: 'amount' | 'expiryDate') {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setValues((previous) => ({ ...previous, [field]: event.target.value }));
    };
  }

  // 名前が空の断りだけは食材名の欄の直下に出し、ほかの断りは欄群の後に出す（B-65 規則10）。
  // **出す段落は常に1つまで**であることは変えない — 置き場が2つに分かれても、出るのは片方だけ。
  const nameNotice = notice === 'nameEmpty' ? notice : null;
  const otherNotice = notice !== null && notice !== 'nameEmpty' ? notice : null;

  /**
   * 保存の本体。**2つの操作が共有する**（規則9）— 送る中身も、通ったかどうかの読みも1か所に
   * 保つ。`afterSave` が効くのは**通ったあとだけ**である。
   */
  async function save(afterSave: AfterSave) {
    // 名称から登録の入力が作れないときは保存を効かせない（B-12 設計 規則2 / 規則11）。送って
    // いる間も同じ — 二重に送ると、同名でも統合されない在庫品が2件残る（ADR-007）。
    if (saveDisabled) return;

    setSendingFor(afterSave);
    setNotice(null);
    // **`catch` を置かない。** 口は結末で返し投げない（`server/README.md`）ので、握り潰すと
    // 本当の不具合が案内に化ける。`finally` だけは残す — 投げられた回に操作が戻らなくなるため。
    try {
      const selectedNotice = registerFailureNoticeOf(await onRegister(registerInput));
      setNotice(selectedNotice);

      // 断られた回と失敗した回はどちらも閉じず、入力も消さない（規則10 / NFR-15 / ADR-007）。
      if (selectedNotice !== null) return;

      // 通ったときだけ分かれる（規則9 / FR-08）。「もう1件」は欄を開いた直後の値に戻して留まり、
      // 「閉じる」は一覧へ戻す。**一覧を取り直すのは門である**（規則12 / B-24）。
      if (afterSave === 'close') onClose();
      else setValues(EMPTY_STOCK_ITEM_FORM);
    } finally {
      setSendingFor(null);
    }
  }

  /**
   * `<form>` の送信。**既定の保存は「保存してもう1件」である**（規則8 /
   * `docs/screen-design.md` 6章 決めたこと）— 欄で Enter を打った回もこちらに落ちる。
   */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await save('stay');
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.header}>
        {/* 閉じる操作は見出しの行、つまり**画面のいちばん上**に置く（B-39 設計 規則7・8 /
            `docs/screen-design.md` 6章のワイヤー）。**`type="submit"` にしない** — 押した回に
            保存が走ってしまい、「捨てて戻る」ではなくなる。
            **確認は出さない**（規則7 / 要件 5.5）。登録し直すコストが低い — 在庫品の削除は確認を挟む
            ようになった（B-69）が、あちらは保存済みの1件を消すので取り消しが効かない。
            **送っている間は押せない**（規則10 / 規則11）。「送った1件はもう届いているので、閉じるのを
            止めても取り消せない」は**通った回にしか成り立たない** — 断られた回と失敗した回は、
            結末が届く前に閉じると**案内が出ないまま画面が消え、打った入力も捨てられる。**
            利用者は保存できたと思い込む。規則10 が守ろうとしているものが、この経路だけ抜ける。
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
        {/* 食材名の欄・補完の一覧・名前が空の断りを1つの塊にする（断りを欄の直下に置くため）。 */}
        <div className={styles.nameField}>
          {/* 欄と直下の一覧は部品1つに閉じる（B-66）。**欄の名前はここに残す** — `htmlFor` で
              部品の欄に結ぶ。 */}
          <label className={styles.fieldLabel} htmlFor={ingredientNameFieldId}>
            {FIELD_LABELS.name}
          </label>
          {/* 開いた直後はこの欄に焦点が当たる（B-39 設計 規則13 / B-12 設計 規則10b / NFR-15）。
              登録の画面は開くまで木に無い（`PantryTab`）ので、mount のときに当てれば「開いた
              直後」と一致する。**効果と `ref` を置かない** — 描き直しのたびに当て直す条件を
              自分で持つことになる。
              補完は欄の直下の一覧に出る（FR-02 / B-66）。絞り込みとキー操作は部品が持ち、
              **打った文字をそのまま登録できる**（FR-03）— 部品が値を書き換えるのは選んだときだけ。 */}
          <IngredientNameCombobox
            id={ingredientNameFieldId}
            autoFocus
            value={values.name}
            onChange={(name) => setValues((previous) => ({ ...previous, name }))}
            ingredientNames={ingredientNameOptions}
            invalid={nameNotice !== null}
          />

          {/* 名前が空の断りは**欄の直下**に出す（B-65 規則10）— どこを直すかが位置で読める。
              `!` は飾りなので読み上げから外す。 */}
          {nameNotice !== null && (
            <p className={styles.notice}>
              <span className={styles.noticeMark} aria-hidden="true">
                !
              </span>{' '}
              {NOTICES[nameNotice]}
            </p>
          )}
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            <span>{FIELD_LABELS.amount}</span>
            <span className={styles.optional}>{OPTIONAL_LABEL}</span>
          </span>
          {/* 分量は自由文字列。数値と単位に分けない（ADR-010）。 */}
          <input
            className={styles.input}
            placeholder={AMOUNT_PLACEHOLDER}
            value={values.amount}
            onChange={changeField('amount')}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            <span>{FIELD_LABELS.expiryDate}</span>
            <span className={styles.optional}>{OPTIONAL_LABEL}</span>
          </span>
          {/* 見える箱の上に素の日付欄を透明に重ねる（B-65 規則6）。箱の文字は値から作り、
              `<label>` の中に置くので欄の名前の後ろに続いて読まれる。**登録の画面には残日数を
              出さない**（規則8 / 設計 10章）。 */}
          <span className={styles.dateBox}>
            {values.expiryDate === '' ? (
              <span className={styles.datePlaceholder}>{EXPIRY_DATE_PLACEHOLDER}</span>
            ) : (
              <span>{expiryDateLabelOf(values.expiryDate)}</span>
            )}
            {/* YYYY-MM-DD を返す日付の欄（B-12 設計 10章）。書式の検めは置かない（B-12 設計 規則4）。 */}
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

      {otherNotice !== null && <p className={styles.notice}>{NOTICES[otherNotice]}</p>}

      {/* 保存の操作は画面の下半分に置く（B-12 設計 規則10 / NFR-14 / B-65 規則12）。**2つあり、
          前に出すのが「保存してもう1件」である**（規則8）。前のほうを `<form>` の送信にしてあるのは、
          そちらが既定の操作だからである（`docs/screen-design.md` 6章 決めたこと）。 */}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={saveDisabled}>
          {sendingFor === 'stay' ? SENDING_LABEL : SAVE_LABELS.stay}
        </button>

        <button
          type="button"
          className={styles.secondary}
          disabled={saveDisabled}
          onClick={() => void save('close')}
        >
          {sendingFor === 'close' ? SENDING_LABEL : SAVE_LABELS.close}
        </button>
      </div>
    </form>
  );
}

/**
 * 日付の欄を押したら日付の選択を開く（B-65 規則6）。重ねた欄は透明なので、どこを押しても
 * 選択が開くようにする。**`showPicker` が無い・投げる環境では素の振る舞いに任せる** — 投げても
 * 例外を外へ出さない（利用者の打てる手が無い）。
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
