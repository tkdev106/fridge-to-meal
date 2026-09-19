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

/** 1時間のミリ秒。遡る幅を時間で受け取るのは、窓の幅が時間で決まっているためである（ADR-049 決定2）。 */
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * 基準の日時から `hours` 時間だけ遡った日時を返す（ADR-049 決定2 / B-31c）。
 *
 * **1日の生成回数を数える窓の下端を出すためにある。** 決定2 が「1日」を基準日時から遡る
 * 24時間の窓と定めたので、**暦日を1度も取り出さずに窓を表せる** — 暦日で切ると時間帯を
 * 1つ選ぶことになり、`docs/` にはその記述が無い（ADR-040 結果1 が送った判断）。
 *
 * 返すのも UTC の正準形である。**窓の内か外かは文字列の大小でそのまま比べられる**
 * （`dateTimeOf` が桁を揃えている。C-12）。
 *
 * **`hours` は呼ぶ側の定数であり、検査しない。** 受け取るのは既に `DateTime` を通った値と
 * モジュール直下の定数だけで、外から届く入力ではない（先行 `MealGenerator.requiredCount` の
 * 「契約の外」と同じ扱い）。
 */
export function hoursBeforeOf(dateTime: DateTime, hours: number): DateTime {
  // `DateTime` は正準形なので、解釈のぶれなく瞬間へ戻せる。引き算はミリ秒で行い、
  // 日付の桁を自分で繰り下げない — 月末と閏年の繰り下がりを2つ目の規則として持つことになる。
  return new Date(
    new Date(dateTime).getTime() - hours * MILLISECONDS_PER_HOUR,
  ).toISOString() as DateTime;
}
