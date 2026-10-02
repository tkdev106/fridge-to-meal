// @vitest-environment jsdom
/**
 * 設定画面 `SettingsScreen`（B-56c 設計 6章 規則6・7 / 7章 / B-56f 設計 6章 規則4〜6・8・11・12 /
 * ADR-052 / `docs/testing.md` 4.1）。
 *
 * **仮の文言を期待値に書かない**（`docs/screen-design.md` 論点3 / B-56f 規則12）。操作は
 * `getAllByRole('button')` を**文書順の位置**で引き、**先に件数を確かめる**。
 *
 * **`vi.fn()` で呼び出しを検めない**（`docs/testing.md` 2章）。口に届いたことは、テストが
 * 渡した関数が配列に積んだもの（削除は `FixedHouseholdDataRequests` が数えた回数）で観る。
 * 「送っている間」は `PendingReleases` の保留で作る（実時間で待たない。同 5章）。
 */

import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '../../support/dom/renderComponent.js';
import { PendingReleases } from '../../support/HeldDelivery.js';
import { FixedHouseholdDataRequests } from '../../support/server/FixedHouseholdDataRequests.js';
import type { FixedHouseholdDataRequestsOptions } from '../../support/server/FixedHouseholdDataRequests.js';
import { SettingsScreen } from '../../../src/features/identity/SettingsScreen.js';
import type { SettingsScreenProps } from '../../../src/features/identity/SettingsScreen.js';

/**
 * 確認の前に設定画面に出ている操作は3つ（閉じる／ログアウト／アカウントとデータの削除）である
 * （B-56f 規則11）。
 */
const SETTINGS_OPERATION_COUNT = 3;

/**
 * 確認が出ている間の操作は4つ（閉じる／ログアウト／確かめる／やめる）である（B-56f 規則11）—
 * 削除の操作が「確かめる」「やめる」の2つに置き換わる。
 */
const CONFIRMING_OPERATION_COUNT = 4;

/**
 * 既定の削除の口は、**呼ばれたら数えて結末を保留する**（送っている間のまま）。削除が本題で
 * ない観点では呼ばれないが、呼ばれても結末を配らないので画面は何も変えない。
 */
const HELD_DELETION: FixedHouseholdDataRequestsOptions = {
  delete: [{ heldUntilSettled: { outcome: 'failed' } }],
};

function renderSettings(
  overrides: Partial<SettingsScreenProps> = {},
  deletionOptions: FixedHouseholdDataRequestsOptions = HELD_DELETION,
) {
  const deletion = new FixedHouseholdDataRequests(deletionOptions);

  render(
    <SettingsScreen
      onSignOut={overrides.onSignOut ?? (() => Promise.resolve())}
      onClose={overrides.onClose ?? (() => {})}
      onDeleteHouseholdData={overrides.onDeleteHouseholdData ?? deletion.deleteHouseholdData}
      offline={overrides.offline ?? false}
    />,
  );

  return { deletion };
}

