import { sql } from 'drizzle-orm';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { HouseholdTransaction } from '../../../shared/infrastructure/db/HouseholdTransaction.js';
import type { HouseholdJoiner, JoinOutcome } from '../domain/port/HouseholdJoiner.js';

/** 関数が返す値 → 口の結末。DB の語はここで止め、domain に持ち込まない（ADR-005）。 */
const JOIN_OUTCOMES: Readonly<Record<string, JoinOutcome>> = {
  joined: 'joined',
  invalid_invitation: 'invalidInvitation',
  already_member: 'alreadyMember',
};

/**
 * `HouseholdJoiner` の実装（B-74 設計書 4章・5章）。
 *
 * 移行が置いた `private.join_household(invitation_token)` を、受け取ったトランザクションの中で呼ぶ。
 * **世帯を SQL に渡さない** — 誰が参加するかはクレーム（`auth.uid()`）が決め、渡すのはトークンだけ
 * である（設計書 規則12）。使える招待かどうかの判定も関数の側にある（規則4・5）。
 *
 * 呼び出しの失敗は包まずにそのまま伝える（ADR-045）。表に無い値が返るのは関数と実装の食い違いであり、
 * 規則違反には包まずに投げる。
 */
export class HouseholdJoinerImpl implements HouseholdJoiner {
  constructor(private readonly tx: HouseholdTransaction) {}

  async join(_householdId: HouseholdId, token: string): Promise<JoinOutcome> {
    const [row] = await this.tx.execute<{ outcome: string }>(
      sql`select private.join_household(${token}) as outcome`,
    );
    const outcome = JOIN_OUTCOMES[row!.outcome];
    if (outcome === undefined) {
      throw new Error(`参加の関数が知らない値を返した: ${row!.outcome}`);
    }
    return outcome;
  }
}
