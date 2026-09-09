import type { StockItemDto, UpdateStockItemInput } from '@fridge-to-meal/contract';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import { withAmountAndExpiryDate } from '../domain/entity/StockItem.js';
import { PantryRuleViolation } from '../domain/error/PantryRuleViolation.js';
import type { StockItemRepository } from '../domain/repository/StockItemRepository.js';
import { amountOf } from '../domain/value/Amount.js';
import { expiryDateOf } from '../domain/value/ExpiryDate.js';
import type { StockItemId } from '../domain/value/StockItemId.js';
import { stockItemDtoOf } from './StockItemDto.js';

/**
 * 在庫品の分量と期限を置き換える（FR-05）。世帯は第1引数で受け取る（C-9）。
 * 入力は常に置き換えであり、`null` は「消す」を表す（B-06 規則3 / FR-13）。
 */
export type UpdateStockItem = (
  householdId: HouseholdId,
  id: StockItemId,
  input: UpdateStockItemInput,
) => Promise<StockItemDto>;

/**
 * 更新のユースケースを組み立てる。実装の生成は `main.ts` に任せる（ADR-002 / B-09）。
 *
 * 分量と期限の正規化・検査はドメインが持ち、ここで書き直さない（B-06 規則4・5）。
 * ドメインとリポジトリが投げた例外は握りつぶさず、そのまま呼び出し側へ伝える
 * （HTTP への写像は B-08）。
 */
export function updateStockItem(deps: {
  stockItemRepository: StockItemRepository;
}): UpdateStockItem {
  return async (householdId, id, input) => {
    const 保存済み = await deps.stockItemRepository.findById(householdId, id);
    if (保存済み === null) {
      // 存在しない場合と他の世帯の場合を同じ規則・同じ文言で断る（B-06 規則8 / C-9）。
      // 文言に識別子も世帯も書かない — 書けば「他の世帯には在る」が漏れる。
      throw new PantryRuleViolation('update.notFound', '更新する在庫品が見つかりません');
    }

    // 検証はすべて保存の前に済ませる（規則12）。期限の書式違反はこの組み立てで
    // 例外になり、保存済みの在庫品は元のまま残る。
    const 更新後 = withAmountAndExpiryDate(保存済み, {
      amount: amountOf(input.amount),
      expiryDate: expiryDateOf(input.expiryDate),
    });

    // 値が今と同じでも保存する（規則6）。差分の判定はもう1つの規則になり、
    // 外から見える違いも無い。
    await deps.stockItemRepository.save(householdId, 更新後);

    return stockItemDtoOf(更新後);
  };
}
