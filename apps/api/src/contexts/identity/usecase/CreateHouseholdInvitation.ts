import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { HouseholdInvitationCreator } from '../domain/port/HouseholdInvitationCreator.js';

/** 世帯の招待を作り、そのトークンを返す（B-74 設計書 5章 / FR-44）。世帯は第1引数で受け取る（C-9）。 */
export type CreateHouseholdInvitation = (householdId: HouseholdId) => Promise<string>;

/**
 * 招待を作るユースケースを組み立てる。人数を問わない — 1人の世帯でも作れる（設計書 規則1）。
 * 口が投げた例外は包まずに伝える（ADR-045）。
 */
export function createHouseholdInvitation(deps: {
  householdInvitationCreator: HouseholdInvitationCreator;
}): CreateHouseholdInvitation {
  return async (householdId) => await deps.householdInvitationCreator.create(householdId);
}
