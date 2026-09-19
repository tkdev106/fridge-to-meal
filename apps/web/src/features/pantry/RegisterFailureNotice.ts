/**
 * 登録の結末から、画面が出す案内を選ぶ（FR-01 / ADR-032 決定3 / B-24）。
 *
 * **判断はここに置き、日本語は `.tsx` が持つ**（B-12 設計 規則9 と同じ置き方）。返すのは
 * 案内の識別子だけで、文言は `StockItemForm.tsx` の表が持つ — 文言も配色も未確定であり
 * （`docs/screen-design.md` 論点3）、純粋関数に持たせるとテストが仮の文言を固定してしまう。
 *
 * **表がここ（画面の側）にあるのは、`rule` の読み方が画面の判断だからである。** 継ぎ目
 * （`server/`）は `rule` をそのまま運ぶだけで、どれを「入力を直せば通る誤り」と読むかを知らない。
 */

import type { RegisterStockItemOutcome } from '../../server/StockItemRequests.js';

/**
 * 出す案内の種類。
 *
 * **`nameEmpty` と `expiryDateInvalid` は「利用者が直せる」側である** — どの欄を直せばよいかを
 * 伝えられる。それ以外はすべて `unavailable` に倒す（下の既定）。
 */
export type RegisterFailureNotice = 'nameEmpty' | 'expiryDateInvalid' | 'unavailable';

/**
 * 入力を直せば通る `rule` と、その案内（api 層の写像の表 `RuleViolationStatus.ts` が正）。
 *
 * **期限の2つを1つの案内に畳む。** `expiryDate.format`（書式が `YYYY-MM-DD` でない）と
 * `expiryDate.notACalendarDate`（暦に存在しない日付）は、利用者から見ればどちらも
 * 「期限を直す」ことで通る。区別は開発者向けである（`ExpiryDate.ts`）。
 */
const NOTICES_BY_RULE: Readonly<Record<string, RegisterFailureNotice>> = {
  'name.empty': 'nameEmpty',
  'expiryDate.format': 'expiryDateInvalid',
  'expiryDate.notACalendarDate': 'expiryDateInvalid',
};

/**
 * 表に無い `rule` と、理由の無い失敗の行き先。
 *
 * **表に無いものを入力の誤りに倒さない。** 認証の断り（401）も `unexpected`（500）も
 * `request.invalidBody`（呼び出し側の誤り）も、入力を直しても通らない — 倒すと、
 * 直しようのない失敗を利用者のせいにする（ADR-045 の構えと同じ）。
 */
const UNAVAILABLE: RegisterFailureNotice = 'unavailable';

/** 結末から案内を選ぶ。**通ったときは案内を出さない**（`null`）。 */
export function registerFailureNoticeOf(
  outcome: RegisterStockItemOutcome,
): RegisterFailureNotice | null {
  if (outcome.outcome === 'registered') return null;
  if (outcome.outcome === 'failed') return UNAVAILABLE;

  return NOTICES_BY_RULE[outcome.rule] ?? UNAVAILABLE;
}
