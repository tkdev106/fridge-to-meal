import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';

/**
 * 世帯の人数（メンバーの数）を数える出口（B-75 設計書 5章 / FR-47 / ADR-087 決定1）。
 *
 * 誰の世帯を数えるかはトランザクションのクレームが決める（設計書 規則11）。引数の世帯は
 * 口の形を C-9 に揃えるためにある。
 */
export interface HouseholdMemberCounter {
  count(householdId: HouseholdId): Promise<number>;
}
