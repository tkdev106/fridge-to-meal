import { describe, expect, it } from 'vitest';
import { registerFailureNoticeOf } from '../../../src/features/pantry/RegisterFailureNotice.js';

/**
 * 断りの結末を1つ作る。本題（`rule`）だけが引数に現れる形にする（`docs/testing.md` 6章）。
 * `rule` の値は api 層の写像の表（`RuleViolationStatus.ts`）に実在するものだけを使う。
 */
function rejected(rule: string) {
  return { outcome: 'rejected', rule } as const;
}

describe('登録の断りから選ぶ案内 registerFailureNoticeOf', () => {
  it('登録が通った結末には案内を出さない', () => {
    // FR-01: 成功は断りではない。画面は何も出さず、3欄を空に戻す。
    expect(registerFailureNoticeOf({ outcome: 'registered' })).toBeNull();
  });

  it('名称が空の断りは食材名の案内を選ぶ', () => {
    // ADR-032 決定3 / `StockItem.ts` の `name.empty`: **利用者が入力を直せば通る。**
    expect(registerFailureNoticeOf(rejected('name.empty'))).toBe('nameEmpty');
  });

  it('期限の書式の断りは期限の案内を選ぶ', () => {
    // ADR-032 決定3 / `ExpiryDate.ts` の `expiryDate.format`: 直せるのは期限の欄である。
    expect(registerFailureNoticeOf(rejected('expiryDate.format'))).toBe('expiryDateInvalid');
  });

  it('暦に無い日付の断りも期限の案内を選ぶ', () => {
    // `ExpiryDate.ts` の `expiryDate.notACalendarDate`: 利用者にとっては書式の誤りと同じく
    // 「期限を直す」ことで通る。**2つの rule を1つの案内に畳む** — 区別は開発者向けである。
    expect(registerFailureNoticeOf(rejected('expiryDate.notACalendarDate'))).toBe(
      'expiryDateInvalid',
    );
  });

  it('表に無い rule は入力の誤りに倒さず使えない旨の案内を選ぶ', () => {
    // ADR-045 結果5 / `RuleViolationStatus.ts`: `unexpected` はサーバ側の不備であり、
    // 入力を直しても通らない。**表に無い rule を入力の誤りに倒さない** — 倒すと、
    // 直しようのない失敗を利用者のせいにする。
    expect(registerFailureNoticeOf(rejected('unexpected'))).toBe('unavailable');
  });

  it('理由の無い失敗も使えない旨の案内を選ぶ', () => {
    // B-22 設計 規則9 と同じ構え: 通信の失敗も読めない応答も、手がかりが無い点で同じである。
    expect(registerFailureNoticeOf({ outcome: 'failed' })).toBe('unavailable');
  });
});
