/**
 * 在庫コンテキストの不変条件に反する入力を受け取ったときに投げる。
 *
 * ユースケース層はこれを捕まえず、そのまま呼び出し側へ伝える。利用者に見せる形への
 * 変換は api 層が担い、**どの状態コードに写すかは `rule` から引く**（B-08）。
 * `update.notFound` / `delete.notFound` のように 404 に写るものがあるため、
 * ここで状態コードを1つに決めない。
 * **ドメインは HTTP のステータスコードを知らない**（ADR-003）ので、ここでは
 * 「どの規則に反したか」だけを持つ。
 */
export class PantryRuleViolation extends Error {
  /**
   * 反した規則の名前。文言ではなく識別子であり、ユースケース層の分岐に使える。
   *
   * **利用者に見せる文言はここで決めない。** message は開発者向けの説明であり、
   * 画面の文言は rule を手がかりにプレゼンテーション層が選ぶ（screen-design.md は
   * 文言を決めない方針）。
   */
  readonly rule: string;

  constructor(rule: string, message: string) {
    super(message);
    this.name = 'PantryRuleViolation';
    this.rule = rule;
  }
}
