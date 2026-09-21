/**
 * 在庫登録の画面（B-12 設計 4章 / 6章 規則5・7〜12）。`docs/screen-design.md` 第6章に当たる。
 *
 * ここは `StockItemFormValues.ts` と `RegisterFailureNotice.ts` を読むだけの薄い層である。
 * 何を保存できるかの判断も、空欄をどう読み替えるかも、**断りからどの案内を選ぶかも持たない**
 * （規則9 / B-24）— **描いて確かめられるようになった今も**（ADR-052）、判断は純粋関数に
 * 置くほうが速く、仮の文言にも jsdom にも依存しない。
 *
 * 反対に、**日本語はここにしか置かない**（規則9）。文言も配色も未確定であり
 * （`docs/screen-design.md` 論点3）、以下の日本語は同書 第6章のワイヤーから写した仮のものである。
 *
 * 登録の実行は引数で受け取る。**組み立てるのは `main.tsx` だけ**であり、この画面は基点も
 * `fetch` もトークンの取り出し方も知らない（B-24 / B-22 設計 規則1・4）。
 */

import type { ChangeEvent, FormEvent } from 'react';
import { useState } from 'react';
import type { RegisterFailureNotice } from './RegisterFailureNotice.js';
import { registerFailureNoticeOf } from './RegisterFailureNotice.js';
import type { StockItemFormValues } from './StockItemFormValues.js';
import { EMPTY_STOCK_ITEM_FORM, registerStockItemInputOf } from './StockItemFormValues.js';
import type { RegisterStockItem } from '../../server/StockItemRequests.js';

/** 画面の見出し。仮の文言である。 */
const HEADING = '食材を追加';

/**
 * 欄の見出し。**分量と期限には必須の印を付けない**（規則11 / FR-13）— 空のまま保存できる。
 * 「（任意）」を見出しに含めるのは `docs/screen-design.md` 6章 のワイヤーどおりで、
 * 任意であることを印の有無ではなく文字で伝えるためである。
 */
const FIELD_LABELS: Record<keyof StockItemFormValues, string> = {
  name: '食材名',
  amount: '分量（任意）',
  expiryDate: '期限（任意）',
};

/** 保存の操作の名札。操作は1つで、その振る舞いが「保存してもう1件」である（規則5 / FR-08）。 */
const SAVE_LABEL = '保存してもう1件';

/** 送っている間の名札。受け付けないこと（規則8）を、操作の見た目だけでなく文字でも伝える。 */
const SENDING_LABEL = '保存しています…';

/**
 * 保存できなかったときの案内。**断りの `rule` から選ぶ**（ADR-032 決定3 / B-24）— 選ぶ判断は
 * `RegisterFailureNotice.ts` にあり、ここはその識別子に文言を当てるだけである（規則9）。
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
  nameEmpty: '食材名を入れてください。',
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
   * 一覧へ戻す（B-39 設計 5章）。「←」を押した回と、「保存して閉じる」が通った回に呼ぶ。
   *
   * **いまはまだ呼ばない。** 閉じる操作と2つ目の保存を足すのは後続であり、この props は
   * 呼び出し側（`PantryTab`）を組める形にするために先に置いてある。
   */
  onClose: () => void;
};

export function StockItemForm({ onRegister }: StockItemFormProps) {
  const [values, setValues] = useState<StockItemFormValues>(EMPTY_STOCK_ITEM_FORM);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<RegisterFailureNotice | null>(null);

  const registerInput = registerStockItemInputOf(values);

  function changeField(field: keyof StockItemFormValues) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setValues((previous) => ({ ...previous, [field]: event.target.value }));
    };
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // 名称から登録の入力が作れないときは保存を効かせない（規則2）。送っている間も同じ（規則8）
    // — 二重に送ると、同名でも統合されない在庫品が2件残る（ADR-007）。
    if (registerInput === null || sending) return;

    setSending(true);
    setNotice(null);
    // **`catch` を置かない。** 口は結末で返し投げない（`server/README.md`）ので、握り潰すと
    // 本当の不具合が案内に化ける。`finally` だけは残す — 投げられた回に操作が戻らなくなるため。
    try {
      const selectedNotice = registerFailureNoticeOf(await onRegister(registerInput));
      setNotice(selectedNotice);

      // 通ったときだけ3欄を空に戻し、続けてもう1件入れられる状態にする（規則12 / FR-08）。
      // 断られたときは入力を消さない（NFR-15）。自動で送り直さない（ADR-007）。
      if (selectedNotice === null) setValues(EMPTY_STOCK_ITEM_FORM);
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={save}>
      <h2>{HEADING}</h2>

      <label>
        {FIELD_LABELS.name}
        {/* 焦点は当てない（規則10 / 10b）。いまは `App.tsx` が一覧の下に並べて置くだけなので、
            焦点を当てると起動した時点で一覧を飛ばして飛んでくる — 起動時に開く画面は未決である
            （`docs/screen-design.md` 論点1）。独立した画面として開ける周で当てる。 */}
        <input value={values.name} onChange={changeField('name')} />
      </label>

      <label>
        {FIELD_LABELS.amount}
        {/* 分量は自由文字列。数値と単位に分けない（ADR-010）。 */}
        <input value={values.amount} onChange={changeField('amount')} />
      </label>

      <label>
        {FIELD_LABELS.expiryDate}
        {/* YYYY-MM-DD を返す日付の欄（B-12 設計 10章）。書式の検めは置かない（規則4）。 */}
        <input type="date" value={values.expiryDate} onChange={changeField('expiryDate')} />
      </label>

      {notice !== null && <p>{NOTICES[notice]}</p>}

      {/* 保存の操作は画面の下半分に置く（規則10 / NFR-14）。これ1つだけである（規則5）。 */}
      <button type="submit" disabled={registerInput === null || sending}>
        {sending ? SENDING_LABEL : SAVE_LABEL}
      </button>
    </form>
  );
}
