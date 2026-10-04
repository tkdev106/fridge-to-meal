import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';

/**
 * 参加の結末（B-74 設計書 5章 / 規則4〜6）。無い・切れた・使用済みの招待は区別せず
 * `invalidInvitation` に畳む。
 */
export type JoinOutcome = 'joined' | 'invalidInvitation' | 'alreadyMember';

/**
 * 招待で世帯に参加する出口（B-74 設計書 5章 / FR-45 / ADR-087 決定5）。
 *
 * 誰が参加するかはトランザクションのクレームが決める（設計書 規則12）。引数の世帯は
 * 口の形を C-9 に揃えるためにある。
 */
export interface HouseholdJoiner {
  join(householdId: HouseholdId, token: string): Promise<JoinOutcome>;
}
