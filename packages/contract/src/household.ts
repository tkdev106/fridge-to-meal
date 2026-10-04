// 世帯の DTO（B-75）。web と api がここだけを共有する（ADR-003）。
//
// ここにあるのは型だけであり、実行時の検証も関数も持たない。
// 世帯は認証された利用者から定まるため持たせない（C-9 / NFR-09）。

/** 世帯の人数（FR-47）。`HouseholdMember` の数であり、キーは省略しない。 */
export type HouseholdMemberCountOutput = { memberCount: number };

/** 作った招待（FR-44）。リンクの URL は web が組み立て、api はトークンだけを返す。 */
export type HouseholdInvitationOutput = { token: string };

/** 招待で参加する要求の本体（FR-45）。 */
export type AcceptHouseholdInvitationInput = { token: string };
