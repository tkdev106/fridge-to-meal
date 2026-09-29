import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { DeleteHouseholdStockItems } from '../../pantry/usecase/DeleteHouseholdStockItems.js';
import type { MealRepository } from '../domain/repository/MealRepository.js';
import type { SuggestionRepository } from '../domain/repository/SuggestionRepository.js';

/**
 * 世帯のデータ（在庫品・保存したことのある在庫品の名称・献立・提案）をすべて消す
 * （B-56a / FR-27 / NFR-13 / ADR-072）。世帯は第1引数で受け取る（C-9）。
 */
export type DeleteHouseholdData = (householdId: HouseholdId) => Promise<void>;

/**
 * 世帯のデータを消すユースケースを組み立てる。依存は引数で受け取り、実装の生成は `main.ts` に
 * 任せる（ADR-002）。在庫の側は `pantry/usecase` の口を関数として受け取る（ADR-033 決定2 /
 * ADR-072 決定1。依存の向きは献立 → 在庫の1本のまま）。
 *
 * **提案 → 献立 → 在庫の順に消す**（B-56a 規則6 / ADR-058）— 提案の1件は献立を外部キーなしで
 * 指すので、指す側を先に消す。**存在を確かめない**（規則7）。どれかの口が投げたら、その例外を
 * 包まずに伝え、後続の口を呼ばない（規則8。巻き戻しはトランザクションに任せる）。
 */
export function deleteHouseholdData(deps: {
  deleteHouseholdStockItems: DeleteHouseholdStockItems;
  mealRepository: MealRepository;
  suggestionRepository: SuggestionRepository;
}): DeleteHouseholdData {
  return async (householdId) => {
    await deps.suggestionRepository.deleteByHousehold(householdId);
    await deps.mealRepository.deleteByHousehold(householdId);
    await deps.deleteHouseholdStockItems(householdId);
  };
}
