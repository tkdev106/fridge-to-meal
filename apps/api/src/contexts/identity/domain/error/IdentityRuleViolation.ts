/**
 * 世帯を定める規則に反する入力を受け取ったときに投げる（B-07e 設計書 7章）。
 *
 * 失敗の区別は例外クラスを増やさず `rule` の識別子で表す（ADR-025 / 規則7）。
 * どの状態コードに写すかはここで決めない — **ドメインは HTTP を知らない**（ADR-003）。
 * 写像は api 層（B-08）が `rule` から引く。
 */
export class IdentityRuleViolation extends Error {
  /**
   * 反した規則の名前。文言ではなく識別子であり、呼び出し側の分岐に使える。
   *
   * **利用者に見せる文言はここで決めない。** message は開発者向けの説明である。
   */
  readonly rule: string;

  constructor(rule: string, message: string) {
    super(message);
    this.name = 'IdentityRuleViolation';
    this.rule = rule;
  }
}
