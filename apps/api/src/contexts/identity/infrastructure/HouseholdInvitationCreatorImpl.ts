import { sql } from 'drizzle-orm';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { HouseholdTransaction } from '../../../shared/infrastructure/db/HouseholdTransaction.js';
import type { HouseholdInvitationCreator } from '../domain/port/HouseholdInvitationCreator.js';

/**
 * `HouseholdInvitationCreator` の実装（B-74 設計書 4章・5章）。
 *
 * 移行が置いた `private.create_household_invitation()` を、受け取ったトランザクションの中で呼ぶ。
 * **世帯を SQL に渡さない** — 誰の世帯の招待を作るかはクレーム（`auth.uid()`）が決める（設計書 規則12）。
 *
 * 呼び出しの失敗は包まずにそのまま伝える（ADR-045）。
 */
export class HouseholdInvitationCreatorImpl implements HouseholdInvitationCreator {
  constructor(private readonly tx: HouseholdTransaction) {}

  async create(_householdId: HouseholdId): Promise<string> {
    const [row] = await this.tx.execute<{ token: string }>(
      sql`select private.create_household_invitation() as token`,
    );
    return row!.token;
  }
}
