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
 * 反対に、**日本語はここにしか置かない**（設計 規則19 / B-12 設計 規則9）。文言も配色も
 * 未確定であり（`docs/screen-design.md` 論点3）、以下の日本語は仮のものである。
 *
 * 更新の実行は引数で受け取る。**組み立てるのは `main.tsx` だけ**であり、この画面は基点も
 * `fetch` もトークンの取り出し方も知らない（設計 9章 / B-22 設計 規則1・4）。
 */

import type { ChangeEvent, FormEvent, JSX } from 'react';
import { useState } from 'react';
import type { StockItemDto } from '@fridge-to-meal/contract';
import type { StockItemEditValues } from './StockItemFormValues.js';
import { stockItemEditValuesOf, updateStockItemInputOf } from './StockItemFormValues.js';
import type { UpdateFailureNotice } from './UpdateFailureNotice.js';
import { updateFailureNoticeOf } from './UpdateFailureNotice.js';
import type { UpdateStockItem } from '../../server/StockItemRequests.js';

/**
 * 欄の見出し。**どちらにも必須の印を付けない**（設計 規則3 / FR-13）— 空にして保存すれば
 * 「消す」を表す。名称の欄は無い（設計 規則1）。
 */
const FIELD_LABELS: Record<keyof StockItemEditValues, string> = {
  amount: '分量（任意）',
  expiryDate: '期限（任意）',
};

/** 保存の操作の名札。**1つである**（設計 規則5）。 */
const SAVE_LABEL = '保存して閉じる';

/**
 * 保存せずに閉じる操作の名札（設計 規則7・8。`docs/screen-design.md` 6章のワイヤーの「←」）。
 * **仮の文言である** — 記号だけでは読み上げに乗らないため、いまは文字を添えてある。
 */
const CLOSE_LABEL = '← 戻る';

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
};

export function StockItemEditForm({
  stockItem,
  onUpdate,
  onClose,
}: StockItemEditFormProps): JSX.Element {
  // 開いた直後の欄はその行の値である（設計 規則2 / NFR-15）。**取り直した一覧で書き換えない**
  // （同 規則17）ので、初期値としてだけ読む — 編集の対象は行から受け取った1件である。
  const [values, setValues] = useState<StockItemEditValues>(() => stockItemEditValuesOf(stockItem));
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<UpdateFailureNotice | null>(null);

  function changeField(field: keyof StockItemEditValues) {
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
    if (sending) return;

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await save();
  }

  return (
    <form onSubmit={submit}>
      {/* 閉じる操作は見出しの行、つまり**画面のいちばん上**に置く（先行 `StockItemForm.tsx`）。
          **`type="submit"` にしない** — 押した回に保存が走ってしまう。
          **送っている間は押せない**（設計 規則7）— 結末が届く前に閉じると、断りの案内が
          出ないまま画面が消え、打った入力も捨てられる。利用者は保存できたと思い込む。 */}
      <button type="button" disabled={sending} onClick={onClose}>
        {CLOSE_LABEL}
      </button>

      {/* 名称は**出すが変えられない**（設計 規則1 / `UpdateStockItemInput` に名称が無い）—
          何を編集しているか分からないまま打たせない。欄にしないのは、送れない値を編集させる
          形になるためである。 */}
      <h2>{stockItem.name}</h2>

      <label>
        {FIELD_LABELS.amount}
        {/* 開いた直後の焦点はこの欄である（設計 規則18 / NFR-15）— 編集できる先頭の欄であり、
            編集の画面は開くまで木に無い（`PantryTab`）ので mount のときに当てれば足りる。
            **効果と `ref` を置かない。**
            分量は自由文字列。数値と単位に分けない（ADR-010）。 */}
        <input autoFocus value={values.amount} onChange={changeField('amount')} />
      </label>

      <label>
        {FIELD_LABELS.expiryDate}
        {/* YYYY-MM-DD を返す日付の欄（先行 `StockItemForm.tsx`）。書式の検めは置かない
            （設計 規則4）— 正規化と検めはサーバの1か所に残す。 */}
        <input type="date" value={values.expiryDate} onChange={changeField('expiryDate')} />
      </label>

      {notice !== null && <p>{NOTICES[notice]}</p>}

      {/* 保存は画面の下半分に置く（NFR-14）。**1つだけである**（設計 規則5）。
          `<form>` の送信にしてあるので、欄で Enter を打った回もここに落ちる。 */}
      <button type="submit" disabled={sending}>
        {sending ? SENDING_LABEL : SAVE_LABEL}
      </button>
    </form>
  );
}
