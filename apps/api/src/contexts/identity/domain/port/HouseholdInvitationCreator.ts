import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';

/**
 * 世帯の招待を作る出口（B-74 設計書 5章 / FR-44 / ADR-087 決定3・4）。
 *
 * 誰の世帯の招待を作るかはトランザクションのクレームが決める（設計書 規則12）。引数の世帯は
 * 口の形を C-9 に揃えるためにある。
 */
export interface HouseholdInvitationCreator {
  /** 作った招待のトークンを返す。 */
  create(householdId: HouseholdId): Promise<string>;
}
