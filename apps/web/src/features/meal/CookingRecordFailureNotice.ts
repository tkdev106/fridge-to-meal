/**
 * 調理記録の結末から、画面が出す案内を選ぶ（FR-22 / ADR-032 決定3 / B-53）。
 *
 * **判断はここに置き、日本語は `.tsx` が持つ**（先行 `DeleteFailureNotice.ts` と同じ置き方）。
 * 返すのは案内の識別子だけで、文言は `MealDetail.tsx` の表が持つ — 文言も配色も未確定であり
 * （`docs/screen-design.md` 論点3）、純粋関数に持たせるとテストが仮の文言を固定してしまう。
 *
 * **表がここ（画面の側）にあるのは、`rule` の読み方が画面の判断だからである。** 継ぎ目
 * （`server/MealRequests.ts`）は `rule` をそのまま運ぶだけである。
 */

import type { AddCookingRecordOutcome } from '../../server/MealRequests.js';

/**
 * 出す案内の種類。**いまは1つだけである。**
 *
 * 記録には、利用者が入力を直せば通る断りが**1つも無い** — 押す操作に入力が無く、
 * 指す献立は画面が開いているものである。そこで案内は「いま記録できない」の1つに倒し、
 * **原因を断定しない**（先行 `DeleteFailureNotice`）。
 */
export type CookingRecordFailureNotice = 'unavailable';

/**
 * すべての断りと、理由の無い失敗の行き先。
 *
 * **`addCookingRecord.mealNotFound` も畳む** — ここが `delete.notFound` を `null` に読む
 * 先行（ADR-050）と**逆になる**ところである。あちらは「すでに消えている」なら利用者が
 * 求めた状態そのものだが、献立は消えず（C-3。削除の機能が無い）、他世帯の献立は画面から
 * 指せない（C-9）。つまりこの断りが来た回は、**押した記録が入っていない**うえに
 * 利用者に打ち手が無い。黙って通すと、記録できていないのに記録できたように見える。
 */
const UNAVAILABLE: CookingRecordFailureNotice = 'unavailable';

/**
 * 結末から案内を選ぶ。**記録できたときは案内を出さない**（`null`）。
 *
 * **`null` は「思ったとおりになった」ことを表す**（先行 `deleteFailureNoticeOf`）。
 */
export function cookingRecordFailureNoticeOf(
  outcome: AddCookingRecordOutcome,
): CookingRecordFailureNotice | null {
  return outcome.outcome === 'recorded' ? null : UNAVAILABLE;
}
