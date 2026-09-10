import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';

/**
 * 提示された資格から世帯を定める出口（B-07e 設計書 5章）。
 *
 * 検証の手段は実装（腐敗防止層）に閉じる。ドメイン層はここで
 * 「資格1つ → 世帯1つ、通らなければ投げる」という約束だけを持つ（ADR-005）。
 * 返すのは `HouseholdId` 1つだけで、他のクレームは持ち出さない（規則5 / NFR-11）。
 */
export interface HouseholdAuthenticator {
  /** @throws IdentityRuleViolation 資格が通らないとき */
  authenticate(accessToken: string): Promise<HouseholdId>;
}
