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
 * 反対に、**日本語はここにしか置かない**（B-12 設計 規則9）。文言も配色も未確定であり
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
 * 欄の見出し。**分量と期限には必須の印を付けない**（B-12 設計 規則11 / FR-13）— 空のまま
 * 保存できる。「（任意）」を見出しに含めるのは `docs/screen-design.md` 6章 のワイヤーどおりで、
 * 任意であることを印の有無ではなく文字で伝えるためである。
 */
const FIELD_LABELS: Record<keyof StockItemFormValues, string> = {
  name: '食材名',
  amount: '分量（任意）',
  expiryDate: '期限（任意）',
};

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
 * 保存せずに閉じる操作の名札（B-39 設計 規則7。`docs/screen-design.md` 6章のワイヤーの「←」）。
 * **仮の文言である**（同書 論点3）— 記号だけでは読み上げに乗らないため、いまは文字を添えてある。
 */
const CLOSE_LABEL = '← 戻る';

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
   * 一覧へ戻す（B-39 設計 5章 / 規則7・9）。**保存せずに閉じる**「←」を押した回と、
   * 「保存して閉じる」が**通った**回に呼ぶ。
   *
   * 呼ぶ相手が一覧と登録の出し分けを持っている（`PantryTab`）。この画面は戻った先が何かを
   * 知らず、閉じたあとに自分が木から外れることも前提にしない。
   *
   * **断られた回と失敗した回は呼ばない**（規則10）— 送り直せる画面を残す必要がある。
   */
  onClose: () => void;
};

export function StockItemForm({ onRegister, onClose }: StockItemFormProps) {
  const [values, setValues] = useState<StockItemFormValues>(EMPTY_STOCK_ITEM_FORM);
  // 送っている間は、どちらの保存で送ったかを持つ（null なら送っていない）。**どちらも
  // 効かなくするのはこの値1つで足りる**（規則11）。
  const [sendingFor, setSendingFor] = useState<AfterSave | null>(null);
  const [notice, setNotice] = useState<RegisterFailureNotice | null>(null);

  const registerInput = registerStockItemInputOf(values);
  const sending = sendingFor !== null;
  // 保存の2つに当てる条件。**「←」には `sending` だけが当たる**（下の閉じる操作の注記）—
  // 食材名が空でも「捨てて戻る」は効かねばならないので、`registerInput === null` は含めない。
  const saveDisabled = registerInput === null || sending;

  function changeField(field: keyof StockItemFormValues) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setValues((previous) => ({ ...previous, [field]: event.target.value }));
    };
  }

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

      // 通ったときだけ分かれる（規則9 / FR-08）。「もう1件」は3欄を空に戻して留まり、
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
    <form onSubmit={submit}>
      {/* 閉じる操作は見出しの行、つまり**画面のいちばん上**に置く（B-39 設計 規則7・8 /
          `docs/screen-design.md` 6章のワイヤー）。**`type="submit"` にしない** — 押した回に
          保存が走ってしまい、「捨てて戻る」ではなくなる。
          **確認は出さない**（規則7 / 要件 5.5）。登録し直すコストが低く、削除で確認を出さないのと
          同じ構えである。
          **送っている間は押せない**（規則10 / 規則11）。「送った1件はもう届いているので、閉じるのを
          止めても取り消せない」は**通った回にしか成り立たない** — 断られた回と失敗した回は、
          結末が届く前に閉じると**案内が出ないまま画面が消え、打った入力も捨てられる。**
          利用者は保存できたと思い込む。規則10 が守ろうとしているものが、この経路だけ抜ける。 */}
      <button type="button" disabled={sending} onClick={onClose}>
        {CLOSE_LABEL}
      </button>

      <h2>{HEADING}</h2>

      <label>
        {FIELD_LABELS.name}
        {/* 開いた直後はこの欄に焦点が当たる（B-39 設計 規則13 / B-12 設計 規則10b / NFR-15）。
            登録の画面は開くまで木に無い（`PantryTab`）ので、mount のときに当てれば「開いた
            直後」と一致する。**効果と `ref` を置かない** — 描き直しのたびに当て直す条件を
            自分で持つことになる。 */}
        <input autoFocus value={values.name} onChange={changeField('name')} />
      </label>

      <label>
        {FIELD_LABELS.amount}
        {/* 分量は自由文字列。数値と単位に分けない（ADR-010）。 */}
        <input value={values.amount} onChange={changeField('amount')} />
      </label>

      <label>
        {FIELD_LABELS.expiryDate}
        {/* YYYY-MM-DD を返す日付の欄（B-12 設計 10章）。書式の検めは置かない（B-12 設計 規則4）。 */}
        <input type="date" value={values.expiryDate} onChange={changeField('expiryDate')} />
      </label>

      {notice !== null && <p>{NOTICES[notice]}</p>}

      {/* 保存の操作は画面の下半分に置く（B-12 設計 規則10 / NFR-14）。**2つあり、前に出すのが
          「保存してもう1件」である**（規則8）。前のほうを `<form>` の送信にしてあるのは、
          そちらが既定の操作だからである（`docs/screen-design.md` 6章 決めたこと）。 */}
      <button type="submit" disabled={saveDisabled}>
        {sendingFor === 'stay' ? SENDING_LABEL : SAVE_LABELS.stay}
      </button>

      <button type="button" disabled={saveDisabled} onClick={() => void save('close')}>
        {sendingFor === 'close' ? SENDING_LABEL : SAVE_LABELS.close}
      </button>
    </form>
  );
}
