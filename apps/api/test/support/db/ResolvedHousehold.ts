import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * `withHouseholdTransaction` の本体が受け取った世帯を、`auth.users` に居る利用者の世帯として絞る道具
 * （B-82 設計 規則8 / ADR-098 決定2）。居ない利用者の世帯は `null` になるが、これを使う呼び出しは
 * どれも下ごしらえで利用者を置いてあるので、`null` が来たら下ごしらえの誤りとして投げる。
 *
 * 黙って既定の世帯に置き換えないのは、続きの `expect` が別の理由で落ちて読めなくなるためである。
 */
export function resolvedHousehold(householdId: HouseholdId | null): HouseholdId {
  if (householdId === null) {
    throw new Error('世帯が null に解決された。下ごしらえで利用者を auth.users に置いていない');
  }
  return householdId;
}
