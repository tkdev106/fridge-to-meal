/**
 * 調理記録の断りの読み分け（B-53 2周目 / ADR-032 決定3。先行
 * `test/features/pantry/DeleteFailureNotice.test.ts`）。
 *
 * **日本語は `.tsx` が持つ**ので、期待値は識別子だけである（`docs/screen-design.md` 論点3）。
 */

import { describe, expect, it } from 'vitest';
import { cookingRecordFailureNoticeOf } from '../../../src/features/meal/CookingRecordFailureNotice.js';

describe('調理記録の断りの読み分け cookingRecordFailureNoticeOf', () => {
  it('記録できた結末には案内を出さない', () => {
    // `null` は「思ったとおりになった」を表す（先行 `deleteFailureNoticeOf`）。
    expect(cookingRecordFailureNoticeOf({ outcome: 'recorded' })).toBeNull();
  });

  it('献立が見つからない断りも、いま記録できないことの案内に倒す', () => {
    // **`delete.notFound` を `null` に読む先行と逆である**（ADR-050 とは事情が違う）。
    // 献立は消えず（C-3。削除の機能が無い）、他世帯の献立は画面から指せないため
    // （C-9）、この断りが来た回に利用者が直せるものが1つも無い。
    expect(
      cookingRecordFailureNoticeOf({
        outcome: 'rejected',
        rule: 'addCookingRecord.mealNotFound',
      }),
    ).toBe('unavailable');
  });

  it('表に無い rule も、いま記録できないことの案内に倒す', () => {
    // サーバ側の不備を利用者のせいにしない（ADR-045 の構え）。
    expect(cookingRecordFailureNoticeOf({ outcome: 'rejected', rule: 'unexpected' })).toBe(
      'unavailable',
    );
  });

  it('理由の無い失敗も、いま記録できないことの案内に倒す', () => {
    // 通信の失敗・401・500 を分けない（先行 `DeleteFailureNotice`）。
    expect(cookingRecordFailureNoticeOf({ outcome: 'failed' })).toBe('unavailable');
  });
});
