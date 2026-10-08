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

/** 登録の画面が持つ4欄の値（文字の3欄と献立に使うかどうか）。世帯は持たない（C-9）。 */
export type StockItemFormValues = {
  readonly name: string;
  readonly amount: string;
  readonly expiryDate: string;
  readonly useForMeals: boolean;
};

/**
 * 欄に打てる字数の上限（NFR-19）。api の domain と同じ値を持つ — web から api は import できない。
 * 断る判定そのものはサーバの1か所に残し、ここは欄の `maxLength` に当てるだけである。
 */
export const NAME_MAX_LENGTH = 30;
export const AMOUNT_MAX_LENGTH = 15;

/**
 * 開いた直後と、保存に成功した直後の値（規則6）。
 *
 * 期限に「今日」のような既定値を入れない。開いた直後に保存できる状態にしないためであり
 * （FR-13 / NFR-15）、この値からは登録の入力が作れない（規則2）。
 *
 * 献立に使うかどうかは**オン**から始める（B-76 規則13）。「保存してもう1件」の後もこの値へ戻る。
 */
export const EMPTY_STOCK_ITEM_FORM: StockItemFormValues = {
  name: '',
  amount: '',
  expiryDate: '',
  useForMeals: true,
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
    // 省略も `null` もせず、真偽値のまま載せる（B-76 規則15）。保存の可否には関わらない。
    useForMeals: values.useForMeals,
  };
}

/**
 * 編集の画面が持つ3欄の値（分量・期限・献立に使うかどうか。B-55 設計 5章 / 規則1、B-76）。
 * 名称は編集できないので持たない。
 */
export type StockItemEditValues = {
  readonly amount: string;
  readonly expiryDate: string;
  readonly useForMeals: boolean;
};

/**
 * 開いた直後の欄の値（B-55 規則2 / NFR-15）。
 *
 * **その行の値をそのまま置き、空に戻さない** — 分量だけ直したい回に期限を打ち直させない。
 * 未設定（`null`）は空文字に倒す（欄に `null` を描かせない）。
 *
 * **前後の空白を落とさない**（規則4）。正規化はサーバの1か所（`amountOf` / `expiryDateOf`）に
 * 残す — ここで落とすと、開いてそのまま保存した回に値が黙って変わる。
 *
 * **食材名を持たない**（規則1）。編集できるのは分量・期限・献立に使うかどうかだけであり（`UpdateStockItemInput` に
 * 名称が無い）、欄に持つと送れない値を編集させる形になる。名称を出すのは `.tsx` の役目である。
 */
export function stockItemEditValuesOf(stockItem: StockItemDto): StockItemEditValues {
  return {
    amount: stockItem.amount ?? '',
    expiryDate: stockItem.expiryDate ?? '',
    // 献立に使うかどうかも在庫品の今の値から始める（B-76 規則14）。
    useForMeals: stockItem.useForMeals,
  };
}

/**
 * 更新の入力を作る（B-55 規則3・6 / FR-13）。
 *
 * **`null` を返す道が無い。** 登録（食材名が空なら作らない）と違い、作れない入力が存在しない —
 * 「どちらも消す」は正しい編集であり、必須の欄が1つも無い。
 *
 * **空欄は「消す」を表し、キーを省略せず `null` を送る**（規則3）。`UpdateStockItemInput` は
 * 常に置き換えとして扱う（B-06 規則3）— 省略に読み替えると、消したい回に今の値が残る。
 *
 * **値が今と同じでも入力を作る**（規則6）。差分を見て止めると、送るかどうかの判断が画面と
 * サーバの2か所に増える。
 */
export function updateStockItemInputOf(values: StockItemEditValues): UpdateStockItemInput {
  // 空文字だけを `null` にし、空白は落とさずそのまま運ぶ（規則4。登録と同じ関数を使う）。
  return {
    amount: toNullWhenEmpty(values.amount),
    expiryDate: toNullWhenEmpty(values.expiryDate),
    useForMeals: values.useForMeals,
  };
}
