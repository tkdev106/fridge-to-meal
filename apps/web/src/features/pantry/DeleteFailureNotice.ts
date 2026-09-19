/**
 * 削除の結末から、画面が出す案内を選ぶ（FR-06 / ADR-032 決定3 / ADR-050 / B-23）。
 *
 * **判断はここに置き、日本語は `.tsx` が持つ**（先行 `RegisterFailureNotice.ts` と同じ置き方）。
 * 返すのは案内の識別子だけで、文言は `PantryList.tsx` の表が持つ — 文言も配色も未確定であり
 * （`docs/screen-design.md` 論点3）、純粋関数に持たせるとテストが仮の文言を固定してしまう。
 *
 * **表がここ（画面の側）にあるのは、`rule` の読み方が画面の判断だからである。** 継ぎ目
 * （`server/`）は `rule` をそのまま運ぶだけで、どれを「すでに消えている」と読むかを知らない。
 */

import type { DeleteStockItemOutcome } from '../../server/StockItemRequests.js';

/**
 * 出す案内の種類。**いまは1つだけである。**
 *
 * 削除には、利用者が入力を直せば通る断りが**1つも無い** — 消す相手は一覧の行そのもので、
 * 打ち直せる入力が無い（登録の `nameEmpty` / `expiryDateInvalid` に当たるものが無い）。
 * そこで案内は「いま消せない」の1つに倒し、**原因を断定しない**（`PantryList` の
 * 取れなかったときの断りと同じ構え）。
 */
export type DeleteFailureNotice = 'unavailable';

/**
 * **「すでに消えている」と読む `rule`**（api 層の写像の表 `RuleViolationStatus.ts` が正）。
 *
 * ADR-027 は削除を冪等にせず、**存在しない・他の世帯・二度目の削除の3つを同じ `rule` に
 * 畳んだ**（404）。ADR-050 はこれを「すでに消えている」と読む — 利用者が求めたのは
 * **その行が消えていること**であって、いまの1回が消したことではない。
 *
 * **読むのはこの1つだけである。** 知らない `rule` を消えたことに倒すと、消えていない行を
 * 一覧から消したように見せる（下の既定）。
 */
const GONE_RULE = 'delete.notFound';

/**
 * 「すでに消えている」以外の断りと、理由の無い失敗の行き先。
 *
 * 認証の断り（401）も `unexpected`（500）も、利用者が行をもう一度なぞっても解消しない。
 * **利用者のせいに倒さない**（ADR-045 の構えと同じ）。
 */
const UNAVAILABLE: DeleteFailureNotice = 'unavailable';

/**
 * 結末から案内を選ぶ。**消えたときは案内を出さない**（`null`）。
 *
 * **`null` は「思ったとおりになった」ことを表す**（先行 `registerFailureNoticeOf` と同じ）。
 * 一覧を取り直すかどうかもこの1つの読みに従う（`App.tsx`）— 判断を2か所に置くと、
 * 「案内は出さないのに一覧は古いまま」のような食い違いが生まれる。
 */
export function deleteFailureNoticeOf(outcome: DeleteStockItemOutcome): DeleteFailureNotice | null {
  if (outcome.outcome === 'deleted') return null;
  if (outcome.outcome === 'failed') return UNAVAILABLE;

  return outcome.rule === GONE_RULE ? null : UNAVAILABLE;
}