function operationAt(index: number, expectedCount = SETTINGS_OPERATION_COUNT): HTMLElement {
  const operations = screen.getAllByRole('button');
  expect(operations).toHaveLength(expectedCount);

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

/** 確認の前の3番目の操作（アカウントとデータの削除。B-56f 規則11）。 */
function deleteOperation(): HTMLElement {
  return operationAt(2);
}

/** 確認が出ている間の3番目の操作（確かめる。B-56f 規則11）。 */
function confirmOperation(): HTMLElement {
  return operationAt(2, CONFIRMING_OPERATION_COUNT);
}

/** 確認が出ている間の4番目の操作（やめる。B-56f 規則11）。 */
function cancelOperation(): HTMLElement {
  return operationAt(3, CONFIRMING_OPERATION_COUNT);
}

/** 押したあとに届く更新（サインアウト・削除の結末）を `act` の中で流す。 */
async function flush(): Promise<void> {
  await act(async () => {});
}

/** 削除を押して確かめ、結末を流す。 */
async function confirmDeletion(): Promise<void> {
  fireEvent.click(deleteOperation());
  fireEvent.click(confirmOperation());
  await flush();
}

describe('設定画面 SettingsScreen', () => {
  it('確認の前に押せる操作は3つで、削除はそのうちの1つだけである', () => {
    // B-56f 規則11 / `docs/screen-design.md` 8章「1つの操作として置く」: 閉じる・ログアウト・
    // アカウントとデータの削除。B-56c 規則6「操作は2つだけ」はここで置き換わった。
    renderSettings();

    expect(screen.getAllByRole('button')).toHaveLength(3);
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

  it('2番目の操作を押すと、確認を挟まずにサインアウトが届く', async () => {
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
  it('3番目の操作を押すと確認が出て、押せる操作が4つになる', () => {
    // B-56f 規則4・11: 削除の操作が「確かめる」「やめる」の2つに置き換わる。
    renderSettings();

    fireEvent.click(deleteOperation());

    expect(screen.getAllByRole('button')).toHaveLength(CONFIRMING_OPERATION_COUNT);
  });

  it('3番目の操作を押しただけでは、削除は送られない', async () => {
    // B-56f 規則4 / FR-27 / `docs/screen-design.md` 8章: 確認を経なければ送られない。
    const { deletion } = renderSettings();

    fireEvent.click(deleteOperation());
    await flush();

    expect(deletion.deleteCount).toBe(0);
  });

  it('3番目の操作を押しても、閉じる求めもサインアウトも届かない', async () => {
    // B-56f 規則4・11: 削除の操作は閉じるともログアウトとも別の1操作である。
    const closed: string[] = [];
    const signedOut: string[] = [];
    renderSettings({
      onClose: () => closed.push('close'),
      onSignOut: () => {
        signedOut.push('signOut');
        return Promise.resolve();
      },
    });

    fireEvent.click(deleteOperation());
    await flush();

    expect(closed).toHaveLength(0);
    expect(signedOut).toHaveLength(0);
  });

  it('確認で確かめる操作を押すと、削除が1回だけ送られる', async () => {
    // B-56f 規則4: 送るのは確かめる操作だけである。
    const { deletion } = renderSettings();

    await confirmDeletion();

    expect(deletion.deleteCount).toBe(1);
  });

  it('確認でやめる操作を押すと、削除は送られない', async () => {
    // B-56f 規則5: やめるは何も送らない。
    const { deletion } = renderSettings();

    fireEvent.click(deleteOperation());
    fireEvent.click(cancelOperation());
    await flush();

    expect(deletion.deleteCount).toBe(0);
  });

  it('確認でやめると、最初の3つの操作に戻る', () => {
    // B-56f 規則5: 確認を閉じ、閉じる・ログアウト・削除の形に戻す。
    renderSettings();

    fireEvent.click(deleteOperation());
    fireEvent.click(cancelOperation());

    expect(screen.getAllByRole('button')).toHaveLength(SETTINGS_OPERATION_COUNT);
  });

  it('削除を送っている間は、どの操作も押せない', async () => {
    // B-56f 規則6: 二重送信を防ぎ、結末が届く前に画面を離れて失敗の案内を失うことを防ぐ。
    // 確かめる・やめる・閉じる・ログアウトのすべてが効かない。
    const { deletion } = renderSettings(
      {},
      { delete: [{ heldUntilSettled: { outcome: 'failed' } }] },
    );

    fireEvent.click(deleteOperation());
    fireEvent.click(confirmOperation());

    const operations = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(operations).toHaveLength(CONFIRMING_OPERATION_COUNT);
    expect(operations.map((operation) => operation.disabled)).toEqual([true, true, true, true]);

    await act(async () => {
      deletion.settle();
    });
  });

  it('削除に失敗すると、状態の案内を1つ出す', async () => {
    // B-56f 規則8 / 7章: 「いま削除できない」旨を `role="status"` で出す。文言は見ない（規則12）。
    renderSettings({}, { delete: [{ outcome: 'failed' }] });

    await confirmDeletion();

    expect(screen.queryAllByRole('status')).toHaveLength(1);
  });

  it('削除に失敗しても、確認は出たままである', async () => {
    // B-56f 規則8: 利用者はもう一度確かめるか、やめるかを選べる。
    renderSettings({}, { delete: [{ outcome: 'failed' }] });

    await confirmDeletion();

    expect(screen.getAllByRole('button')).toHaveLength(CONFIRMING_OPERATION_COUNT);
  });

  it('削除に失敗しても、自分では送り直さない', async () => {
    // B-56f 規則8: 自動で再試行しない。
    const { deletion } = renderSettings({}, { delete: [{ outcome: 'failed' }] });

    await confirmDeletion();
    await flush();

    expect(deletion.deleteCount).toBe(1);
  });

  it('失敗のあと確かめる操作を押すと、もう一度送られ、案内は消える', async () => {
    // B-56f 規則8: 操作は再び効き、案内は次に送ったときに消える。2度目は保留にして、
    // 送っている間に案内が残っていないことを観る。
    const { deletion } = renderSettings(
      {},
      { delete: [{ outcome: 'failed' }, { heldUntilSettled: { outcome: 'failed' } }] },
    );

    await confirmDeletion();
    fireEvent.click(confirmOperation());
    await flush();

    expect(deletion.deleteCount).toBe(2);
    expect(screen.queryAllByRole('status')).toHaveLength(0);

    await act(async () => {
      deletion.settle();
    });
  });

  it('失敗のあとやめると、案内は消える', async () => {
    // B-56f 規則8: 案内はやめたときに消える。
    renderSettings({}, { delete: [{ outcome: 'failed' }] });

    await confirmDeletion();
    fireEvent.click(cancelOperation());

    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });
});

/**
 * 接続が切れている間（B-70 設計 6章 規則6・12 / FR-41 / FR-27）。
 *
 * **止めるのは確認の中の削除の操作（確かめる）だけ**で、確認を開くこと・やめること・
 * ログアウト・閉じることは止めない（規則6 / `Session.ts` 規則8 — サインアウトは手元を必ず捨てる）。
 */
describe('設定画面 SettingsScreen の接続が切れている間', () => {
  it('接続が切れている間は、確認の中の削除の操作が押せない', () => {
    renderSettings({ offline: true });

    fireEvent.click(deleteOperation());

    // 規則12 / FR-41: 世帯のデータを消すのは書き込みを伴う操作である。
    expect((confirmOperation() as HTMLButtonElement).disabled).toBe(true);
  });

  it('接続が切れていても、削除の確認を開ける', () => {
    renderSettings({ offline: true });

    fireEvent.click(deleteOperation());

    // 規則12・6: 確認を開くのは遷移である。
    expect(screen.getAllByRole('button')).toHaveLength(CONFIRMING_OPERATION_COUNT);
  });

  it('接続が切れていても、確認をやめると最初の3つの操作に戻る', () => {
    const { deletion } = renderSettings({ offline: true });

    fireEvent.click(deleteOperation());
    fireEvent.click(cancelOperation());

    // 規則12・6: やめるのは遷移であり、削除は送られない。
    expect(screen.getAllByRole('button')).toHaveLength(SETTINGS_OPERATION_COUNT);
    expect(deletion.deleteCount).toBe(0);
  });

  it('接続が切れていても、ログアウトが届く', async () => {
    const signedOut: string[] = [];
    renderSettings({
      offline: true,
      onSignOut: () => {
        signedOut.push('signOut');
        return Promise.resolve();
      },
    });

    fireEvent.click(signOutOperation());
    await flush();

    // 規則6 / `Session.ts` 規則8: サインアウトは手元のセッションを捨てるだけで止めない。
    expect(signedOut).toHaveLength(1);
  });

  it('接続が切れていても、閉じる求めが届く', () => {
    const closed: string[] = [];
    renderSettings({ offline: true, onClose: () => closed.push('close') });

    fireEvent.click(closeOperation());

    // 規則6: 設定を閉じるのは遷移である。
    expect(closed).toHaveLength(1);
  });
});
