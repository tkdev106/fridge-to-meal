import { describe, expect, it } from 'vitest';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';

describe('分量 Amount', () => {
  it('書かれたとおりに保持する。数値と単位に分解しない', () => {
    // ADR-010 / ADR-034: 分量を使うのは LLM への入力と画面表示だけで、演算の要件が無い。
    expect(amountOf('200g')).toBe('200g');
    expect(amountOf('1本')).toBe('1本');
    expect(amountOf('少々')).toBe('少々');
  });

  it('前後の空白は落とす', () => {
    // B-14a 規則6: 正規化の規則は在庫側と同じにする（出所は ADR-010）。
    expect(amountOf('  200g  ')).toBe('200g');
  });

  it('null・空文字・空白だけはすべて「分量なし」として扱う', () => {
    // B-14a 規則6 / ADR-010 / prompt-design 6.2: 分量なしを Amount として作れると、
    // 「分量が無い」の判定が2通りになる。
    expect(amountOf(null)).toBeNull();
    expect(amountOf('')).toBeNull();
    expect(amountOf('   ')).toBeNull();
  });
});
