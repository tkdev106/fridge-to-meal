/**
 * 在庫コンテキストの不変条件に反する入力を受け取ったときに投げる。
 *
 * ユースケース層がこれを捕まえて、利用者に見せる形（400 相当）に変換する。
 * **ドメインは HTTP のステータスコードを知らない**（ADR-003）ので、ここでは
 * 「どの規則に反したか」だけを持つ。
 */
export class PantryRuleViolation extends Error {
  /** 反した規則の名前。文言ではなく識別子であり、ユースケース層の分岐に使える。 */
  readonly rule: string;

  constructor(rule: string, message: string) {
    super(message);
    this.name = 'PantryRuleViolation';
    this.rule = rule;
  }
}
