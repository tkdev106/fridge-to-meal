import { sql } from 'drizzle-orm';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { HouseholdTransaction } from '../../../shared/infrastructure/db/HouseholdTransaction.js';
import type { HouseholdMemberCounter } from '../domain/port/HouseholdMemberCounter.js';

/**
 * `HouseholdMemberCounter` の実装（B-75 設計書 4章・5章）。
 *
 * 移行が置いた `private.household_member_count()` を、受け取ったトランザクションの中で呼ぶ。
 * **世帯を SQL に渡さない** — 誰の世帯を数えるかはクレーム（`auth.uid()`）が決める（設計書 規則11）。
 * 関数は `integer` を返すので、値は数値のまま届く。
 *
 * 呼び出しの失敗は包まずにそのまま伝える（ADR-045）。
 */
export class HouseholdMemberCounterImpl implements HouseholdMemberCounter {
  constructor(private readonly tx: HouseholdTransaction) {}

  async count(_householdId: HouseholdId): Promise<number> {
    const [row] = await this.tx.execute<{ member_count: number }>(
      sql`select private.household_member_count() as member_count`,
    );
    return row!.member_count;
  }
}
