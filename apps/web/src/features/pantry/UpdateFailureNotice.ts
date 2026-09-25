/**
 * 更新の結末から、画面が出す案内を選ぶ（FR-05 / ADR-032 決定3 / ADR-050 結果5 / B-55）。
 */

import type { UpdateStockItemOutcome } from '../../server/StockItemRequests.js';

/** 出す案内の種類（B-55 設計 5章 / 規則10・11）。 */
export type UpdateFailureNotice = 'gone' | 'expiryDateInvalid' | 'unavailable';

/** 結末から案内を選ぶ。通ったときは案内を出さない（`null`）。 */
export function updateFailureNoticeOf(outcome: UpdateStockItemOutcome): UpdateFailureNotice | null {
  void outcome;
  throw new Error('未実装');
}
