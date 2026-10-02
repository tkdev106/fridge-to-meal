// @vitest-environment jsdom
/**
 * 見出しの行 `ScreenHeader`（B-60 設計 5章 / 6章 規則13 / ADR-052 / `docs/testing.md` 4.1）。
 *
 * **題と歯車の名前は原本から取った文言であり、仮ではない**（ADR-074 決定1。`docs/design/` が
 * 文言の正）。そのため `設定` は名前で引く。題はテストが渡したものを観る。
 *
 * **`vi.fn()` で呼び出しを検めない**（`docs/testing.md` 2章）。押下で届いた求めは、テストが
 * 渡した関数が配列に積んだものを観る。
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '../support/dom/renderComponent.js';
import type { ScreenHeaderProps } from '../../src/navigation/ScreenHeader.js';
import { ScreenHeader } from '../../src/navigation/ScreenHeader.js';

function renderHeader(overrides: Partial<ScreenHeaderProps> = {}) {
  return render(<ScreenHeader title="冷蔵庫" onOpenSettings={() => {}} {...overrides} />);
}

/** `before` が文書順で `after` より前にあるか（jsdom はレイアウトを持たない）。 */
function precedes(before: Node, after: Node): boolean {
  return (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('見出しの行 ScreenHeader', () => {
  it('渡された題を1段目の見出しとして出す', () => {
    // B-60 規則13: 見出しの行は `h1`。
    renderHeader({ title: '冷蔵庫' });

    expect(screen.queryByRole('heading', { level: 1, name: '冷蔵庫' })).not.toBeNull();
  });

  it('名前「設定」の操作を1つ置く', () => {
    // B-60 規則13 / NFR-16: 歯車の名前は `aria-label="設定"` だけ（アイコンは飾り）。
    renderHeader();

    expect(screen.getAllByRole('button', { name: '設定' })).toHaveLength(1);
  });

  it('歯車を押すと、設定を開く求めが届く', () => {
    // B-60 規則12 / ADR-066: 設定を開いているかは門が持ち、行は押下を口で渡すだけである。
    const openedSettings: string[] = [];
    renderHeader({ onOpenSettings: () => openedSettings.push('settings') });

    fireEvent.click(screen.getByRole('button', { name: '設定' }));

    expect(openedSettings).toEqual(['settings']);
  });

  it('歯車は、文書順で見出しより後ろにある', () => {
    // B-60 規則13: 歯車は見出しの右にあり、文書順でも `h1` の後に読まれる。
    renderHeader({ title: '冷蔵庫' });

    const heading = screen.getByRole('heading', { level: 1, name: '冷蔵庫' });
    const gear = screen.getByRole('button', { name: '設定' });

    expect(precedes(heading, gear)).toBe(true);
  });
});
