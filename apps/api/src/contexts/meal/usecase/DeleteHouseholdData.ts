import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { CountHouseholdMembers } from '../../identity/usecase/CountHouseholdMembers.js';
import type { DeleteUser } from '../../identity/usecase/DeleteUser.js';
import type { DeleteHouseholdStockItems } from '../../pantry/usecase/DeleteHouseholdStockItems.js';
import type { MealRepository } from '../domain/repository/MealRepository.js';
import type { SuggestionRepository } from '../domain/repository/SuggestionRepository.js';

/**
 * 世帯のデータ（在庫品・保存したことのある在庫品の名称・献立・提案）をすべて消し、最後に
 * その世帯の利用者も消す（B-56a / B-56d / FR-27 / NFR-13 / ADR-072 / ADR-071 決定2）。
 * 世帯に他のメンバーが居れば、データは残ったメンバーのものとして残し、利用者だけを消す
 * （B-75 / ADR-087 決定6）。世帯は第1引数で受け取る（C-9）。
 */
export type DeleteHouseholdData = (householdId: HouseholdId) => Promise<void>;

/**
 * 世帯のデータを消すユースケースを組み立てる。依存は引数で受け取り、実装の生成は `main.ts` に
 * 任せる（ADR-002）。在庫の側は `pantry/usecase` の口を関数として受け取る（ADR-033 決定2 /
 * ADR-072 決定1）。利用者の側も `identity/usecase` の口を関数として受け取る（B-56d。向きは
 * 下流の献立 → 上流の identity）。
 *
 * **最初に世帯の人数を問い、2人以上なら利用者だけを消して終える**（B-75 / ADR-087 決定6）。1人以下なら
 * **提案 → 献立 → 在庫 → 利用者の順に消す**（B-56a 規則6 / ADR-058 / B-56d 規則5）— 提案の1件は
 * 献立を外部キーなしで指すので、指す側を先に消す。利用者は必ず最後 — 先に消して後続が投げても
 * トランザクションが戻すが、順を固定しておけば「データが残ったまま利用者だけ消える」形を口の
 * 順序からも作らない（ADR-071 (d)）。**存在を確かめない**（規則7）。どれかの口が投げたら、その例外を
 * 包まずに伝え、後続の口を呼ばない（規則8。巻き戻しはトランザクションに任せる）。
 */
export function deleteHouseholdData(deps: {
  countHouseholdMembers: CountHouseholdMembers;
  deleteHouseholdStockItems: DeleteHouseholdStockItems;
  deleteUser: DeleteUser;
  mealRepository: MealRepository;
  suggestionRepository: SuggestionRepository;
}): DeleteHouseholdData {
  return async (householdId) => {
    if ((await deps.countHouseholdMembers(householdId)) >= 2) {
      await deps.deleteUser(householdId);
      return;
    }

    await deps.suggestionRepository.deleteByHousehold(householdId);
    await deps.mealRepository.deleteByHousehold(householdId);
    await deps.deleteHouseholdStockItems(householdId);
    await deps.deleteUser(householdId);
  };
}
