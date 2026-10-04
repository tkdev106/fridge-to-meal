/**
 * 招待リンクを組む純粋関数（B-76 2周目 / 設計 6章 規則6 / ADR-087 決定4）と、クエリから
 * トークンを読む純粋関数（B-77 1周目 / 設計 6章 規則1）。
 *
 * **node の上で動かす**（`docs/testing.md` 5章）。origin は `location.origin` を、クエリは
 * `location.search` を読まず引数で渡す。
 */

import { describe, expect, it } from 'vitest';
import {
  householdInvitationLink,
  invitationTokenOf,
} from '../../../src/features/identity/HouseholdInvitationLink.js';

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

describe('クエリから招待のトークンを読む invitationTokenOf', () => {
  it('クエリの invite の値をトークンとして返す', () => {
    // 規則1 / ADR-087 決定4: 招待リンクは `/?invite=<トークン>` の形で開かれる。
    expect(invitationTokenOf('?invite=invite-token')).toBe('invite-token');
  });

  it('符号化されたトークンを復号して返す', () => {
    // 規則1: 組む側（`householdInvitationLink`）が符号化した値を、元のトークンに戻す。
    expect(invitationTokenOf('?invite=a%2Bb%2Fc%3Dd%26e')).toBe('a+b/c=d&e');
  });

  it('invite が無ければ null を返す', () => {
    // 規則1: 招待リンクで開かれていない読み込み。
    expect(invitationTokenOf('')).toBeNull();
  });

  it('invite が空文字なら null を返す', () => {
    // 規則1: 空文字はトークンとして持ち越さない。
    expect(invitationTokenOf('?invite=')).toBeNull();
  });

  it('空白だけの invite はそのまま返す', () => {
    // 規則1: 使えるかを決めるのは DB であり、ここで整えも捨てもしない（api 規則15 と同じ構え）。
    expect(invitationTokenOf('?invite=%20%20')).toBe('  ');
  });
});
