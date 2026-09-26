import { describe, expect, it } from 'vitest';
import { updateFailureNoticeOf } from '../../../src/features/pantry/UpdateFailureNotice.js';

describe('更新の断りから選ぶ案内 updateFailureNoticeOf', () => {
  it('更新が通った結末には案内を出さない', () => {
    // FR-05 / B-55 規則8: 思ったとおりになったときは何も言わず、画面を閉じる。
    expect(updateFailureNoticeOf({ outcome: 'updated' })).toBeNull();
  });

  it('見つからない断りは消えていると読み流さず案内を選ぶ', () => {
    // ADR-050 結果5 / B-55 規則10: **削除と期待が反対である** —
    // `deleteFailureNoticeOf({ rule: 'delete.notFound' })` は「すでに消えている」と読んで
    // `null`（案内なし）を返すが、更新では案内を出す。利用者は書いた内容を持っており、
    // 消えた相手に書き戻せない以上、伝えるべきことがある。
    expect(updateFailureNoticeOf({ outcome: 'rejected', rule: 'update.notFound' })).toBe('gone');
  });

  it('期限の書式の断りは期限の案内を選ぶ', () => {
    // B-55 規則11 / 7章: 利用者が期限を直せば通る。
    expect(updateFailureNoticeOf({ outcome: 'rejected', rule: 'expiryDate.format' })).toBe(
      'expiryDateInvalid',
    );
  });

  it('暦に無い日付の断りも期限の案内を選ぶ', () => {
    // B-55 規則11: 期限の2つは1つの案内に畳む（区別は開発者向けである）。
    expect(
      updateFailureNoticeOf({ outcome: 'rejected', rule: 'expiryDate.notACalendarDate' }),
    ).toBe('expiryDateInvalid');
  });

  it('認証の断りは入力の誤りに倒さず使えない旨の案内を選ぶ', () => {
    // ADR-045 と同じ構え / B-55 規則11: 欄を直しても通らない。**原因を断定しない。**
    expect(updateFailureNoticeOf({ outcome: 'rejected', rule: 'accessToken.missing' })).toBe(
      'unavailable',
    );
  });

  it('写せない失敗の断りも使えない旨の案内を選ぶ', () => {
    // ADR-045 結果5: サーバ側の不備に利用者向けの文言は無く、伝えるべきは「いま使えない」だけ。
    expect(updateFailureNoticeOf({ outcome: 'rejected', rule: 'save.householdMismatch' })).toBe(
      'unavailable',
    );
  });

  it('名称が空の断りは表に無いので使えない旨の案内を選ぶ', () => {
    // B-55 規則11: **名称は送らない**ため、この `rule` は表に載せない（載せると、直せない欄を
    // 直させる案内になる）。
    expect(updateFailureNoticeOf({ outcome: 'rejected', rule: 'name.empty' })).toBe('unavailable');
  });

  it('理由の無い失敗も使えない旨の案内を選ぶ', () => {
    // B-22 設計 規則9 / B-55 7章: 通信の失敗も読めない応答もここに落ちており、見分ける材料が無い。
    expect(updateFailureNoticeOf({ outcome: 'failed' })).toBe('unavailable');
  });
});
