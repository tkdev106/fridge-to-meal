/**
 * 履歴の列を日ごとのまとまりに分ける純粋関数（B-74 設計 6章 規則7〜9 / ADR-083 決定3）。
 *
 * **入力の日時は端末の時刻で組む**（`new Date(年, 月, 日, 時, 分).toISOString()`。先行
 * `RemainingDays.test.ts` の `todayOf`）。こうすると実行環境の時刻帯がどこでも、端末の暦日で
 * 区切られることを同じ期待値で確かめられる。
 *
 * **時刻帯を名指しするのは「UTC で区切らない」ことを観る2件だけである**（規則7）。端末の時刻で
 * 組んだ入力では、UTC で区切る実装も実行環境が UTC なら緑になってしまうため、そこだけ
 * `TZ` を `Asia/Tokyo` に差し替える。**差し替えはこのファイルを走らせるプロセスの中に閉じる** —
 * vitest の既定の pool（`forks`）はテストファイルごとに子プロセスで走らせるので、他のファイルの
 * 時刻帯には漏れない。後始末は `afterEach` で戻す。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CookedMealSummaryOutput, SeenMealSummaryOutput } from '@fridge-to-meal/contract';
import { historyDaysOf } from '../../../src/features/meal/HistoryDays.js';

function seenOf(mealId: string, generatedAt: string): SeenMealSummaryOutput {
  return { mealId, title: `献立 ${mealId}`, ingredientCount: 2, generatedAt };
}

function cookedOf(mealId: string, cookedAt: string): CookedMealSummaryOutput {
  return { mealId, title: `献立 ${mealId}`, ingredientCount: 2, cookedAt };
}

/** 以前見た列を分ける。取り出すのは生成日時である（設計 5章）。 */
function seenDaysOf(meals: readonly SeenMealSummaryOutput[]) {
  return historyDaysOf(meals, (meal) => meal.generatedAt);
}

