/**
 * 招待リンクを組む純粋関数（B-76 2周目 / 設計 6章 規則6 / ADR-087 決定4）。
 *
 * **node の上で動かす**（`docs/testing.md` 5章）。origin は `location.origin` を読まず引数で渡す。
 */

import { describe, expect, it } from 'vitest';
import { householdInvitationLink } from '../../../src/features/identity/HouseholdInvitationLink.js';

describe('招待リンクを組む householdInvitationLink', () => {
  it('origin に /?invite= とトークンを付けたリンクを組む', () => {
    // 規則6 / ADR-087 決定4: `webOrigin` は末尾の `/` を持たない値。
    expect(householdInvitationLink('https://fridge.example.test', 'invite-token')).toBe(
      'https://fridge.example.test/?invite=invite-token',
    );
  });

  it('トークンを URL の成分として符号化する', () => {
    // 規則6: クエリの区切りになる文字を符号化し、トークンが途中で切れないようにする。
    expect(householdInvitationLink('https://fridge.example.test', 'a+b/c=d&e')).toBe(
      'https://fridge.example.test/?invite=a%2Bb%2Fc%3Dd%26e',
    );
  });
});
