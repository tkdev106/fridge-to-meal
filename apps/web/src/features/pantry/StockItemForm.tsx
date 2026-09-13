/**
 * 在庫登録の画面（B-12 設計 4章 / 6章 規則5・7〜12）。`docs/screen-design.md` 第6章に当たる。
 *
 * ここは `StockItemFormValues.ts` を読むだけの薄い層である。何を保存できるかの判断も、
 * 空欄をどう読み替えるかも持たない（規則9）— `.tsx` は vitest が拾わない（`include` は
 * `*.test.ts`、`environment: 'node'`）ため、判断を置くと誰も確かめられなくなる。
 *
 * 反対に、**日本語はここにしか置かない**（規則9）。文言も配色も未確定であり
 * （`docs/screen-design.md` 論点3）、以下の日本語は同書 第6章のワイヤーから写した仮のものである。
 *
 * 登録の実行は引数で受け取る。サーバへ送る手段はこの周では作らない（B-12 設計 2章 / B-24）。
 */

import type { ChangeEvent, FormEvent } from 'react';
import { useState } from 'react';
import type { RegisterStockItemInput } from '@fridge-to-meal/contract';
import type { StockItemFormValues } from './StockItemFormValues.js';
import { EMPTY_STOCK_ITEM_FORM, registerStockItemInputOf } from './StockItemFormValues.js';

/** 画面の見出し。仮の文言である。 */
const 画面の見出し = '食材を追加';

/**
 * 欄の見出し。**分量と期限には必須の印を付けない**（規則11 / FR-13）— 空のまま保存できる。
 * 「（任意）」を見出しに含めるのは `docs/screen-design.md` 6章 のワイヤーどおりで、
 * 任意であることを印の有無ではなく文字で伝えるためである。
 */
const 欄の見出し: Record<keyof StockItemFormValues, string> = {
  name: '食材名',
  amount: '分量（任意）',
  expiryDate: '期限（任意）',
};

/** 保存の操作の名札。操作は1つで、その振る舞いが「保存してもう1件」である（規則5 / FR-08）。 */
const 保存の名札 = '保存してもう1件';

/** 送っている間の名札。受け付けないこと（規則8）を、操作の見た目だけでなく文字でも伝える。 */
const 送っている間の名札 = '保存しています…';

/**
 * 保存できなかったときの案内。**理由ごとに文言を分けない**（規則7）— この周は断りの
 * `rule` を受け取らない。理由から文言を選ぶのは B-24（ADR-032 の決定3）。
 *
 * **書き込みの失敗の断り方は、要件にも画面設計にも根拠が無い**（NFR-07 と
 * `docs/screen-design.md` 9章「生成の失敗」は LLM の応答の話であって、ここには及ばない）。
 * 入力を残すのは打ち直しが1件10秒（NFR-15）に収まらないため、自動で送り直さないのは
 * 同名でも統合されない在庫品が2件残るため（ADR-007）。**それ以外は実装上の取り決めである。**
 */
const 保存できなかった案内 = '保存できませんでした。入力はそのままです。もう一度お試しください。';

export type StockItemFormProps = {
  /** 登録の実行。送る手段はこの周では作らない（B-12 設計 2章）。成功は解決、失敗は reject で表す。 */
  onRegister: (input: RegisterStockItemInput) => Promise<void>;
};

export function StockItemForm({ onRegister }: StockItemFormProps) {
  const [values, setValues] = useState<StockItemFormValues>(EMPTY_STOCK_ITEM_FORM);
  const [送っている, set送っている] = useState(false);
  const [保存できなかった, set保存できなかった] = useState(false);

  const 登録の入力 = registerStockItemInputOf(values);

  function 欄の書き換え(欄: keyof StockItemFormValues) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setValues((前の値) => ({ ...前の値, [欄]: event.target.value }));
    };
  }

  async function 保存する(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // 名称から登録の入力が作れないときは保存を効かせない（規則2）。送っている間も同じ（規則8）
    // — 二重に送ると、同名でも統合されない在庫品が2件残る（ADR-007）。
    if (登録の入力 === null || 送っている) return;

    set送っている(true);
    set保存できなかった(false);
    try {
      await onRegister(登録の入力);
      // 成功したら3欄を空に戻し、続けてもう1件入れられる状態にする（規則12 / FR-08）。
      setValues(EMPTY_STOCK_ITEM_FORM);
    } catch {
      // 入力は消さない（NFR-15）。自動で送り直さない（ADR-007）。断る理由は見ない（規則7）。
      set保存できなかった(true);
    } finally {
      set送っている(false);
    }
  }

  return (
    <form onSubmit={保存する}>
      <h2>{画面の見出し}</h2>

      <label>
        {欄の見出し.name}
        {/* 焦点は当てない（規則10 / 10b）。いまは `App.tsx` が一覧の下に並べて置くだけなので、
            焦点を当てると起動した時点で一覧を飛ばして飛んでくる — 起動時に開く画面は未決である
            （`docs/screen-design.md` 論点1）。独立した画面として開ける周で当てる。 */}
        <input value={values.name} onChange={欄の書き換え('name')} />
      </label>

      <label>
        {欄の見出し.amount}
        {/* 分量は自由文字列。数値と単位に分けない（ADR-010）。 */}
        <input value={values.amount} onChange={欄の書き換え('amount')} />
      </label>

      <label>
        {欄の見出し.expiryDate}
        {/* YYYY-MM-DD を返す日付の欄（B-12 設計 10章）。書式の検めは置かない（規則4）。 */}
        <input type="date" value={values.expiryDate} onChange={欄の書き換え('expiryDate')} />
      </label>

      {保存できなかった && <p>{保存できなかった案内}</p>}

      {/* 保存の操作は画面の下半分に置く（規則10 / NFR-14）。これ1つだけである（規則5）。 */}
      <button type="submit" disabled={登録の入力 === null || 送っている}>
        {送っている ? 送っている間の名札 : 保存の名札}
      </button>
    </form>
  );
}