/** 端末の時刻で組んだ日時を UTC の ISO 8601 にする（サーバが届ける形。ADR-083 決定2）。 */
function localDateTime(year: number, monthIndex: number, day: number, hour: number, minute = 0) {
  return new Date(year, monthIndex, day, hour, minute).toISOString();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('履歴の日ごとのまとまり historyDaysOf', () => {
  it('同じ日の献立は、届いた順のまま1つのまとまりにする', () => {
    // 規則9 / ADR-083 決定3: 続く同じ日付の行を1つにまとめ、並べ替えない。
    const evening = seenOf('meal-b', localDateTime(2026, 9, 3, 19));
    const morning = seenOf('meal-a', localDateTime(2026, 9, 3, 8));

    const days = seenDaysOf([evening, morning]);

    expect(days.map((day) => day.meals)).toEqual([[evening, morning]]);
  });

  it('違う日の献立は、届いた順に別のまとまりにする', () => {
    // 規則9: 並びは届いたまま（降順に並べるのはサーバ。ADR-083 決定1）。
    const later = seenOf('meal-b', localDateTime(2026, 9, 3, 8));
    const earlier = seenOf('meal-a', localDateTime(2026, 9, 1, 8));

    const days = seenDaysOf([later, earlier]);

    expect(days.map((day) => day.meals)).toEqual([[later], [earlier]]);
  });

  it('まとまりの鍵は、端末の時刻帯の暦日を YYYY-MM-DD で表したものである', () => {
    // 規則7 / ADR-083 決定3
    const days = seenDaysOf([seenOf('meal-a', localDateTime(2026, 9, 13, 15, 30))]);

    expect(days.map((day) => day.key)).toEqual(['2026-10-13']);
  });

  it('鍵の月と日は、1桁でも2桁に0で埋める', () => {
    // 規則7: 書式は YYYY-MM-DD（先行 `todayOf`）。
    const days = seenDaysOf([seenOf('meal-a', localDateTime(2026, 0, 2, 9, 5))]);

    expect(days.map((day) => day.key)).toEqual(['2026-01-02']);
  });

  it('見出しの文字は「2026年10月3日」の形である', () => {
    // 規則8 / ADR-083 決定3
    const days = seenDaysOf([seenOf('meal-a', localDateTime(2026, 9, 3, 8))]);

    expect(days.map((day) => day.label)).toEqual(['2026年10月3日']);
  });

  it('見出しの月と日は0で埋めない', () => {
    // 規則8: 月日を0で埋めない（先行 `ExpiryDateLabel`）。
    const days = seenDaysOf([seenOf('meal-a', localDateTime(2026, 0, 2, 9))]);

    expect(days.map((day) => day.label)).toEqual(['2026年1月2日']);
  });

  it('端末の0時ちょうどはその日に入り、直前の23時59分は前の日に入る', () => {
    // 規則7: 日の区切りは端末の0時である。
    const midnight = seenOf('meal-b', localDateTime(2026, 9, 3, 0, 0));
    const lastMinute = seenOf('meal-a', localDateTime(2026, 9, 2, 23, 59));

    const days = seenDaysOf([midnight, lastMinute]);

    expect(days.map((day) => [day.key, day.meals])).toEqual([
      ['2026-10-03', [midnight]],
      ['2026-10-02', [lastMinute]],
    ]);
  });

  it('UTC では同じ日でも、端末の時刻帯で日が違えば別のまとまりにする', () => {
    // 規則7 / ADR-083 決定3: `toISOString` で UTC に寄せない。どちらも UTC では 10月2日だが、
    // 東京では 10月3日 01:00 と 10月2日 23:00 である。
    vi.stubEnv('TZ', 'Asia/Tokyo');
    const afterMidnight = seenOf('meal-b', '2026-10-02T16:00:00.000Z');
    const beforeMidnight = seenOf('meal-a', '2026-10-02T14:00:00.000Z');

    const days = seenDaysOf([afterMidnight, beforeMidnight]);

    expect(days.map((day) => day.key)).toEqual(['2026-10-03', '2026-10-02']);
  });

  it('見出しの文字も、UTC ではなく端末の時刻帯の暦日で書く', () => {
    // 規則7・8: UTC では 10月2日 16:00、東京では 10月3日 01:00。
    vi.stubEnv('TZ', 'Asia/Tokyo');

    const days = seenDaysOf([seenOf('meal-a', '2026-10-02T16:00:00.000Z')]);

    expect(days.map((day) => day.label)).toEqual(['2026年10月3日']);
  });

  it('同じ日の間に別の日が挟まれば、同じ日でも別のまとまりにする', () => {
    // 規則9: まとめるのは「続く」同じ日だけで、並べ替えない（設計 10章 前提の最終行）。
    const first = seenOf('meal-a', localDateTime(2026, 9, 3, 19));
    const between = seenOf('meal-b', localDateTime(2026, 9, 2, 12));
    const last = seenOf('meal-c', localDateTime(2026, 9, 3, 8));

    const days = seenDaysOf([first, between, last]);

    expect(days.map((day) => [day.key, day.meals])).toEqual([
      ['2026-10-03', [first]],
      ['2026-10-02', [between]],
      ['2026-10-03', [last]],
    ]);
  });

  it('作った列は、取り出し関数が返す調理記録の日時で日を分ける', () => {
    // 設計 5章 / ADR-083 決定1・3: cooked は直近の調理記録の日時（`cookedAt`）で区切る。
    const later = cookedOf('meal-b', localDateTime(2026, 9, 3, 20));
    const earlier = cookedOf('meal-a', localDateTime(2026, 8, 30, 20));

    const days = historyDaysOf([later, earlier], (meal) => meal.cookedAt);

    expect(days.map((day) => [day.key, day.meals])).toEqual([
      ['2026-10-03', [later]],
      ['2026-09-30', [earlier]],
    ]);
  });

  it('0件の列からは、まとまりを1つも作らない', () => {
    // 規則9: 0件の日のまとまりは作らない。
    expect(seenDaysOf([])).toEqual([]);
  });
});
