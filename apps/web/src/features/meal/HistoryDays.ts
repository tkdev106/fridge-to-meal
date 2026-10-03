/**
 * 履歴の列を日ごとのまとまりに分ける（ADR-083 決定3 / `docs/screen-design.md` 7章）。
 *
 * **日の区切りは見ている端末の時刻帯で決める** — サーバは日時を UTC のまま返し、日付に丸めない
 * （ADR-083 決定3。サーバは利用者の時刻帯を知らない）。**並べ替えない** — 並びはサーバが決め
 * （ADR-083 決定1）、ここは届いた順のまま、続く同じ日の行を1つのまとまりにするだけである。
 * 同じ日でも間に別の日が挟まれば別のまとまりになる（並びを崩さないため）。
 */

import type { MealSummaryOutput } from '@fridge-to-meal/contract';

/** 日ごとのまとまり（ADR-083 決定3）。 */
export type HistoryDay<T> = {
  /** 端末の時刻帯の暦日 `YYYY-MM-DD`。開閉の状態を覚える鍵になる。 */
  readonly key: string;
  /** 見出しの文字。`2026年10月3日`（0 で埋めない）。 */
  readonly label: string;
  readonly meals: readonly T[];
};

/** seen は `generatedAt`、cooked は `cookedAt` を `dateTimeOf` で取り出す（ADR-083 決定1・2）。 */
export function historyDaysOf<T extends MealSummaryOutput>(
  meals: readonly T[],
  dateTimeOf: (meal: T) => string,
): readonly HistoryDay<T>[] {
  const days: { key: string; label: string; meals: T[] }[] = [];
  for (const meal of meals) {
    // `Date` の `get*`（`getUTC*` ではない）が端末の時刻帯の暦日を返す。
    const dateTime = new Date(dateTimeOf(meal));
    const year = dateTime.getFullYear();
    const month = dateTime.getMonth() + 1;
    const day = dateTime.getDate();
    const key = `${String(year)}-${twoDigits(month)}-${twoDigits(day)}`;

    const last = days.at(-1);
    if (last !== undefined && last.key === key) {
      last.meals.push(meal);
    } else {
      days.push({
        key,
        label: `${String(year)}年${String(month)}月${String(day)}日`,
        meals: [meal],
      });
    }
  }
  return days;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}
