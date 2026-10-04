import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import { IdentityRuleViolation } from '../domain/error/IdentityRuleViolation.js';
import type { HouseholdJoiner } from '../domain/port/HouseholdJoiner.js';

/** 招待で世帯に参加する（B-74 設計書 5章 / FR-45）。世帯は第1引数で受け取る（C-9）。 */
export type JoinHousehold = (householdId: HouseholdId, token: string) => Promise<void>;

/**
 * 招待で参加するユースケースを組み立てる。使える招待かどうかの判定は DB の関数の1か所に置き、
 * 出口が返した結末が `joined` でなければ規則違反として断る（設計書 規則11）。
 * 口が投げた例外は包まずに伝える（ADR-045）。
 */
export function joinHousehold(deps: { householdJoiner: HouseholdJoiner }): JoinHousehold {
  return async (householdId, token) => {
    const outcome = await deps.householdJoiner.join(householdId, token);
    if (outcome === 'invalidInvitation') {
      throw new IdentityRuleViolation(
        'joinHousehold.invalidInvitation',
        '無い・切れた・使用済みの招待では参加できない',
      );
    }
    if (outcome === 'alreadyMember') {
      throw new IdentityRuleViolation(
        'joinHousehold.alreadyMember',
        '既に居る世帯の招待では参加できない',
      );
    }
  };
}
