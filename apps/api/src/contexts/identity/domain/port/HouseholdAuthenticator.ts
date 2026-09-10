import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';

/**
 * 提示されたアクセストークンから世帯を定める出口（B-07e 設計書 5章）。
 *
 * 検証の手段は実装（腐敗防止層）に閉じる。ドメイン層はここで
 * 「アクセストークン1つ → 世帯1つ、通らなければ投げる」という約束だけを持つ（ADR-005）。
 * 返すのは `HouseholdId` 1つだけで、他のクレームは持ち出さない
 * （規則5 / `docs/domain-model.md` 2章 — コンテキストをまたぐ共有カーネルは `HouseholdId` のみ）。
 */
export interface HouseholdAuthenticator {
  /** @throws IdentityRuleViolation アクセストークンが通らないとき */
  authenticate(accessToken: string): Promise<HouseholdId>;
}
