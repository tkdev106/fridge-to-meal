import { describe, expect, it } from 'vitest';
import { DEFAULT_TAB, TAB_ORDER } from '../../src/navigation/Tabs.js';

describe('下タブ Tabs', () => {
  it('起動して最初に開くのは在庫タブである', () => {
    // 要件 第7章: ホームは「在庫一覧」。**献立を既定にしない** —
    // `docs/screen-design.md` 論点1 は `判断待ち` のまま（B-38 設計 6章 規則1）。
    expect(DEFAULT_TAB).toBe('pantry');
  });

  it('下タブは献立・在庫・履歴の3つだけを、画面に並ぶ順で持つ', () => {
    // `docs/screen-design.md` 2.1 のワイヤー（献立 → 在庫 → 履歴）/ 2.3 の節名
    // （B-38 設計 6章 規則2）。
    expect(TAB_ORDER).toEqual(['meals', 'pantry', 'history']);
  });

  it('既定のタブは下タブの並びの中にある', () => {
    // 要件 第7章 / `docs/screen-design.md` 2.1: 器の外を既定にしない（B-38 設計 6章 規則3）。
    // **2つの定数の関係を押さえる行**なので、どちらの値もここに再掲しない。
    expect(TAB_ORDER.includes(DEFAULT_TAB)).toBe(true);
  });
});
