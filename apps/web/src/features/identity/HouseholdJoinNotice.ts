/**
 * 参加した結末から、参加の確認の画面が出す案内を選ぶ（FR-45 / ADR-087 決定4 / B-77）。
 *
 * **判断はここに置き、日本語は `.tsx` が持つ**（先行 `CookingRecordFailureNotice.ts`）。
 * 門（`App.tsx`）と画面（`HouseholdJoinScreen.tsx`）は、結末をこの1つだけで読む。
 */

import type { JoinHouseholdOutcome } from '../../server/HouseholdRequests.js';

/**
 * 出す案内の種類。`invalidInvitation`（無い・切れた・使用済みの招待）と `alreadyMember`
 * （すでに同じ冷蔵庫を共有している）は利用者に打ち手が無い断りで、トークンを捨てる。
 * `unavailable` はそれ以外のすべてで、原因を断定しない。
 */
export type HouseholdJoinNotice = 'invalidInvitation' | 'alreadyMember' | 'unavailable';

/** 案内に読み分ける断りの `rule`。表に無い `rule` は `unavailable` に倒す（ADR-032 決定3）。 */
const REJECTION_NOTICES: ReadonlyMap<string, HouseholdJoinNotice> = new Map<
  string,
  HouseholdJoinNotice
>([
  ['joinHousehold.invalidInvitation', 'invalidInvitation'],
  ['joinHousehold.alreadyMember', 'alreadyMember'],
]);

/** 結末から案内を選ぶ。**参加できたときは案内を出さない**（`null`）。 */
export function householdJoinNoticeOf(outcome: JoinHouseholdOutcome): HouseholdJoinNotice | null {
  switch (outcome.outcome) {
    case 'joined':
      return null;
    case 'rejected':
      return REJECTION_NOTICES.get(outcome.rule) ?? 'unavailable';
    case 'failed':
      return 'unavailable';
  }
}
