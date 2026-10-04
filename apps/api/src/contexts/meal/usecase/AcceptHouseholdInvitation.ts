import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { CountHouseholdMembers } from '../../identity/usecase/CountHouseholdMembers.js';
import type { JoinHousehold } from '../../identity/usecase/JoinHousehold.js';
import type { DeleteHouseholdStockItems } from '../../pantry/usecase/DeleteHouseholdStockItems.js';
import type { MealRepository } from '../domain/repository/MealRepository.js';
import type { SuggestionRepository } from '../domain/repository/SuggestionRepository.js';

/**
 * 招待で世帯に参加する。自分しか居ない世帯からなら、その世帯のデータを消してから参加する
 * （B-74 設計書 5章 / FR-45 / ADR-087 決定5）。世帯は第1引数で受け取る（C-9）。
 */
export type AcceptHouseholdInvitation = (householdId: HouseholdId, token: string) => Promise<void>;

/**
 * 招待で参加するユースケースを組み立てる。依存は引数で受け取り、実装の生成は `main.ts` に
 * 任せる（ADR-002）。人数・参加の口は `identity/usecase`、在庫の口は `pantry/usecase` の関数として
 * 受け取る（ADR-033 決定2）。
 *
 * **最初に今の世帯の人数を問う**（設計書 規則9）。1以下なら `DeleteHouseholdData` と同じ口・同じ順
 * （提案 → 献立 → 在庫）で今の世帯のデータを消し、利用者は消さない。2以上ならデータは残った
 * メンバーのものとして残す。
 *
 * **消すのは参加より必ず先**（規則10）— 参加のあとは世帯が参加先を指すため、後に消すと参加先の
 * データが消える。参加が断られたら例外を包まずに伝え、消したデータの巻き戻しはトランザクションに
 * 任せる（規則11）。
 */
export function acceptHouseholdInvitation(deps: {
  countHouseholdMembers: CountHouseholdMembers;
  deleteHouseholdStockItems: DeleteHouseholdStockItems;
  joinHousehold: JoinHousehold;
  mealRepository: MealRepository;
  suggestionRepository: SuggestionRepository;
}): AcceptHouseholdInvitation {
  return async (householdId, token) => {
    if ((await deps.countHouseholdMembers(householdId)) <= 1) {
      await deps.suggestionRepository.deleteByHousehold(householdId);
      await deps.mealRepository.deleteByHousehold(householdId);
      await deps.deleteHouseholdStockItems(householdId);
    }

    await deps.joinHousehold(householdId, token);
  };
}
