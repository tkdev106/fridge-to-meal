import type { HouseholdId } from '../../../../shared/domain/household-id.js';
import { PantryRuleViolation } from '../pantry-rule-violation.js';
import type { Amount } from '../value/amount.js';
import type { ExpiryDate } from '../value/expiry-date.js';
import type { IngredientId } from '../value/ingredient-id.js';
import type { StockItemId } from '../value/stock-item-id.js';

/**
 * 在庫品。冷蔵庫にある1件の食材。**集約ルート**（ADR-007）。
 *
 * 不変条件（ドメインモデル 4章）:
 * - `name` は空文字を許さない
 * - 同じ食材でも統合しない。買った日が違えば別の在庫品
 * - `expiryDate` が未設定の在庫品は、期限による警告・優先の対象外
 * - 削除は物理削除でよい。献立は材料を複製済みで参照を持たない（C-5）
 */
export type StockItem = {
  readonly id: StockItemId;
  /** 所有する世帯。全メソッドで必須にすることで、世帯をまたぐ取得を不可能にする（C-9）。 */
  readonly householdId: HouseholdId;
  /** 食材名。カタログに無い名前もそのまま持つ（FR-03）。 */
  readonly name: string;
  /** カタログの食材を指す。自由入力で登録されたものは `null`（FR-03）。 */
  readonly ingredientId: IngredientId | null;
  readonly amount: Amount | null;
  readonly expiryDate: ExpiryDate | null;
};

/**
 * 在庫品を作る。**不変条件を通った `StockItem` は、これ以外の経路では作られない。**
 *
 * 返す値は凍結する。更新は書き換えではなく作り直しで表す — 可変にすると、
 * 不変条件を通らない書き換えが可能になる。
 *
 * @throws {PantryRuleViolation} 名称が空のとき
 */
export function createStockItem(props: {
  id: StockItemId;
  householdId: HouseholdId;
  name: string;
  ingredientId: IngredientId | null;
  amount: Amount | null;
  expiryDate: ExpiryDate | null;
}): StockItem {
  const name = props.name.trim();
  if (name === '') {
    // 名前だけが在庫品を在庫品たらしめている。充足判定は名称の突き合わせで
    // 行うため（C-6）、空の名前を通すと、その在庫品は献立に対して存在しないのと
    // 同じになる。
    throw new PantryRuleViolation('name.empty', '食材名を入力してください');
  }

  return Object.freeze({
    id: props.id,
    householdId: props.householdId,
    name,
    ingredientId: props.ingredientId,
    amount: props.amount,
    expiryDate: props.expiryDate,
  });
}
