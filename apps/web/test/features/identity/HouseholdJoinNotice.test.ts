/**
 * 参加の結末の読み分け（B-77 設計 6章 規則8 / 7章 / ADR-032 決定3。先行
 * `test/features/meal/CookingRecordFailureNotice.test.ts`）。
 *
 * **日本語は `.tsx` が持つ**ので、期待値は識別子だけである。
 */

import { describe, expect, it } from 'vitest';
import { householdJoinNoticeOf } from '../../../src/features/identity/HouseholdJoinNotice.js';

describe('参加の結末の読み分け householdJoinNoticeOf', () => {
  it('参加できた結末には案内を出さない', () => {
    // 規則8: `null` は「思ったとおりになった」を表す（先行 `cookingRecordFailureNoticeOf`）。
    expect(householdJoinNoticeOf({ outcome: 'joined' })).toBeNull();
  });

  it('使えない招待の断りは、使えないリンクの案内に読む', () => {
    // 規則8 / 7章 / ADR-087 決定4: 無い・切れた・使用済みの招待（404）。
    expect(
      householdJoinNoticeOf({ outcome: 'rejected', rule: 'joinHousehold.invalidInvitation' }),
    ).toBe('invalidInvitation');
  });

  it('すでに共有している断りは、すでに共有している案内に読む', () => {
    // 規則8 / 7章 / ADR-087 決定5: 招待した人と同じ冷蔵庫に居る（409）。
    expect(
      householdJoinNoticeOf({ outcome: 'rejected', rule: 'joinHousehold.alreadyMember' }),
    ).toBe('alreadyMember');
  });

  it('本体の断りなど表に無い rule は、いま参加できないことの案内に倒す', () => {
    // 規則8 / 7章 / ADR-032 決定3: 利用者が直せない断りは原因を断定しない。
    expect(householdJoinNoticeOf({ outcome: 'rejected', rule: 'request.invalidBody' })).toBe(
      'unavailable',
    );
  });

  it('理由の無い失敗は、いま参加できないことの案内に倒す', () => {
    // 規則8 / 7章: 5xx・通信不能・トークンが無い回を分けない。
    expect(householdJoinNoticeOf({ outcome: 'failed' })).toBe('unavailable');
  });
});
