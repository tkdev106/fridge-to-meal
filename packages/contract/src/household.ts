// 世帯の DTO（B-75）。web と api がここだけを共有する（ADR-003）。
//
// ここにあるのは型だけであり、実行時の検証も関数も持たない。
// 世帯は認証された利用者から定まるため持たせない（C-9 / NFR-09）。

/** 世帯の人数（FR-47）。`HouseholdMember` の数であり、キーは省略しない。 */
export type HouseholdMemberCountOutput = { memberCount: number };
