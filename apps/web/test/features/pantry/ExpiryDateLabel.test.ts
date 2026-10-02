import { describe, expect, it } from 'vitest';
import {
  expiryDateLabelOf,
  remainingDaysLabelOf,
} from '../../../src/features/pantry/ExpiryDateLabel.js';

/**
 * 期限の日付の文字と残日数の文字（B-65 設計 5章 / 6章 規則7・8 / ADR-074）。
 *
 * 文言は ADR-074 で確定した（`docs/design/` の原本 ★11）ので、期待値に literal で書く。
 */

describe('期限の日付の文字 expiryDateLabelOf', () => {
  it('YYYY-MM-DD を「M月D日（曜）」にする', () => {
    // B-65 規則7 / ADR-074: 年を出さず、括弧は全角。
    expect(expiryDateLabelOf('2026-10-03')).toBe('10月3日（土）');
  });

  it('1桁の月と日はゼロ詰めしない', () => {
    // B-65 規則7。
    expect(expiryDateLabelOf('2026-01-05')).toBe('1月5日（月）');
  });

  it('曜日は日月火水木金土の7つを暦どおりに当てる', () => {
    // B-65 規則7: 曜は `日月火水木金土`。1週間ぶんを並べて確かめる。
    expect(
      [
        '2026-10-04',
        '2026-10-05',
        '2026-10-06',
        '2026-10-07',
        '2026-10-08',
        '2026-10-09',
        '2026-10-10',
      ].map(expiryDateLabelOf),
    ).toEqual([
      '10月4日（日）',
      '10月5日（月）',
      '10月6日（火）',
      '10月7日（水）',
      '10月8日（木）',
      '10月9日（金）',
      '10月10日（土）',
    ]);
  });

  it('年は出さないが、曜日はその年の暦で数える', () => {
    // B-65 規則7: 2027-10-03 は日曜（2026-10-03 の土曜とは違う）。
    expect(expiryDateLabelOf('2027-10-03')).toBe('10月3日（日）');
  });

  it('うるう年の2月29日も日付として扱う', () => {
    // B-65 規則7: 2028 はうるう年。
    expect(expiryDateLabelOf('2028-02-29')).toBe('2月29日（火）');
  });

  it('暦に無い日付はそのまま返す', () => {
    // B-65 規則7: 値を隠さない。
    expect(expiryDateLabelOf('2026-02-30')).toBe('2026-02-30');
  });

  it('YYYY-MM-DD でない文字列はそのまま返す', () => {
    // B-65 規則7。
    expect(expiryDateLabelOf('2026/10/03')).toBe('2026/10/03');
  });
});

describe('残日数の文字 remainingDaysLabelOf', () => {
  it('残日数が0なら「今日」', () => {
    // B-65 規則8 / FR-12: 一覧と同じ語。
    expect(remainingDaysLabelOf(0)).toBe('今日');
  });

  it('残日数が正なら「あとN日」', () => {
    // B-65 規則8 / FR-11。
    expect(remainingDaysLabelOf(2)).toBe('あと2日');
  });

  it('残日数が負なら「N日過ぎ」', () => {
    // B-65 規則8 / FR-12: 超過は負の数の絶対値で言う。
    expect(remainingDaysLabelOf(-1)).toBe('1日過ぎ');
  });
});
