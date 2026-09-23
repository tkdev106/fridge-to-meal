// 例外 → 状態コードと `{ rule }` の写像（B-48b 設計書 7章 / ADR-062）。
//
// **例外クラスは import しない。** 判別は `name` が `'MealRuleViolation'` /
// `'IdentityRuleViolation'` かで行う（ADR-032 の決定2。api → domain は禁止）。
// 在庫の規則違反（`PantryRuleViolation`）はこの経路では読まない — 献立の経路から在庫の
// 規則違反が上がってくるなら、それは写せない失敗である。

import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ErrorResponseDto } from '@fridge-to-meal/contract';

/**
 * 献立の規則違反の写像（設計書7章）。**ここに無い `rule` は 500 に落ちる** —
 * この経路は利用者の入力を受け取らないので、在庫と違って 400 を既定にしない（ADR-062 決定3）。
 */
const MEAL_RULE_VIOLATION_STATUSES: Readonly<Record<string, ContentfulStatusCode>> = {
  // 上流が使える応答を返さなかった（S-6 / NFR-07）。
  'mealGenerator.empty': 502,
  // 呼び出し側の誤りであり、利用者の入力ではない（C-9 / C-3）。
  'save.householdMismatch': 500,
  'save.contentMismatch': 500,
};

/** 表に無い献立の規則違反。入力を受け取らない経路なので、サーバ側の誤りとして扱う。 */
const MEAL_DEFAULT_STATUS = 500;

/** 認証の規則違反は**すべて 401**（先行 表2 / ADR-032）。表に無い `rule` も同じ。 */
const IDENTITY_DEFAULT_STATUS = 401;

/**
 * 規則違反なら状態コードと `rule` を返し、**写せない失敗なら `null` を返す**（設計書7章）。
 *
 * 応答に載せるのは `rule` だけである。例外の `message` は開発者向けであり、
 * 識別子も世帯も出さない（NFR-09 / ADR-032 の決定3）。
 */
export function statusOfThrown(
  thrown: unknown,
): { status: ContentfulStatusCode; body: ErrorResponseDto } | null {
  const ruleViolation = toRuleViolation(thrown);
  if (ruleViolation === null) return null;

  const status =
    ruleViolation.name === 'MealRuleViolation'
      ? (MEAL_RULE_VIOLATION_STATUSES[ruleViolation.rule] ?? MEAL_DEFAULT_STATUS)
      : IDENTITY_DEFAULT_STATUS;

  return { status, body: { rule: ruleViolation.rule } };
}

/**
 * 投げられたものを規則違反として読む。規則違反でなければ `null`。
 *
 * **`name` と `rule` の両方がそろっていることを求める。** `rule` だけで引くと、
 * 別の層の例外が `rule` を持っているだけで献立の規則違反として扱われてしまう。
 */
function toRuleViolation(thrown: unknown): { name: string; rule: string } | null {
  if (typeof thrown !== 'object' || thrown === null) return null;

  const { name, rule } = thrown as { name?: unknown; rule?: unknown };
  if (typeof rule !== 'string') return null;
  if (name !== 'MealRuleViolation' && name !== 'IdentityRuleViolation') return null;

  return { name, rule };
}
