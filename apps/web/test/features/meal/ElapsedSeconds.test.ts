/**
 * 生成中の経過秒数（B-62 設計 6章 規則4 / 7章 行2 / NFR-04 / D-6）。
 *
 * 時刻は引数で渡す（`docs/testing.md` 5章）。本体は時計を読まない。
 */

import { describe, expect, it } from 'vitest';
import { elapsedSecondsOf } from '../../../src/features/meal/ElapsedSeconds.js';

/** 生成を求めた時刻（ミリ秒の epoch）。 */
const requestedAt = 1_790_000_000_000;

describe('経過秒数 elapsedSecondsOf', () => {
  it('開始と同じ時刻なら0秒を返す', () => {
    // 規則4: 押した直後は `0秒`。
    expect(elapsedSecondsOf(requestedAt, requestedAt)).toBe(0);
  });

  it('1秒に満たない端数は切り捨てる', () => {
    // 規則4: floor((now − 開始) / 1000)。
    expect(elapsedSecondsOf(requestedAt, requestedAt + 18_999)).toBe(18);
  });

  it('経過秒数に上限を設けず、48秒を超えても0に戻らない', () => {
    // 規則4: 原本で 48 を超えたら戻るのは見本用の動きなので写さない。
    expect(elapsedSecondsOf(requestedAt, requestedAt + 3_600_000)).toBe(3600);
  });

  it('開始が現在より未来でも例外にせず0秒を返す', () => {
    // 7章 行2: 時計の巻き戻り。負なら 0 にする（規則4）。
    expect(elapsedSecondsOf(requestedAt + 5_000, requestedAt)).toBe(0);
  });
});
