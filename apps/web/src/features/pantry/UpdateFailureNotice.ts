/**
 * 更新の結末から、画面が出す案内を選ぶ（FR-05 / ADR-032 決定3 / ADR-050 結果5 / B-55）。
 */

import type { UpdateStockItemOutcome } from '../../server/StockItemRequests.js';

/**
 * 出す案内の種類（B-55 設計 5章 / 規則10・11）。
 *
 * **`gone` は削除の側に無い案内である。** `deleteFailureNoticeOf` は `delete.notFound` を
 * 「すでに消えている」と読んで `null` を返すが（ADR-050）、更新では案内を出す — 利用者は
 * 書いた内容を持っており、消えた相手に書き戻せない以上、伝えるべきことがある
 * （**ADR-050 結果5** が後続へ送った読み分けをここで引き取る）。
 *
 * **`amountInvalid` と `expiryDateInvalid` だけが「利用者が直せる」側である** — 直す欄を伝えられる。
 * 名称の断りに当たるものは無い（名称を送らないため。規則1・11）。
 */
export type UpdateFailureNotice = 'gone' | 'amountInvalid' | 'expiryDateInvalid' | 'unavailable';

/**
 * 案内を選び分ける `rule`（api 層の写像の表 `RuleViolationStatus.ts` が正）。
 *
 * **期限の2つを1つの案内に畳む。** `expiryDate.format`（書式が `YYYY-MM-DD` でない）と
 * `expiryDate.notACalendarDate`（暦に存在しない日付）は、利用者から見ればどちらも
 * 「期限を直す」ことで通る。区別は開発者向けである（先行 `RegisterFailureNotice.ts`）。
 *
 * **`name.*` は載せない**（規則11 / NFR-19）— 名称は送らないので、この断りが来たとしても
 * 利用者に直せる欄が無い。載せると、直せない欄を直させる案内になる。
 */
const NOTICES_BY_RULE: Readonly<Record<string, UpdateFailureNotice>> = {
  'update.notFound': 'gone',
  'amount.tooLong': 'amountInvalid',
  'amount.controlCharacter': 'amountInvalid',
  'expiryDate.format': 'expiryDateInvalid',
  'expiryDate.notACalendarDate': 'expiryDateInvalid',
};

/**
 * 表に無い `rule` と、理由の無い失敗の行き先（規則11）。
 *
 * 認証の断り（401）も `save.householdMismatch`（500）も `request.invalidBody`（呼び出し側の
 * 誤り）も、欄を直しても通らない — 倒すと、直しようのない失敗を利用者のせいにする
 * （ADR-045 の構えと同じ）。**原因を断定しない。**
 */
const UNAVAILABLE: UpdateFailureNotice = 'unavailable';

/**
 * 結末から案内を選ぶ。**通ったときは案内を出さない**（`null`）。
 *
 * **`null` を返すのは通った回だけである**（規則8・10）— 削除と違い、断りの中に `null` へ
 * 落ちるものが1つも無い。画面を閉じるかどうかもこの1つの読みに従う（`PantryTab`）。
 */
export function updateFailureNoticeOf(outcome: UpdateStockItemOutcome): UpdateFailureNotice | null {
  if (outcome.outcome === 'updated') return null;
  if (outcome.outcome === 'failed') return UNAVAILABLE;

  return NOTICES_BY_RULE[outcome.rule] ?? UNAVAILABLE;
}
