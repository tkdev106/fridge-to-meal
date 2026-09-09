import type { StockItemDto } from '@fridge-to-meal/contract';
import type { StockItem } from '../domain/entity/StockItem.js';

/**
 * 保存されている在庫品を DTO に写す。**加工しない** — trim も既定値の補完もドメインで
 * 済んでおり、ここで書き直すと同じ規則が2か所に増える（B-04 規則7 / B-05 規則10）。
 *
 * 登録（B-04）と一覧（B-05）が同じ写し方をするため、ユースケース層で1つに持つ。
 */
export function stockItemDtoOf(stockItem: StockItem): StockItemDto {
  return {
    id: stockItem.id,
    name: stockItem.name,
    ingredientId: stockItem.ingredientId,
    amount: stockItem.amount,
    expiryDate: stockItem.expiryDate,
  };
}
