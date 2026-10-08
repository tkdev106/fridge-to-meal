import { describe, expect, it } from 'vitest';
import { hashOf, screenIdOf } from '../../src/navigation/ScreenLocation.js';

describe('ハッシュから行き先を読む screenIdOf', () => {
  it('ハッシュが無ければ献立の行き先と読む', () => {
    // ADR-092 決定1: 献立は既定の行き先であり、ハッシュを持たない。
    expect(screenIdOf('')).toBe('meals');
  });

  it('#pantry を在庫の行き先と読む', () => {
    // ADR-092 決定1。
    expect(screenIdOf('#pantry')).toBe('pantry');
  });

  it('#history を履歴の行き先と読む', () => {
    // ADR-092 決定1。
    expect(screenIdOf('#history')).toBe('history');
  });

  it('#settings を設定の行き先と読む', () => {
    // ADR-092 決定1。
    expect(screenIdOf('#settings')).toBe('settings');
  });

  it('#meals は書かない形なので献立と読む', () => {
    // ADR-092 決定1: 書く形以外はすべて献立に倒す。
    expect(screenIdOf('#meals')).toBe('meals');
  });

  it('大文字の違うハッシュは献立と読む', () => {
    // ADR-092 決定1: 完全一致で読み、表記の違いを吸収しない。
    expect(screenIdOf('#Pantry')).toBe('meals');
  });

  it.each([' #pantry', '#pantry '])('前後に空白のあるハッシュ「%s」は献立と読む', (hash) => {
    // ADR-092 決定1: 完全一致で読み、前後の空白を落とさない。
    expect(screenIdOf(hash)).toBe('meals');
  });

  it('# だけのハッシュは献立と読む', () => {
    // ADR-092 決定1。
    expect(screenIdOf('#')).toBe('meals');
  });
});

describe('行き先をハッシュに写す hashOf', () => {
  it('献立はハッシュを持たず、# も付けない', () => {
    // ADR-092 決定1: 既定の行き先の URL を素のままにする。
    expect(hashOf('meals')).toBe('');
  });

  it.each([
    ['pantry', '#pantry'],
    ['history', '#history'],
    ['settings', '#settings'],
  ] as const)('%s は %s に写す', (screen, hash) => {
    // ADR-092 決定1: screenIdOf の逆。
    expect(hashOf(screen)).toBe(hash);
  });
});
