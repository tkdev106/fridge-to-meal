import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';
import type { Meal } from '../entity/Meal.js';

/**
 * 献立の永続化の出口。**interface だけを置き、実装はインフラ層に持つ**（ADR-002）。
 *
 * **全メソッドが `householdId` を必須引数に取る**（C-9 / B-27 規則1）。世帯をまたぐ取得を
 * 型として不可能にするためであり、**献立自身が `householdId` を持っていても省かない**
 * （先行 `StockItemRepository`）。
 *
 * 献立を作るのは生成の経路だけなので、`save` は生成の経路と同じ周（B-28）で足した。
 */
export interface MealRepository {
  /**
   * その世帯の献立をすべて返す。
   *
   * **並び順を約束しない**（先行 `StockItemRepository.findByHousehold`）。再利用の並びは
   * C-12 が決めるものであり、決めるのは `cookableMealsOf` である（ADR-036 決定4）。
   */
  findByHousehold(householdId: HouseholdId): Promise<Meal[]>;

  /**
   * 献立を保存する（C-1。生成結果を献立に変換した時点で保存する）。
   *
   * `meal.householdId` と引数の `householdId` が食い違う場合、実装は
   * **`MealRuleViolation`（`rule: 'save.householdMismatch'`）を投げて保存を拒む。**
   * 食い違いは呼び出し側の誤りであり、黙って引数の側に寄せない（先行
   * `StockItemRepository.save` / `SuggestionRepository.save`）。**interface では強制できない
   * 約束なので、実装ごとにテストで確かめる。**
   */
  save(householdId: HouseholdId, meal: Meal): Promise<void>;
}
