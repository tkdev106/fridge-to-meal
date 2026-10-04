import { sql } from 'drizzle-orm';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { HouseholdTransaction } from '../../../shared/infrastructure/db/HouseholdTransaction.js';
import type { HouseholdLeaver } from '../domain/port/HouseholdLeaver.js';

/**
 * `HouseholdLeaver` の実装（B-75 設計書 4章・5章）。
 *
 * 移行が置いた `private.leave_household()` を、受け取ったトランザクションの中で呼ぶ。
 * **世帯を SQL に渡さない** — 誰が抜けるかはクレーム（`auth.uid()`）が決める（設計書 規則11）。
 * 自分しか居ない世帯かどうかの判定も関数の側にある（規則6）。
 *
 * 呼び出しの失敗は包まずにそのまま伝える（ADR-045）。
 */
export class HouseholdLeaverImpl implements HouseholdLeaver {
  constructor(private readonly tx: HouseholdTransaction) {}

  async leave(_householdId: HouseholdId): Promise<boolean> {
    const [row] = await this.tx.execute<{ has_left: boolean }>(
      sql`select private.leave_household() as has_left`,
    );
    return row!.has_left;
  }
}
