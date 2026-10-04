import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { HouseholdMemberCounter } from '../domain/port/HouseholdMemberCounter.js';

/** 世帯の人数を返す（B-75 設計書 5章 / FR-47）。世帯は第1引数で受け取る（C-9）。 */
export type CountHouseholdMembers = (householdId: HouseholdId) => Promise<number>;

/**
 * 人数を返すユースケースを組み立てる。口が投げた例外は包まずに伝える — `IdentityRuleViolation` に
 * 包むと api 層で 401 に化け、サーバ側の不備を利用者のせいにする（ADR-045）。
 */
export function countHouseholdMembers(deps: {
  householdMemberCounter: HouseholdMemberCounter;
}): CountHouseholdMembers {
  return (householdId) => deps.householdMemberCounter.count(householdId);
}
