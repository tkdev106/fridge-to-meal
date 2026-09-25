/**
 * 登録のフォームの値から、登録の入力を作る（B-12 設計 5章 / 6章 規則1〜4b・規則6）。
 *
 * 判断はここに置き、日本語と描画は `.tsx` が持つ（規則9）。React も contract の型以外も import しない。
 *
 * **前後の空白を落とさず、期限の書式も暦の実在も確かめない**（規則4）。正規化と検めは api 側の
 * `createStockItem` / `amountOf` / `expiryDateOf` の1か所に残す。画面が同じ判断を持つと、
 * 2か所が別々にずれていく。
 */

import type {
  RegisterStockItemInput,
  StockItemDto,
  UpdateStockItemInput,
} from '@fridge-to-meal/contract';

/** 登録の画面が持つ3欄の値。世帯は持たない（C-9）。 */
export type StockItemFormValues = {
  readonly name: string;
  readonly amount: string;
  readonly expiryDate: string;
};

/**
 * 開いた直後と、保存に成功した直後の値（規則6）。
 *
 * 期限に「今日」のような既定値を入れない。開いた直後に保存できる状態にしないためであり
 * （FR-13 / NFR-15）、この値からは登録の入力が作れない（規則2）。
 */
export const EMPTY_STOCK_ITEM_FORM: StockItemFormValues = {
  name: '',
  amount: '',
  expiryDate: '',
};

/**
 * 任意の欄を未設定に倒す（規則3）。空文字だけを `null`（未設定）にし、空白は落とさず
 * そのまま運ぶ（規則4）。contract は省略と `null` を同義と定めている。
 */
function toNullWhenEmpty(field: string): string | null {
  return field === '' ? null : field;
}

/** 登録の入力を作る。作れない＝保存できないときは null（規則2）。 */
export function registerStockItemInputOf(
  values: StockItemFormValues,
): RegisterStockItemInput | null {
  // 規則4 の唯一の例外（規則4b）。空の食材名だけは往復する前に止める — 往復してから
  // 断られると1件10秒（NFR-15）に収まらない。trim() は全角空白も落とすので、
  // サーバの createStockItem が断る条件とそのまま揃う。
  if (values.name.trim() === '') return null;

  // 食材の指定は項目ごと持たせない（規則1）。カタログに無い名称でも登録が通る（FR-03）。
  return {
    name: values.name,
    amount: toNullWhenEmpty(values.amount),
    expiryDate: toNullWhenEmpty(values.expiryDate),
  };
}

/** 編集の画面が持つ2欄の値（B-55 設計 5章 / 規則1）。名称は編集できないので持たない。 */
export type StockItemEditValues = { readonly amount: string; readonly expiryDate: string };

/** 開いた直後の欄の値（B-55 規則2）。 */
export function stockItemEditValuesOf(stockItem: StockItemDto): StockItemEditValues {
  void stockItem;
  throw new Error('未実装');
}

/** 更新の入力を作る（B-55 規則3・6）。 */
export function updateStockItemInputOf(values: StockItemEditValues): UpdateStockItemInput {
  void values;
  throw new Error('未実装');
}
