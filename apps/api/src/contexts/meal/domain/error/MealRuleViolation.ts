/**
 * 献立コンテキストの不変条件に反する入力を受け取ったときに投げる。
 *
 * `PantryRuleViolation` と同じ形。**どの状態コードに写すかも、利用者に見せる文言も
 * ここでは決めない**（ドメインは HTTP を知らない。ADR-003）。持つのは
 * 「どの規則に反したか」だけである。
 */
export class MealRuleViolation extends Error {
  /**
   * 反した規則の名前。文言ではなく識別子であり、ユースケース層の分岐に使える。
   *
   * **利用者に見せる文言はここで決めない。** message は開発者向けの説明である。
   */
  readonly rule: string;

  constructor(rule: string, message: string) {
    super(message);
    this.name = 'MealRuleViolation';
    this.rule = rule;
  }
}
