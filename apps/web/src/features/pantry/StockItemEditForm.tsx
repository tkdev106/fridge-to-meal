/**
 * 在庫の編集の画面（B-55 設計 4章 / 5章 / 6章 規則1〜8・18・19）。
 *
 * **署名だけのスタブである**（`docs/testing.md` 8章）。中身は `implementer` の持ち分であり、
 * ここに「とりあえず動く」描画を置かない。
 */

import type { JSX } from 'react';
import type { StockItemDto } from '@fridge-to-meal/contract';
import type { UpdateStockItem } from '../../server/StockItemRequests.js';

export type StockItemEditFormProps = {
  /** 編集する在庫品1件。**行から受け取る**（設計 規則17）。 */
  stockItem: StockItemDto;
  /** 更新の実行（設計 5章）。**結末で返り、例外を投げない**（`server/README.md`）。 */
  onUpdate: UpdateStockItem;
  /** 一覧へ戻す（設計 規則7・8）。**通った回と、保存せずに閉じた回に呼ぶ。** */
  onClose: () => void;
};

export function StockItemEditForm(_props: StockItemEditFormProps): JSX.Element {
  throw new Error('未実装');
}
