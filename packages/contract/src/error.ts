// 失敗の応答の DTO（B-08）。web と api がここだけを共有する（ADR-003）。
//
// 載せるのは `rule` だけである。文言は載せない — 画面が `rule` から選ぶ
// （PantryRuleViolation の注記 / ADR-032 の決定3）。例外の `message` は開発者向けであり、
// 識別子も世帯も応答に出さない（B-08 規則14 / NFR-09）。

/** 失敗の応答。状態コードへの写像は api 層が表として持つ。 */
export type ErrorResponseDto = {
  /** 断った理由の識別子。ドメインの規則違反なら `PantryRuleViolation.rule` と同じ値。 */
  rule: string;
};
