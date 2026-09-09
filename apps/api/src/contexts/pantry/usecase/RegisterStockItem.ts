import type { RegisterStockItemInput, StockItemDto } from '@fridge-to-meal/contract';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import { createStockItem } from '../domain/entity/StockItem.js';
import type { StockItemIdGenerator } from '../domain/port/StockItemIdGenerator.js';
import { stockItemDtoOf } from './StockItemDto.js';
import type { StockItemRepository } from '../domain/repository/StockItemRepository.js';
import { amountOf } from '../domain/value/Amount.js';
import { expiryDateOf } from '../domain/value/ExpiryDate.js';
import { ingredientIdOf } from '../domain/value/IngredientId.js';

/**
 * 在庫品を1件登録する（FR-01）。世帯は第1引数で受け取り、入力からは読まない（C-9）。
 */
export type RegisterStockItem = (
  householdId: HouseholdId,
  input: RegisterStockItemInput,
) => Promise<StockItemDto>;

/**
 * 登録のユースケースを組み立てる。依存は引数で受け取り、実装の生成は `main.ts` に任せる
 * （ADR-002 / B-09）。識別子の発行をポート越しにするのは、本体で `crypto.randomUUID()` を
 * 読むと実行のたびに結果が変わるためである（`docs/testing.md` 5章 / ADR-026 提案中）。
 *
 * 名称・分量・期限の正規化と検査はドメインが持つ。ここで書き直すと同じ規則が2か所に増える。
 * ドメインが投げた例外は握りつぶさず、そのまま呼び出し側へ伝える（HTTP への写像は B-08）。
 */
export function registerStockItem(deps: {
  stockItemRepository: StockItemRepository;
  generateStockItemId: StockItemIdGenerator;
}): RegisterStockItem {
  return async (householdId, input) => {
    // 検証はすべて保存の前に済ませる。規則違反で終わったときに何も残らないのは、
    // 在庫品を組み立ててから保存するこの順序による。
    const 在庫品 = createStockItem({
      id: deps.generateStockItemId(),
      householdId,
      name: input.name,
      ingredientId: 食材の指定(input.ingredientId),
      amount: input.amount === undefined || input.amount === null ? null : amountOf(input.amount),
      expiryDate: expiryDateOf(input.expiryDate ?? null),
    });

    await deps.stockItemRepository.save(householdId, 在庫品);

    return stockItemDtoOf(在庫品);
  };
}

/**
 * 食材の指定を読む。**省略・`null`・空文字・空白のみをすべて「指定なし」とする**（規則4）。
 *
 * カタログに実在するかは確かめない。確認を挟むと、カタログが答えられないときに登録が
 * 止まる（FR-03 / ADR-008）。**前後の空白は落とさない** — 正規化はドメインの仕事であり、
 * ここで落とすとユースケースが2つ目の正規化規則を持つことになる（規則4b）。
 */
function 食材の指定(raw: string | null | undefined) {
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  return ingredientIdOf(raw);
}
