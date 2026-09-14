import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';
import type { Meal } from '../entity/Meal.js';

/**
 * 献立の永続化の出口。**interface だけを置き、実装はインフラ層に持つ**（ADR-002）。
 *
 * **全メソッドが `householdId` を必須引数に取る**（C-9 / B-27 規則1）。世帯をまたぐ取得を
 * 型として不可能にするためであり、**献立自身が `householdId` を持っていても省かない**
 * （先行 `StockItemRepository`）。
 *
 * この周（B-27）は再利用だけの経路なので、取得の口しか置かない。献立を作るのは生成の
 * 経路だけであり、`save` は B-28 が足す。
 */
export interface MealRepository {
  /**
   * その世帯の献立をすべて返す。
   *
   * **並び順を約束しない**（先行 `StockItemRepository.findByHousehold`）。再利用の並びは
   * C-12 が決めるものであり、決めるのは `cookableMealsOf` である（ADR-036 決定4）。
   */
  findByHousehold(householdId: HouseholdId): Promise<Meal[]>;
}
