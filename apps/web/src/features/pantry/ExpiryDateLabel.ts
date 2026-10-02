/**
 * 期限の日付の文字と残日数の文字（B-65 設計 5章 / 6章 規則7・8）。
 *
 * **`Intl` に頼らず自前で組む**（設計 9章）— 実行環境の言語設定で書式が変わらないようにする。
 * 曜日は暦日から UTC で数え、実行環境の時間帯に左右されない（先行 `RemainingDays.ts` 規則1）。
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 曜日の文字。`Date#getUTCDay` の並び（日曜が 0）に合わせる。 */
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** YYYY-MM-DD を `M月D日（曜）` にする。暦上無効な文字列はそのまま返す */
export function expiryDateLabelOf(expiryDate: string): string {
  const matched = ISO_DATE.exec(expiryDate);
  if (matched === null) return expiryDate;

  // 書式だけでは 2026-02-30 が通る。UTC の0時に直し、正規化した結果が入力と一致することで
  // 暦上の実在を確かめる（先行 `RemainingDays.ts` の `utcMillisOf` と同じ検め）。**値を隠さない** —
  // 壊れた値は加工せずに返す（規則7）。
  const parsed = new Date(`${expiryDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== expiryDate) {
    return expiryDate;
  }

  // 年は出さない（原本 ★11）。月日はゼロ詰めしない。
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const weekday = WEEKDAYS[parsed.getUTCDay()] ?? '';

  return `${month}月${day}日（${weekday}）`;
}

/** 残日数を `今日` / `あとN日` / `N日過ぎ` にする */
export function remainingDaysLabelOf(remainingDays: number): string {
  // 一覧と同じ語（FR-11 / FR-12）。超過は負の数の絶対値で言う。
  if (remainingDays === 0) return '今日';

  return remainingDays > 0 ? `あと${remainingDays}日` : `${-remainingDays}日過ぎ`;
}
