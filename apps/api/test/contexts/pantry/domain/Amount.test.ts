import { describe, expect, it } from 'vitest';
import { PantryRuleViolation } from '../../../../src/contexts/pantry/domain/error/PantryRuleViolation.js';
import { amountOf } from '../../../../src/contexts/pantry/domain/value/Amount.js';

describe('分量 Amount', () => {
  it('書かれたとおりに保持する。数値と単位に分解しない（ADR-010）', () => {
    expect(amountOf('200g')).toBe('200g');
    expect(amountOf('1本')).toBe('1本');
    expect(amountOf('少々')).toBe('少々');
  });

  it('前後の空白は落とす', () => {
    expect(amountOf('  200g  ')).toBe('200g');
  });

  it('空文字と空白だけの入力は「分量なし」として扱う', () => {
    // 分量は任意入力である（FR-01 の入力項目は「数量＋単位」であって必須ではない）。
    // 空文字の Amount を作れてしまうと、分量の有無の判定が2通りになる。
    expect(amountOf('')).toBeNull();
    expect(amountOf('   ')).toBeNull();
  });

  it('分量なしを表す null は、そのまま「分量なし」として扱う', () => {
    // B-06 規則4 / FR-13: 更新では null が「分量を消す」を表す。expiryDateOf と同じ形で
    // 受け取り、null の分岐を呼ぶ側ごとに増やさない。
    expect(amountOf(null)).toBeNull();
  });

  it('15字ちょうどの分量は受け付ける', () => {
    // B-79 規則6 / NFR-19: 分量は15字以内。
    expect(amountOf('あ'.repeat(15))).toBe('あ'.repeat(15));
  });

  it('16字の分量を断る', () => {
    // B-79 規則6 / NFR-19: 16字以上は amount.tooLong。
    expect(() => amountOf('あ'.repeat(16))).toThrow(PantryRuleViolation);
    expect(() => amountOf('あ'.repeat(16))).toThrow(
      expect.objectContaining({ rule: 'amount.tooLong' }),
    );
  });

  it('分量の途中にタブがあると断る', () => {
    // B-79 規則4 / NFR-19: 制御文字（Cc）が途中に1つでもあれば amount.controlCharacter。
    expect(() => amountOf('2\t本')).toThrow(PantryRuleViolation);
    expect(() => amountOf('2\t本')).toThrow(
      expect.objectContaining({ rule: 'amount.controlCharacter' }),
    );
  });

  it('制御文字を含み15字を超える分量は、制御文字の規則で断る', () => {
    // B-79 規則6: 判定の順は 制御文字 → 字数。先に当たったものだけを投げる。
    const amount = 'あ'.repeat(15) + '\nい';

    expect(() => amountOf(amount)).toThrow(PantryRuleViolation);
    expect(() => amountOf(amount)).toThrow(
      expect.objectContaining({ rule: 'amount.controlCharacter' }),
    );
  });
});
