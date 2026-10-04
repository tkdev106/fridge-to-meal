import { sql } from 'drizzle-orm';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { HouseholdTransaction } from '../../../shared/infrastructure/db/HouseholdTransaction.js';
import type { UserDeleter } from '../domain/port/UserDeleter.js';

/**
 * `UserDeleter` の実装（B-56d 設計書 4章・5章 / ADR-071 決定1・2）。
 *
 * 移行が置いた `private.delete_own_account()` を、受け取ったトランザクションの中で呼ぶ。
 * **世帯を SQL に渡さない** — 関数は引数を取らず、誰を消すかはトランザクションに張られた
 * クレーム（`auth.uid()`）が決める（設計書 規則8）。呼ぶ側は必ず本人の利用者で
 * `withHouseholdTransaction` を張った `tx` を渡す。引数の世帯は口の形を C-9 に揃えるためにある。
 *
 * 呼び出しの失敗（関数が無い・権限が無い）は包まずにそのまま伝える。`IdentityRuleViolation` に
 * 包むと api 層で 401 に化け、サーバ側の不備を利用者のせいにする（ADR-045）。
 */
export class UserDeleterImpl implements UserDeleter {
  constructor(private readonly tx: HouseholdTransaction) {}

  async delete(_householdId: HouseholdId): Promise<void> {
    await this.tx.execute(sql`select private.delete_own_account()`);
  }
}
