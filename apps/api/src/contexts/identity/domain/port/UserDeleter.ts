import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';

/**
 * 利用者を消す出口（B-56d 設計書 5章 / ADR-071 決定2）。
 *
 * 誰を消すかはトランザクションのクレームが決める（設計書 規則8）。
 */
export interface UserDeleter {
  delete(householdId: HouseholdId): Promise<void>;
}
