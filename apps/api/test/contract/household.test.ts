import { describe, expect, it } from 'vitest';
import type {
  AcceptHouseholdInvitationInput,
  HouseholdInvitationOutput,
  HouseholdMemberCountOutput,
} from '@fridge-to-meal/contract';

// 契約は型だけを持ち、実行時の分岐を持たない（B-75 設計書 5章）。したがってここで確かめるのは
// 「契約に沿う値が組み立てられること」と「契約に反する値が型として通らないこと」である。
// 後者は @ts-expect-error で押さえ、pnpm typecheck が赤を出す。

describe('世帯の人数 HouseholdMemberCountOutput', () => {
  it('人数を持つ出力を組み立てられる', () => {
    // FR-47 / 設計書 規則9: 人数の経路は `{ memberCount }` を返す。
    const output: HouseholdMemberCountOutput = { memberCount: 2 };

    expect(output.memberCount).toBe(2);
  });

  it('人数のキーを省略できない', () => {
    // 設計書 規則9: 返す側は必ず人数を載せる。
    // @ts-expect-error 人数の無い値は出力の表現ではない
    const output: HouseholdMemberCountOutput = {};

    expect(output).toBeDefined();
  });
});

describe('作った招待 HouseholdInvitationOutput', () => {
  it('トークンのキーを省略できない', () => {
    // B-74 設計書 規則14 / FR-44: 招待を作る経路は必ずトークンを載せる。
    // @ts-expect-error トークンの無い値は出力の表現ではない
    const output: HouseholdInvitationOutput = {};

    expect(output).toBeDefined();
  });
});

describe('招待で参加する要求 AcceptHouseholdInvitationInput', () => {
  it('トークンを文字列以外で渡せない', () => {
    // B-74 設計書 規則15 / FR-45: 本体は `{ token: string }` である。
    // @ts-expect-error 文字列でないトークンは入力の表現ではない
    const input: AcceptHouseholdInvitationInput = { token: 42 };

    expect(input).toBeDefined();
  });
});
