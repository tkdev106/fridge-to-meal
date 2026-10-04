import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import { IdentityRuleViolation } from '../domain/error/IdentityRuleViolation.js';
import type { HouseholdLeaver } from '../domain/port/HouseholdLeaver.js';

/** 世帯を抜ける（B-75 設計書 5章 / FR-46）。世帯は第1引数で受け取る（C-9）。 */
export type LeaveHousehold = (householdId: HouseholdId) => Promise<void>;

/**
 * 世帯を抜けるユースケースを組み立てる。**人数を先に問わない** — 1人かどうかの判定は DB の
 * 関数の1か所に置き、出口が「何もしなかった」と返したときだけ断る（B-75 設計書 規則6）。
 * 口が投げた例外は包まずに伝える（ADR-045）。
 */
export function leaveHousehold(deps: { householdLeaver: HouseholdLeaver }): LeaveHousehold {
  return async (householdId) => {
    const left = await deps.householdLeaver.leave(householdId);
    if (!left) {
      throw new IdentityRuleViolation(
        'leaveHousehold.alone',
        '自分しか居ない世帯からは抜けられない',
      );
    }
  };
}
