// 例外 → 状態コードと `{ rule }` の写像（B-08 設計書 7章）。
//
// **この表が無いと、規則違反はすべて 400 になる。** `update.notFound` と `delete.notFound`
// はどちらも「見つからない」を規則違反の一種として表しているため、404 と 400 の区別が
// `rule` の値に載っている（B-06 規則8 / B-06a 規則2 / ADR-027）。
//
// **例外クラスは import しない。** 判別は `name` が `'PantryRuleViolation'` /
// `'IdentityRuleViolation'` かで行う（ADR-032 の決定2。api → domain は禁止）。
// `name` はコンストラクタが固定文字列で設定しており、外向きの契約である（ADR-032 の結果2）。

import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ErrorResponseDto } from '@fridge-to-meal/contract';

/**
 * 在庫の規則違反の写像（設計書7章 表1）。**ここに無い `rule` は 400 に落ちる** —
 * 規則違反は入力の誤りが既定である。
 */
const 在庫の規則違反の状態コード: Readonly<Record<string, ContentfulStatusCode>> = {
  'name.empty': 400,
  'expiryDate.format': 400,
  'expiryDate.notACalendarDate': 400,
  // 見つからない。他の世帯を指したときも同じ扱いである（C-9）。
  'update.notFound': 404,
  'delete.notFound': 404,
  // 呼び出し側の誤りであり、利用者の入力ではない。要求を直しても通らないので 4xx にしない。
  'save.householdMismatch': 500,
};

/** 表に無い在庫の規則違反。入力の誤りが既定である（設計書7章 表1 の最終行）。 */
const 在庫の既定 = 400;

/**
 * 認証の規則違反は**すべて 401**（設計書7章 表2）。列挙を持たないのは、
 * 表に無い `rule` を 200 や 500 に化けさせないためである。
 */
const 認証の既定 = 401;

/**
 * 規則違反なら状態コードと `rule` を返し、**写せない失敗なら `null` を返す**（設計書7章）。
 *
 * 応答に載せるのは `rule` だけである。例外の `message` は開発者向けであり、
 * 識別子も世帯も出さない（設計書 規則14 / NFR-09 / ADR-032 の決定3）。
 */
export function statusOfThrown(
  thrown: unknown,
): { status: ContentfulStatusCode; body: ErrorResponseDto } | null {
  const 規則違反 = 規則違反として読む(thrown);
  if (規則違反 === null) return null;

  const status =
    規則違反.name === 'PantryRuleViolation'
      ? (在庫の規則違反の状態コード[規則違反.rule] ?? 在庫の既定)
      : 認証の既定;

  return { status, body: { rule: 規則違反.rule } };
}

/**
 * 投げられたものを規則違反として読む。規則違反でなければ `null`。
 *
 * **`name` と `rule` の両方がそろっていることを求める。** `rule` だけで引くと、
 * 別の層の例外が `rule` を持っているだけで在庫の規則違反として扱われてしまう。
 */
function 規則違反として読む(thrown: unknown): { name: string; rule: string } | null {
  if (typeof thrown !== 'object' || thrown === null) return null;

  const { name, rule } = thrown as { name?: unknown; rule?: unknown };
  if (typeof rule !== 'string') return null;
  if (name !== 'PantryRuleViolation' && name !== 'IdentityRuleViolation') return null;

  return { name, rule };
}
