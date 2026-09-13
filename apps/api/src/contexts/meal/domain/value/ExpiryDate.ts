import { MealRuleViolation } from '../error/MealRuleViolation.js';

/**
 * 期限。日付であり、時刻を持たない。`YYYY-MM-DD`。
 *
 * 表現を ISO の日付文字列に固定しているのは、**文字列として並べ替えると期限の近い順に
 * なる**ためである（ADR-036 決定1 の「期限の列」）。時刻やタイムゾーンを持たせると、
 * 同じ日の在庫品どうしの前後が実行環境で変わり、並びが決定的でなくなる（C-12）。
 *
 * 在庫コンテキストにも同名の型があるが、**献立側から `contexts/pantry/` は import
 * できない**ため、献立側に起こしている（ADR-033 / ADR-036 決定3）。規則は pantry 側の
 * `expiryDateOf` と同じで、**投げる例外だけが違う**。
 *
 * MVP では賞味期限と消費期限を区別せず、単一の「期限」に統合している（未決事項）。
 */
export type ExpiryDate = string & { readonly __brand: 'ExpiryDate' };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 文字列を期限として扱う。未入力（`null` / 空文字 / 空白のみ）は `null` を返す。
 *
 * 期限は任意入力であり、未設定の在庫品は並び順に効かない（FR-13 / ADR-036 結果3）。
 * 未設定の表し方を `null` に一本化するので、空文字や空白だけの入力も畳む。
 *
 * @throws {MealRuleViolation} 書式が `YYYY-MM-DD` でないか、暦に存在しない日付のとき
 */
export function expiryDateOf(raw: string | null): ExpiryDate | null {
  if (raw === null) return null;

  const trimmed = raw.trim();
  if (trimmed === '') return null;

  if (!ISO_DATE.test(trimmed)) {
    throw new MealRuleViolation(
      'expiryDate.format',
      `期限の書式が YYYY-MM-DD ではありません: ${trimmed}`,
    );
  }

  // 書式だけでは 2026-02-30 のような日付が通ってしまう。Date に通し、
  // 正規化された結果が入力と一致することで暦上の実在を確かめる。ここを通すと、
  // 期限の列（C-12 の並び）が静かに狂う。
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new MealRuleViolation(
      'expiryDate.notACalendarDate',
      `暦に存在しない日付です: ${trimmed}`,
    );
  }

  return trimmed as ExpiryDate;
}
