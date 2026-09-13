import { MealRuleViolation } from '../error/MealRuleViolation.js';

/**
 * 日時。生成日時と調理日時の表現（domain-model 4章）。
 *
 * UTC の正準形 `YYYY-MM-DDTHH:mm:ss.sssZ` に正規化して持つ。**文字列として並べ替えると
 * 時刻の順になる**ことが要件である（C-12 の「生成日時の新しい順」）。
 */
export type DateTime = string & { readonly __brand: 'DateTime' };

/**
 * 受け取るのは ISO-8601 の「瞬間」だけ。日付だけ・時刻だけの表記では瞬間が定まらず、
 * 時差を持たない表記はローカル時刻として解釈されて、同じ入力から実行環境ごとに
 * 違う文字列が出てしまう（C-12）。
 */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * 文字列を日時として扱う。
 *
 * @throws {MealRuleViolation} ISO-8601 の瞬間でないか、暦に存在しない日時のとき
 */
export function dateTimeOf(raw: string): DateTime {
  const trimmed = raw.trim();

  if (!ISO_DATE_TIME.test(trimmed)) {
    throw new MealRuleViolation(
      'dateTime.format',
      `日時の書式が ISO-8601 の瞬間ではありません: ${trimmed}`,
    );
  }

  // 書式だけでは 2026-02-30 のような日時が通ってしまう。Date に通して実在を確かめる
  // のは先行の expiryDateOf と同じだが、月や時刻が範囲の外なら Date が解釈できない
  // のに対し、日の繰り上がりは黙って行われる（2026-02-30 は 2026-03-02 になる）。
  // そのため日付の部分も UTC に置き直して入力と突き合わせる。
  const parsed = new Date(trimmed);
  const date = trimmed.slice(0, 10); // 書式の検査を通っているので、先頭10文字は YYYY-MM-DD
  const calendarDate = new Date(`${date}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    Number.isNaN(calendarDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== date
  ) {
    throw new MealRuleViolation(
      'dateTime.notACalendarDateTime',
      `暦に存在しない日時です: ${trimmed}`,
    );
  }

  // 時差つきの表記も同じ瞬間なら同じ文字列になり、ミリ秒の桁もそろう。
  // ここが崩れると、生成日時の新しい順が入力の書き方で変わる（C-12）。
  return parsed.toISOString() as DateTime;
}
