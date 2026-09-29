// @vitest-environment jsdom
/**
 * 設定画面 `SettingsScreen`（B-56c 設計 6章 規則6・7 / 7章 / ADR-052 / `docs/testing.md` 4.1）。
 *
 * **仮の文言を期待値に書かない**（`docs/screen-design.md` 論点3 / 設計 10章 前提4）。操作は
 * `getAllByRole('button')` を**文書順の位置**で引き、**先に件数を確かめる**。例外は「削除」の
 * 1語だけで、これは**置いてはならない内容**の否定である（設計 規則6。検分で認めた）。
 *
 * **`vi.fn()` で呼び出しを検めない**（`docs/testing.md` 2章）。口に届いたことは、テストが
 * 渡した関数が配列に積んだもので観る。「送っている間」は `PendingReleases` の保留で作る
 * （実時間で待たない。同 5章）。
 */

import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '../../support/dom/renderComponent.js';
import { PendingReleases } from '../../support/HeldDelivery.js';
import { SettingsScreen } from '../../../src/features/identity/SettingsScreen.js';
import type { SettingsScreenProps } from '../../../src/features/identity/SettingsScreen.js';

/** 設定画面に出ている操作は2つ（閉じる／ログアウト）である（設計 規則6）。 */
const SETTINGS_OPERATION_COUNT = 2;

function renderSettings(overrides: Partial<SettingsScreenProps> = {}) {
  return render(
    <SettingsScreen
      onSignOut={overrides.onSignOut ?? (() => Promise.resolve())}
      onClose={overrides.onClose ?? (() => {})}
    />,
  );
}

function operationAt(index: number): HTMLElement {
  const operations = screen.getAllByRole('button');
  expect(operations).toHaveLength(SETTINGS_OPERATION_COUNT);

  const found = operations.at(index);
  if (found === undefined) throw new Error(`${index} 番目の操作が無い`);

  return found;
}

function closeOperation(): HTMLElement {
  return operationAt(0);
}

function signOutOperation(): HTMLElement {
  return operationAt(1);
}

/** 押したあとに届く更新（サインアウトの結末）を `act` の中で流す。 */
async function flush(): Promise<void> {
  await act(async () => {});
}

describe('設定画面 SettingsScreen', () => {
  it('押せる操作は2つだけである', () => {
    // 規則6 / `docs/screen-design.md` 8章: 閉じるとログアウトの2つだけ。
    renderSettings();

    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('先頭の操作を押すと、閉じる求めが届く', () => {
    // 規則6: 閉じるが先、ログアウトが後。
    const closed: string[] = [];
    const signedOut: string[] = [];
    renderSettings({
      onClose: () => closed.push('close'),
      onSignOut: () => {
        signedOut.push('signOut');
        return Promise.resolve();
      },
    });

    fireEvent.click(closeOperation());

    expect(closed).toHaveLength(1);
    expect(signedOut).toHaveLength(0);
  });

  it('後ろの操作を押すと、確認を挟まずにサインアウトが届く', async () => {
    // 規則6・7 / B-35 設計 規則11 / FR-25: ログアウトは確認を出さない1操作である。
    const signedOut: string[] = [];
    renderSettings({
      onSignOut: () => {
        signedOut.push('signOut');
        return Promise.resolve();
      },
    });

    fireEvent.click(signOutOperation());
    await flush();

    expect(signedOut).toHaveLength(1);
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(screen.queryAllByRole('alertdialog')).toHaveLength(0);
  });

  it('削除の操作も削除についての文も置かない', () => {
    // 規則6 / 設計 2章「作らないもの」: 削除（FR-27）は B-56f まで置かない。押せない操作も、
    // 打ち手の無い予告も出さない。
    const { container } = renderSettings();

    expect(container.textContent).not.toContain('削除');
  });

  it('サインアウトを送っている間は、ログアウトの操作が押せない', async () => {
    // 規則7 / B-35 設計 規則11: 押している間だけ効かせない。
    const pending = new PendingReleases();
    renderSettings({ onSignOut: () => new Promise<void>((resolve) => pending.hold(resolve)) });

    fireEvent.click(signOutOperation());

    // `@testing-library/jest-dom` は入れない（依存の追加は止まる条件）ので、素の
    // `disabled` プロパティで見る。
    expect((signOutOperation() as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      pending.settle();
    });
  });

  it('サインアウトの結末が届くと、ログアウトの操作は押せるようになる', async () => {
    // 規則7: 効かないのは「押している間だけ」である。
    const pending = new PendingReleases();
    renderSettings({ onSignOut: () => new Promise<void>((resolve) => pending.hold(resolve)) });

    fireEvent.click(signOutOperation());
    await act(async () => {
      pending.settle();
    });

    expect((signOutOperation() as HTMLButtonElement).disabled).toBe(false);
  });

  it('サインアウトが済んでも、画面に案内を出さない', async () => {
    // 設計 7章 行1 / `Session.ts` 規則8: サーバ側の失敗も画面には届かない。門が
    // `signedOut` を受けてログインの画面へ切り替えるだけである。
    renderSettings({ onSignOut: () => Promise.resolve() });

    fireEvent.click(signOutOperation());
    await flush();

    expect(screen.queryAllByRole('status')).toHaveLength(0);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
