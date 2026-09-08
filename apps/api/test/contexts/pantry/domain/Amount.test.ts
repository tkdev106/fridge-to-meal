import { describe, expect, it } from 'vitest';
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

  it('長さも書式も制限しない', () => {
    // ADR-010: 分量を使うのは LLM への入力と画面表示だけで、演算をする要件が無い。
    // 上限は要件に無いので設けない（LLM 応答側の 30 字は腐敗防止層の規則であり、ここではない）。
    const 長い分量 = 'よく熟したトマトを湯むきしてから'.repeat(10);
    expect(amountOf(長い分量)).toBe(長い分量);
  });
});
