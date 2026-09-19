import { describe, expect, it } from 'vitest';
import { deleteFailureNoticeOf } from '../../../src/features/pantry/DeleteFailureNotice.js';

describe('削除の断りの読み分け deleteFailureNoticeOf', () => {
  it('消えた結末には案内を出さない', () => {
    // FR-06: 思ったとおりになったときは何も言わない（`docs/screen-design.md` 5章は
    // 確認も取り消しも置いていない）。
    expect(deleteFailureNoticeOf({ outcome: 'deleted' })).toBeNull();
  });

  it('見つからない断りにも案内を出さない', () => {
    // ADR-027 / ADR-050: **`delete.notFound` を「すでに消えている」と読む。** 利用者が
    // 求めたのは行が消えていることであり、この応答はそれが成り立っていることを意味する。
    expect(deleteFailureNoticeOf({ outcome: 'rejected', rule: 'delete.notFound' })).toBeNull();
  });

  it('認証の断りは使えないことの案内に倒す', () => {
    // ADR-045 と同じ構え: 利用者が行をもう一度なぞっても解消しない。**入力の誤りに倒さない。**
    expect(deleteFailureNoticeOf({ outcome: 'rejected', rule: 'accessToken.missing' })).toBe(
      'unavailable',
    );
  });

  it('写せない失敗の断りも使えないことの案内に倒す', () => {
    // ADR-045 結果5: サーバ側の不備に利用者向けの文言は無く、伝えるべきは「いま使えない」だけ。
    expect(deleteFailureNoticeOf({ outcome: 'rejected', rule: 'unexpected' })).toBe('unavailable');
  });

  it('表に無い rule を消えたことに倒さない', () => {
    // ADR-050: **消えたと読むのは `delete.notFound` の1つだけである。** 知らない `rule` を
    // 消えたことに倒すと、消えていない行を一覧から消したように見せる。
    expect(deleteFailureNoticeOf({ outcome: 'rejected', rule: 'name.empty' })).toBe('unavailable');
  });

  it('理由の無い失敗は使えないことの案内に倒す', () => {
    // B-22 設計 規則9: 通信の失敗も読めない応答もここに落ちており、見分ける材料が無い。
    expect(deleteFailureNoticeOf({ outcome: 'failed' })).toBe('unavailable');
  });
});
