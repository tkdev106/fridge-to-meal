/**
 * 期限までの残日数と、基準日の算出（B-11 設計 5章）。
 *
 * 暦日の差だけを扱い、時刻もタイムゾーンも持ち込まない（同 6章 規則1）。
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `YYYY-MM-DD` を UTC の0時の時刻に直す。書式が違うか暦に存在しない日付なら `null`。
 *
 * 画面は期限が壊れていても例外を投げない（B-11 設計 規則4）。api 側の `expiryDateOf` は
 * 同じ検めを行って投げるが、こちらは1件のために一覧全体が出せなくなるほうが悪いため、
 * 未設定と同じ `null` に倒す。**前後の空白を落とさない**のも同じ理由で、
 * `YYYY-MM-DD` と厳密に一致しない値はすべて未設定として扱う。
 */
function utcMillisOf(date: string): number | null {
  if (!ISO_DATE.test(date)) return null;

  // 書式だけでは 2026-02-30 のような日付が通ってしまう。Date に通し、
  // 正規化された結果が入力と一致することで暦上の実在を確かめる。
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;

  return parsed.getTime();
}

/** 期限までの残日数。負は超過、0 は当日、期限未設定は null（FR-11 / FR-13）。 */
export function remainingDaysOf(expiryDate: string | null, today: string): number | null {
  if (expiryDate === null) return null;

  const expiryMillis = utcMillisOf(expiryDate);
  const todayMillis = utcMillisOf(today);
  if (expiryMillis === null || todayMillis === null) return null;

  // 両端とも UTC の0時なので、差は必ず1日の整数倍になる。夏時間のある地域でも
  // 1日が23時間・25時間になることがなく、数えるのは暦日の差だけで済む（規則1）。
  return (expiryMillis - todayMillis) / MILLIS_PER_DAY;
}

/** 実行環境の暦日を YYYY-MM-DD で返す。現在時刻は引数で受け取る（docs/testing.md 5章）。 */
export function todayOf(now: Date): string {
  // 利用者の「今日」は手元の暦日である（規則12）。`toISOString()` は UTC に寄り、
  // 時間帯によっては前日・翌日になるため使わない。
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}
