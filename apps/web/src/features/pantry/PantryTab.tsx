/**
 * 在庫タブの中身（B-39 設計 4章 / 5章）。一覧（`PantryList`）と登録（`StockItemForm`）の
 * **出し分け**と、いまどちらを出しているかの状態を持つ場所である（同 6章 規則1〜4）。
 *
 * **ここは署名だけのスタブである**（`docs/testing.md` 8章）。出し分けを入れるのは実装の段で、
 * この段のテスト（`test/features/pantry/PantryTab.test.tsx`）は落ちていることが正しい。
 */

import type { JSX } from 'react';
import type { PantryListState } from './PantryList.js';
import type { DeleteStockItem, RegisterStockItem } from '../../server/StockItemRequests.js';

export type PantryTabProps = {
  /** 在庫一覧の3値。**門から素通しで受け取る**（B-22 設計 規則10 / B-39 設計 規則4）。 */
  stockItems: PantryListState;
  /**
   * 残日数を数える基準日（`YYYY-MM-DD`）。**ここで `new Date()` を読まない**
   * （`docs/testing.md` 5章）— 実行環境の暦日を作るのは門の仕事である。
   */
  today: string;
  /** 削除の実行（B-23）。一覧へ素通しする。 */
  onDelete: DeleteStockItem;
  /** 登録の実行（B-24）。登録の画面へ素通しする。 */
  onRegister: RegisterStockItem;
};

export function PantryTab(_props: PantryTabProps): JSX.Element {
  throw new Error('未実装');
}
