import { describe, expect, it } from 'vitest';
import { dateTimeOf, hoursBeforeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';

describe('日時 DateTime', () => {
  it('UTC の正準形の日時をそのまま保つ', () => {
    // B-14a 規則8: 持つ形は YYYY-MM-DDTHH:mm:ss.sssZ。
    expect(dateTimeOf('2026-09-13T12:34:56.789Z')).toBe('2026-09-13T12:34:56.789Z');
  });

  it('ミリ秒のない表記にミリ秒を補って桁を揃える', () => {
    // B-14a 規則8 / C-12: 桁が揃わないと文字列の並びが崩れる。
    expect(dateTimeOf('2026-09-13T12:34:56Z')).toBe('2026-09-13T12:34:56.000Z');
  });

  it('時差つきの表記も、同じ瞬間なら同じ文字列になる', () => {
    // C-12 / B-14a 規則8: 同じ瞬間が2通りの文字列になると、生成日時の新しい順が
    // 入力の書き方で変わってしまう。
    expect(dateTimeOf('2026-09-14T06:00:00+09:00')).toBe('2026-09-13T21:00:00.000Z');
    expect(dateTimeOf('2026-09-13T21:00:00Z')).toBe('2026-09-13T21:00:00.000Z');
  });

  it('文字列として並べ替えると時刻の順になる', () => {
    // C-12: 生成日時の新しい順はこの表現に依存してよい、ということをここで固定しておく。
    const sorted = ['2026-09-13T21:00:00Z', '2026-09-13T12:34:56Z', '2026-09-14T06:00:00+09:00']
      .map((raw) => dateTimeOf(raw))
      .sort();

    expect(sorted).toEqual([
      '2026-09-13T12:34:56.000Z',
      '2026-09-13T21:00:00.000Z',
      '2026-09-13T21:00:00.000Z',
    ]);
  });

  it('瞬間を指さない表記を拒む', () => {
    // B-14a 規則8 / 7章: 受け取るのは ISO-8601 の瞬間。日付だけ・時刻だけでは瞬間が定まらない。
    expect(() => dateTimeOf('2026-09-13')).toThrow(MealRuleViolation);
    expect(() => dateTimeOf('12:34:56')).toThrow(MealRuleViolation);
  });

  it('タイムゾーンを持たない表記を拒む', () => {
    // C-12: ローカル時刻として解釈すると、同じ入力から実行環境ごとに違う文字列が出る。
    expect(() => dateTimeOf('2026-09-13T12:34:56')).toThrow(MealRuleViolation);
  });

  it('ISO-8601 でない書き方を拒む', () => {
    // B-14a 規則8 / 7章。
    expect(() => dateTimeOf('2026/09/13 12:34:56')).toThrow(MealRuleViolation);
    expect(() => dateTimeOf('')).toThrow(MealRuleViolation);
  });

  it('前後の空白は落とす', () => {
    // 先行 expiryDateOf / amountOf: 前後の空白を落としてから見る。
    expect(dateTimeOf('  2026-09-13T12:34:56Z  ')).toBe('2026-09-13T12:34:56.000Z');
  });

  it('書式の規則違反は識別子から判別できる', () => {
    // B-14a 7章 / ADR-025: 反した規則は識別子で持つ。文言ではなく rule で分岐できること。
    expect(() => dateTimeOf('2026-09-13')).toThrow(
      expect.objectContaining({ rule: 'dateTime.format' }),
    );
  });

  it('暦に存在しない日時を拒む', () => {
    // B-14a 7章 / 先行 expiryDate.notACalendarDate: 書式だけでは 2026-02-30 が通ってしまう。
    expect(() => dateTimeOf('2026-02-30T00:00:00Z')).toThrow(MealRuleViolation);
  });

  it('暦に存在しない日時の規則違反は識別子から判別できる', () => {
    // B-14a 7章 / ADR-025: 書式の違反とは別の規則として見分けられること。
    expect(() => dateTimeOf('2026-02-30T00:00:00Z')).toThrow(
      expect.objectContaining({ rule: 'dateTime.notACalendarDateTime' }),
    );
  });

  it('指定した時間だけ遡った日時を返す', () => {
    // ADR-048 決定2 / B-31c: 生成回数を数える窓の下端を出す。暦日を取り出さずに
    // 「1日」を表せることが、時間帯を選ばずに済む理由である。
    expect(hoursBeforeOf(dateTimeOf('2026-09-14T12:00:00Z'), 24)).toBe('2026-09-13T12:00:00.000Z');
  });

  it('遡って日をまたいでも UTC の正準形を保つ', () => {
    // ADR-048 決定2 / C-12: 返るのも `DateTime` であり、窓の下端と生成日時を文字列の
    // 大小で比べられること。**月をまたぐ側で見る** — 日の引き算だけで組んだ実装が落ちる。
    expect(hoursBeforeOf(dateTimeOf('2026-10-01T03:00:00+09:00'), 24)).toBe(
      '2026-09-29T18:00:00.000Z',
    );
  });
});
