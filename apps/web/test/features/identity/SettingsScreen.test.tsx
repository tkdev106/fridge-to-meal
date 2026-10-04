// @vitest-environment jsdom
/**
 * 設定画面 `SettingsScreen`（B-56c 設計 6章 規則6・7 / 7章 / B-56f 設計 6章 規則4〜6・8・11・12 /
 * B-76 設計 6章 規則1〜11・17 / ADR-052 / `docs/testing.md` 4.1）。
 *
 * **文言は `docs/design/` から取ったもので仮ではない**（ADR-074 決定1 / B-67 規則22）— 戻る・
 * ログアウト・アカウントとデータを削除・確認の文・削除する／やめるの2操作、帯「冷蔵庫の共有」の
 * 文言（`docs/design/README.md` の「冷蔵庫の共有」「削除の確認（メンバーが2人以上）」の行）は
 * **字面で確かめる**。**削除の失敗の案内だけは暫定**（デザインに無い。B-67 2章）なので字面を見ず、
 * 役割 `status` で引く。操作は**名前（アクセシブルな名前）で引く** — 帯が増えても位置で引いた
 * 操作がずれないようにするためである。
 *
 * **`vi.fn()` で呼び出しを検めない**（`docs/testing.md` 2章）。口に届いたことは、テストが
 * 渡した関数が配列に積んだもの（削除は `FixedHouseholdDataRequests`、招待・抜けるは
 * `FixedHouseholdRequests` が数えた回数、写した文字は `FixedClipboardWriter` の配列）で観る。
 * 「送っている間」は `PendingReleases` の保留で作る（実時間で待たない。同 5章）。
 */

import { describe, expect, it } from 'vitest';
import type { JSX } from 'react';
import { act, fireEvent, render, screen } from '../../support/dom/renderComponent.js';
import { PendingReleases } from '../../support/HeldDelivery.js';
import { FixedBackNavigation } from '../../support/backNavigation/FixedBackNavigation.js';
import { FixedClipboardWriter } from '../../support/clipboard/FixedClipboardWriter.js';
import { FixedHouseholdDataRequests } from '../../support/server/FixedHouseholdDataRequests.js';
import type { FixedHouseholdDataRequestsOptions } from '../../support/server/FixedHouseholdDataRequests.js';
import { FixedHouseholdRequests } from '../../support/server/FixedHouseholdRequests.js';
import type { FixedHouseholdRequestsOptions } from '../../support/server/FixedHouseholdRequests.js';
import { BackNavigationProvider } from '../../../src/backNavigation/BackHandler.js';
import type { CopyOutcome } from '../../../src/clipboard/ClipboardWriter.js';
import { SettingsScreen } from '../../../src/features/identity/SettingsScreen.js';
import type {
  HouseholdMemberCountState,
  SettingsScreenProps,
} from '../../../src/features/identity/SettingsScreen.js';

/*
 * 文言は `docs/design/README.md` から取った（ADR-074 決定1 — デザインが正）。
 */

const CLOSE_LABEL = '戻る';
const SIGN_OUT_LABEL = 'ログアウト';
const DELETE_LABEL = 'アカウントとデータを削除';
const CONFIRM_LABEL = '削除する';
const CANCEL_LABEL = 'やめる';

const ACCOUNT_BAND = 'アカウント';
const SHARING_BAND = '冷蔵庫の共有';
const DATA_BAND = 'データ';

/** 削除の確認の文（原本 13b。B-67 規則15・16）。1人のとき・人数が分からないとき（B-76 規則10）。 */
const CONFIRM_SENTENCE = 'アカウントと、冷蔵庫の食材・履歴をすべて削除しますか';

/** 削除の確認の文（メンバーが2人以上。B-76 規則10）。 */
const SHARED_CONFIRM_SENTENCE =
  'アカウントを削除しますか。冷蔵庫の食材・履歴は、共有しているメンバーのために残ります';

const MEMBER_ROW = '冷蔵庫を共有しているメンバー';
const MEMBER_COUNT_FAILURE_NOTICE = '人数を読み込めませんでした';
const CREATE_INVITATION_LABEL = '招待リンクを作る';
const COPY_LABEL = 'コピー';
const COPIED_NOTICE = 'コピーしました';
const COPY_FAILURE_NOTICE = 'コピーできませんでした。リンクを選んでコピーしてください';
const INVITATION_FAILURE_NOTICE =
  'いまは招待リンクを作れませんでした。時間をおいてもう一度お試しください。';
const LEAVE_LABEL = 'この冷蔵庫から抜ける';
const LEAVE_CONFIRM_SENTENCE = 'この冷蔵庫から抜けますか。抜けると、空の冷蔵庫から始まります';
const LEAVE_CONFIRM_LABEL = '抜ける';
const LEAVE_FAILURE_NOTICE = 'いまは抜けられませんでした。時間をおいてもう一度お試しください。';

/** 招待リンクの基点（B-76 規則6）。末尾の `/` を持たない。 */
const webOrigin = 'https://fridge.example';

/** `webOrigin` とトークン `abc` から組んだ招待リンク（B-76 規則6）。 */
const linkOfAbc = 'https://fridge.example/?invite=abc';

const alone: HouseholdMemberCountState = { outcome: 'loaded', memberCount: 1 };
const sharedByTwo: HouseholdMemberCountState = { outcome: 'loaded', memberCount: 2 };

/**
 * 既定の削除の口は、**呼ばれたら数えて結末を保留する**（送っている間のまま）。削除が本題で
 * ない観点では呼ばれないが、呼ばれても結末を配らないので画面は何も変えない。
 */
const HELD_DELETION: FixedHouseholdDataRequestsOptions = {
  delete: [{ heldUntilSettled: { outcome: 'failed' } }],
};

/** 既定の招待・抜けるの口も同じく、呼ばれたら数えて結末を保留する。 */
const HELD_HOUSEHOLD: FixedHouseholdRequestsOptions = {
  create: [{ heldUntilSettled: { outcome: 'failed' } }],
  leave: [{ heldUntilSettled: { outcome: 'failed' } }],
};

type SettingsDoubles = {
  readonly deletion?: FixedHouseholdDataRequestsOptions;
  readonly household?: FixedHouseholdRequestsOptions;
  /** 写した結末の台本。既定は写せる。 */
  readonly copies?: readonly CopyOutcome[];
  /** 渡したときだけ端末の戻るの継ぎ目の中に描く（B-75）。 */
  readonly backNavigation?: FixedBackNavigation;
};

/**
 * 設定画面を描く。既定は人数 1・接続している・基点 `https://fridge.example`。
 * 本題の props だけを `overrides` に、差し替えの台本を `doubles` に渡す。
 */
function renderSettings(
  overrides: Partial<SettingsScreenProps> = {},
  doubles: SettingsDoubles = {},
) {
  const deletion = new FixedHouseholdDataRequests(doubles.deletion ?? HELD_DELETION);
  const household = new FixedHouseholdRequests(doubles.household ?? HELD_HOUSEHOLD);
  const clipboard = new FixedClipboardWriter(...(doubles.copies ?? ['copied']));
  const props: SettingsScreenProps = {
    onSignOut: () => Promise.resolve(),
    onClose: () => {},
    onDeleteHouseholdData: deletion.deleteHouseholdData,
    offline: false,
    memberCount: alone,
    webOrigin,
    onCreateHouseholdInvitation: household.createHouseholdInvitation,
    onLeaveHousehold: household.leaveHousehold,
    clipboard,
    ...overrides,
  };

  function element(current: SettingsScreenProps): JSX.Element {
    const settings = <SettingsScreen {...current} />;
    if (doubles.backNavigation === undefined) return settings;

    return (
      <BackNavigationProvider backNavigation={doubles.backNavigation}>
        {settings}
      </BackNavigationProvider>
    );
  }

  const { rerender } = render(element(props));

  return {
    deletion,
    household,
    clipboard,
    /** 門が props を変えた回（人数が届いた・接続が切れた）を再現する。 */
    rerenderWith: (changes: Partial<SettingsScreenProps>) => {
      rerender(element({ ...props, ...changes }));
    },
  };
}

/** 端末の戻るの継ぎ目の中に描き、閉じる口に届いたものを `closed` に積む。 */
function renderSettingsWithBack(
  closed: string[],
  doubles: Omit<SettingsDoubles, 'backNavigation'> = {},
  overrides: Partial<SettingsScreenProps> = {},
) {
  const backNavigation = new FixedBackNavigation();
  const rendered = renderSettings(
    { onClose: () => closed.push('close'), ...overrides },
    { ...doubles, backNavigation },
  );

  return { ...rendered, backNavigation };
}

function pressBack(backNavigation: FixedBackNavigation): void {
  act(() => {
    backNavigation.pressBack();
  });
}

/** 操作を名前で引く。無ければ落ちる。 */
function operation(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

/** その名前の操作がいくつ出ているか。 */
function operationCount(name: string): number {
  return screen.queryAllByRole('button', { name }).length;
}

/** その文字がいくつ出ているか。 */
function textCount(text: string | RegExp): number {
  return screen.queryAllByText(text).length;
}

/** `role="status"` の案内の文を文書順に並べる。 */
function statusTexts(): readonly (string | null)[] {
  return screen.queryAllByRole('status').map((notice) => notice.textContent);
}

/** 押せる操作の名前。**操作が1つも無ければ落ちる**（空の画面で緑にしない）。 */
function enabledOperationNames(): readonly (string | null)[] {
  return (screen.getAllByRole('button') as HTMLButtonElement[])
    .filter((button) => !button.disabled)
    .map((button) => button.getAttribute('aria-label') ?? button.textContent);
}

/** 押したあとに届く更新（サインアウト・削除・招待・抜ける・写すの結末）を `act` の中で流す。 */
async function flush(): Promise<void> {
  await act(async () => {});
}

/** 削除を押して「削除する」を押し、結末を流す。 */
async function confirmDeletion(): Promise<void> {
  fireEvent.click(operation(DELETE_LABEL));
  fireEvent.click(operation(CONFIRM_LABEL));
  await flush();
}

/** 招待リンクを作る操作を押し、結末を流す。 */
async function createInvitation(): Promise<void> {
  fireEvent.click(operation(CREATE_INVITATION_LABEL));
  await flush();
}

/** コピーを押し、結末を流す。 */
async function copyLink(): Promise<void> {
  fireEvent.click(operation(COPY_LABEL));
  await flush();
}

/** 抜ける操作を押して確認の「抜ける」を押し、結末を流す。 */
async function confirmLeave(): Promise<void> {
  fireEvent.click(operation(LEAVE_LABEL));
  fireEvent.click(operation(LEAVE_CONFIRM_LABEL));
  await flush();
}

/** `before` が文書順で `after` より前にあるか（jsdom はレイアウトを持たない。B-56c 規則3）。 */
function precedes(before: Node, after: Node): boolean {
  return (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** 渡した順に文書の中で並んでいるか。 */
function inDocumentOrder(nodes: readonly Node[]): boolean {
  let previous: Node | undefined;
  for (const node of nodes) {
    if (previous !== undefined && !precedes(previous, node)) return false;
    previous = node;
  }

  return true;
}

/** 段2の見出し（帯。B-67 規則12 / 10章 前提2）の textContent を文書順に並べる。 */
function bandHeadingTexts(): readonly (string | null)[] {
  return screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
}

/** 帯の見出しを名前で引く。 */
function bandHeading(name: string): HTMLElement {
  return screen.getByRole('heading', { level: 2, name });
}

describe('設定画面 SettingsScreen', () => {
  it('確認の前は、戻る・ログアウト・削除の操作がそれぞれ1つずつ出る', () => {
    // B-56f 規則11 / `docs/screen-design.md` 8章「1つの操作として置く」: 削除は確認の前は1操作だけ。
    renderSettings();

    expect([CLOSE_LABEL, SIGN_OUT_LABEL, DELETE_LABEL].map(operationCount)).toEqual([1, 1, 1]);
  });

  it('戻る操作を押すと、閉じる求めが届く', () => {
    // 規則6: 戻る（閉じる求め）とログアウトは別の操作である。
    const closed: string[] = [];
    const signedOut: string[] = [];
    renderSettings({
      onClose: () => closed.push('close'),
      onSignOut: () => {
        signedOut.push('signOut');
        return Promise.resolve();
      },
    });

    fireEvent.click(operation(CLOSE_LABEL));

    expect(closed).toHaveLength(1);
    expect(signedOut).toHaveLength(0);
  });

  it('ログアウトの操作を押すと、確認を挟まずにサインアウトが届く', async () => {
    // 規則6・7 / B-35 設計 規則11 / FR-25: ログアウトは確認を出さない1操作である。
    const signedOut: string[] = [];
    renderSettings({
      onSignOut: () => {
        signedOut.push('signOut');
        return Promise.resolve();
      },
    });

    fireEvent.click(operation(SIGN_OUT_LABEL));
    await flush();

    expect(signedOut).toHaveLength(1);
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(screen.queryAllByRole('alertdialog')).toHaveLength(0);
  });

  it('サインアウトを送っている間は、ログアウトの操作が押せない', async () => {
    // 規則7 / B-35 設計 規則11: 押している間だけ効かせない。
    const pending = new PendingReleases();
    renderSettings({ onSignOut: () => new Promise<void>((resolve) => pending.hold(resolve)) });

    fireEvent.click(operation(SIGN_OUT_LABEL));

    // `@testing-library/jest-dom` は入れない（依存の追加は止まる条件）ので、素の
    // `disabled` プロパティで見る。
    expect(operation(SIGN_OUT_LABEL).disabled).toBe(true);

    await act(async () => {
      pending.settle();
    });
  });

  it('サインアウトの結末が届くと、ログアウトの操作は押せるようになる', async () => {
    // 規則7: 効かないのは「押している間だけ」である。
    const pending = new PendingReleases();
    renderSettings({ onSignOut: () => new Promise<void>((resolve) => pending.hold(resolve)) });

    fireEvent.click(operation(SIGN_OUT_LABEL));
    await act(async () => {
      pending.settle();
    });

    expect(operation(SIGN_OUT_LABEL).disabled).toBe(false);
  });

  it('サインアウトが済んでも、画面に案内を出さない', async () => {
    // 設計 7章 行1 / `Session.ts` 規則8: サーバ側の失敗も画面には届かない。門が
    // `signedOut` を受けてログインの画面へ切り替えるだけである。
    renderSettings({ onSignOut: () => Promise.resolve() });

    fireEvent.click(operation(SIGN_OUT_LABEL));
    await flush();

    expect(screen.queryAllByRole('status')).toHaveLength(0);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('削除の操作を押すと確認が出て、削除の操作が「削除する」「やめる」に置き換わる', () => {
    // B-56f 規則4・11
    renderSettings();

    fireEvent.click(operation(DELETE_LABEL));

    expect([DELETE_LABEL, CONFIRM_LABEL, CANCEL_LABEL].map(operationCount)).toEqual([0, 1, 1]);
  });

  it('削除の操作を押しただけでは、削除は送られない', async () => {
    // B-56f 規則4 / FR-27 / `docs/screen-design.md` 8章: 確認を経なければ送られない。
    const { deletion } = renderSettings();

    fireEvent.click(operation(DELETE_LABEL));
    await flush();

    expect(deletion.deleteCount).toBe(0);
  });

  it('削除の操作を押しても、閉じる求めもサインアウトも届かない', async () => {
    // B-56f 規則4・11: 削除の操作は戻るともログアウトとも別の1操作である。
    const closed: string[] = [];
    const signedOut: string[] = [];
    renderSettings({
      onClose: () => closed.push('close'),
      onSignOut: () => {
        signedOut.push('signOut');
        return Promise.resolve();
      },
    });

    fireEvent.click(operation(DELETE_LABEL));
    await flush();

    expect(closed).toHaveLength(0);
    expect(signedOut).toHaveLength(0);
  });

  it('確認で確かめる操作を押すと、削除が1回だけ送られる', async () => {
    // B-56f 規則4: 送るのは確認の「削除する」だけである。
    const { deletion } = renderSettings();

    await confirmDeletion();

    expect(deletion.deleteCount).toBe(1);
  });

  it('確認でやめる操作を押すと、削除は送られない', async () => {
    // B-56f 規則5: やめるは何も送らない。
    const { deletion } = renderSettings();

    fireEvent.click(operation(DELETE_LABEL));
    fireEvent.click(operation(CANCEL_LABEL));
    await flush();

    expect(deletion.deleteCount).toBe(0);
  });

  it('確認でやめると、削除の操作に戻る', () => {
    // B-56f 規則5: 確認を閉じ、削除の操作の形に戻す。
    renderSettings();

    fireEvent.click(operation(DELETE_LABEL));
    fireEvent.click(operation(CANCEL_LABEL));

    expect([DELETE_LABEL, CONFIRM_LABEL, CANCEL_LABEL].map(operationCount)).toEqual([1, 0, 0]);
  });

  it('削除を送っている間は、どの操作も押せない', async () => {
    // B-56f 規則6: 二重送信を防ぎ、結末が届く前に画面を離れて失敗の案内を失うことを防ぐ。
    // 削除する・やめる・戻る・ログアウト・招待リンクを作るのすべてが効かない。
    const { deletion } = renderSettings(
      {},
      { deletion: { delete: [{ heldUntilSettled: { outcome: 'failed' } }] } },
    );

    fireEvent.click(operation(DELETE_LABEL));
    fireEvent.click(operation(CONFIRM_LABEL));

    expect(enabledOperationNames()).toEqual([]);

    await act(async () => {
      deletion.settle();
    });
  });

  it('削除に失敗すると、状態の案内を1つ出す', async () => {
    // B-56f 規則8 / 7章: 「いま削除できない」旨を `role="status"` で出す。文言は見ない（規則12）。
    renderSettings({}, { deletion: { delete: [{ outcome: 'failed' }] } });

    await confirmDeletion();

    expect(screen.queryAllByRole('status')).toHaveLength(1);
  });

  it('削除に失敗しても、確認は出たままである', async () => {
    // B-56f 規則8: 利用者はもう一度確かめるか、やめるかを選べる。
    renderSettings({}, { deletion: { delete: [{ outcome: 'failed' }] } });

    await confirmDeletion();

    expect([CONFIRM_LABEL, CANCEL_LABEL].map(operationCount)).toEqual([1, 1]);
  });

  it('削除に失敗しても、自分では送り直さない', async () => {
    // B-56f 規則8: 自動で再試行しない。
    const { deletion } = renderSettings({}, { deletion: { delete: [{ outcome: 'failed' }] } });

    await confirmDeletion();
    await flush();

    expect(deletion.deleteCount).toBe(1);
  });

  it('失敗のあと確かめる操作を押すと、もう一度送られ、案内は消える', async () => {
    // B-56f 規則8: 操作は再び効き、案内は次に送ったときに消える。2度目は保留にして、
    // 送っている間に案内が残っていないことを観る。
    const { deletion } = renderSettings(
      {},
      {
        deletion: { delete: [{ outcome: 'failed' }, { heldUntilSettled: { outcome: 'failed' } }] },
      },
    );

    await confirmDeletion();
    fireEvent.click(operation(CONFIRM_LABEL));
    await flush();

    expect(deletion.deleteCount).toBe(2);
    expect(screen.queryAllByRole('status')).toHaveLength(0);

    await act(async () => {
      deletion.settle();
    });
  });

  it('失敗のあとやめると、案内は消える', async () => {
    // B-56f 規則8: 案内はやめたときに消える。
    renderSettings({}, { deletion: { delete: [{ outcome: 'failed' }] } });

    await confirmDeletion();
    fireEvent.click(operation(CANCEL_LABEL));

    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });
});

/**
 * デザイン 13 / 13b の文言と構造（B-67 設計 6章 規則11〜18 / ADR-074 決定1）。
 *
 * 文言は原本から取ったもので仮ではないので、**名前（アクセシブルな名前）で引く**。
 */
describe('設定画面 SettingsScreen のデザイン 13・13b の文言と構造', () => {
  it('「戻る」という名前の操作は、他のどの操作よりも前にある', () => {
    // B-67 規則11 / 10章 前提6: 戻るは見出しの段にあり、名前は `aria-label="戻る"` が持つ。
    renderSettings();

    expect(screen.getAllByRole('button').at(0)).toBe(operation(CLOSE_LABEL));
  });

  it('戻る操作は見える文字を持たない', () => {
    // B-67 規則11・20: アイコンは飾りで、名前は置き場の `aria-label` が持つ（先行 `MealDetail`）。
    renderSettings();

    expect(operation(CLOSE_LABEL).textContent).toBe('');
  });

  it('段1の見出しは「設定」の1つだけである', () => {
    // B-67 規則11 / 10章 前提3: 題を `h1` に上げる（先行 `ScreenHeader`）。
    renderSettings();

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['設定']);
  });

  it('帯は段2の見出し「アカウント」「冷蔵庫の共有」「データ」で、この順に並ぶ', () => {
    // B-76 規則1 / B-67 規則12 / `docs/design/README.md`「冷蔵庫の共有」
    renderSettings();

    expect(bandHeadingTexts()).toEqual([ACCOUNT_BAND, SHARING_BAND, DATA_BAND]);
  });

  it('ログアウトの操作は「アカウント」の帯と「冷蔵庫の共有」の帯の間にある', () => {
    // B-67 規則13 / B-76 規則1: ログアウトの行は `アカウント` の帯の直下。
    renderSettings();

    expect(
      inDocumentOrder([
        bandHeading(ACCOUNT_BAND),
        operation(SIGN_OUT_LABEL),
        bandHeading(SHARING_BAND),
      ]),
    ).toBe(true);
  });

  it('削除の操作は「データ」の帯より後にある', () => {
    // B-67 規則14: 削除の操作は `データ` の帯の下の置き場に置く。
    renderSettings();

    expect(precedes(bandHeading(DATA_BAND), operation(DELETE_LABEL))).toBe(true);
  });

  it('「ログアウト」という名前の操作は戻る操作より後にある', () => {
    // B-67 規則13 / 原本 13
    renderSettings();

    expect(precedes(operation(CLOSE_LABEL), operation(SIGN_OUT_LABEL))).toBe(true);
  });

  it('確認の前は「アカウントとデータを削除」という名前の操作が出る', () => {
    // B-67 規則14 / FR-27 / 原本 13
    renderSettings();

    expect(operationCount(DELETE_LABEL)).toBe(1);
  });

  it('確認が出ている間は「削除する」という名前の操作が出る', () => {
    // B-67 規則15 / 原本 13b
    renderSettings();

    fireEvent.click(operation(DELETE_LABEL));

    expect(operationCount(CONFIRM_LABEL)).toBe(1);
  });

  it('確認が出ている間は「やめる」という名前の操作が「削除する」より後に出る', () => {
    // B-67 規則15 / 原本 13b
    renderSettings();

    fireEvent.click(operation(DELETE_LABEL));

    expect(precedes(operation(CONFIRM_LABEL), operation(CANCEL_LABEL))).toBe(true);
  });

  it('確認が出ている間も、帯は「アカウント」「冷蔵庫の共有」「データ」の3つのまま残る', () => {
    // B-67 規則12・15 / B-76 規則1: 確認は削除の操作と入れ替わるだけで、帯は消えない。
    renderSettings();

    fireEvent.click(operation(DELETE_LABEL));

    expect(bandHeadingTexts()).toEqual([ACCOUNT_BAND, SHARING_BAND, DATA_BAND]);
  });

  it('削除に失敗した案内は、やめる操作より後に出る', async () => {
    // B-67 規則17 / B-56f 規則8: 案内は確認の中、操作群の後ろ。文言は暫定なので見ない。
    renderSettings({}, { deletion: { delete: [{ outcome: 'failed' }] } });

    await confirmDeletion();

    const notices = screen.getAllByRole('status');
    expect(notices).toHaveLength(1);
    const [notice] = notices;
    if (notice === undefined) throw new Error('案内が無い');
    expect(precedes(operation(CANCEL_LABEL), notice)).toBe(true);
  });
});

/**
 * 接続が切れている間（B-70 設計 6章 規則6・12 / FR-41 / FR-27）。
 *
 * **止めるのは確認の中の削除の操作（削除する）だけ**で、確認を開くこと・やめること・
 * ログアウト・戻ることは止めない（規則6 / `Session.ts` 規則8 — サインアウトは手元を必ず捨てる）。
 */
describe('設定画面 SettingsScreen の接続が切れている間', () => {
  it('接続が切れている間は、確認の中の削除の操作が押せない', () => {
    renderSettings({ offline: true });

    fireEvent.click(operation(DELETE_LABEL));

    // 規則12 / FR-41: 世帯のデータを消すのは書き込みを伴う操作である。
    expect(operation(CONFIRM_LABEL).disabled).toBe(true);
  });

  it('接続が切れていても、削除の確認を開ける', () => {
    renderSettings({ offline: true });

    fireEvent.click(operation(DELETE_LABEL));

    // 規則12・6: 確認を開くのは遷移である。
    expect([CONFIRM_LABEL, CANCEL_LABEL].map(operationCount)).toEqual([1, 1]);
  });

  it('接続が切れていても、確認をやめると削除の操作に戻る', () => {
    const { deletion } = renderSettings({ offline: true });

    fireEvent.click(operation(DELETE_LABEL));
    fireEvent.click(operation(CANCEL_LABEL));

    // 規則12・6: やめるのは遷移であり、削除は送られない。
    expect(operationCount(DELETE_LABEL)).toBe(1);
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

    fireEvent.click(operation(SIGN_OUT_LABEL));
    await flush();

    // 規則6 / `Session.ts` 規則8: サインアウトは手元のセッションを捨てるだけで止めない。
    expect(signedOut).toHaveLength(1);
  });

  it('接続が切れていても、閉じる求めが届く', () => {
    const closed: string[] = [];
    renderSettings({ offline: true, onClose: () => closed.push('close') });

    fireEvent.click(operation(CLOSE_LABEL));

    // 規則6: 設定を閉じるのは遷移である。
    expect(closed).toHaveLength(1);
  });
});

/**
 * 端末の「戻る」（B-75 設計 6章 規則1・2・6 / ADR-084）。
 *
 * 継ぎ目は記憶上の `FixedBackNavigation` に差し替え、`pressBack()` で「利用者が戻るを押した」
 * ことにする。閉じたことは閉じる口を配列に残して観る（`docs/testing.md` 2章）。確認が閉じた
 * ことは、確認の前の操作が戻ったことで観る。
 */
describe('設定画面 SettingsScreen の端末の戻る', () => {
  it('設定で戻ると、閉じる口へ届く', () => {
    const closed: string[] = [];
    const { backNavigation } = renderSettingsWithBack(closed);

    pressBack(backNavigation);

    // 規則1・2: 「戻る」の操作と同じ口で閉じる（設定 → 開く前のタブ）。
    expect(closed).toEqual(['close']);
  });

  it('削除の確認を出している間に戻ると、確認が閉じて元の削除の操作が出る', () => {
    const { backNavigation } = renderSettingsWithBack([]);
    fireEvent.click(operation(DELETE_LABEL));

    pressBack(backNavigation);

    // 規則1・2: 確認が最後に開いたもの。やめると同じ口（`cancelDeletion`）で閉じる。
    expect(operationCount(DELETE_LABEL)).toBe(1);
  });

  it('削除の確認を戻るで閉じても、設定は閉じない', () => {
    const closed: string[] = [];
    const { backNavigation } = renderSettingsWithBack(closed);
    fireEvent.click(operation(DELETE_LABEL));

    pressBack(backNavigation);

    // 規則1: 戻る1回で閉じるのは1つだけである。
    expect(closed).toEqual([]);
  });

  it('削除を送っている間に戻っても、確認も設定も閉じない', async () => {
    const closed: string[] = [];
    const { deletion, backNavigation } = renderSettingsWithBack(closed, {
      deletion: { delete: [{ heldUntilSettled: { outcome: 'failed' } }] },
    });
    fireEvent.click(operation(DELETE_LABEL));
    fireEvent.click(operation(CONFIRM_LABEL));

    pressBack(backNavigation);

    // 規則6 / B-56f 規則6: 送っている間は戻るを飲み込む。閉じると失敗の案内を失う。
    // 確認が出たままであることは「削除する」が残ることで観る（B-67 規則14）。
    expect([closed, operationCount(CONFIRM_LABEL)]).toEqual([[], 1]);

    await act(async () => {
      deletion.settle();
    });
  });
});

/**
 * 帯「冷蔵庫の共有」の構造（B-76 設計 6章 規則1 / `docs/design/README.md`「冷蔵庫の共有」）。
 */
describe('設定画面 SettingsScreen の冷蔵庫の共有の帯の構造', () => {
  it('帯の中は 人数の行 → 招待リンクを作る → この冷蔵庫から抜ける の順で、「データ」の帯より前にある', () => {
    // B-76 規則1
    renderSettings({ memberCount: sharedByTwo });

    expect(
      inDocumentOrder([
        bandHeading(SHARING_BAND),
        screen.getByText(MEMBER_ROW),
        operation(CREATE_INVITATION_LABEL),
        operation(LEAVE_LABEL),
        bandHeading(DATA_BAND),
      ]),
    ).toBe(true);
  });
});

/** 人数の行（B-76 設計 6章 規則2・17 / FR-47）。 */
describe('設定画面 SettingsScreen の人数の行', () => {
  it('人数が届いていれば「冷蔵庫を共有しているメンバー」と、自分を除いた「N人」を出す', () => {
    // B-76 規則2 / FR-47: 届く人数は自分を含む。
    renderSettings({ memberCount: { outcome: 'loaded', memberCount: 3 } });

    expect([textCount(MEMBER_ROW), textCount('2人')]).toEqual([1, 1]);
  });

  it('自分しか居なければ0人と出す', () => {
    // B-76 規則2
    renderSettings({ memberCount: alone });

    expect(textCount('0人')).toBe(1);
  });

  it('届いた人数が0でも、負の数は出さず0人と出す', () => {
    // B-76 規則2
    renderSettings({ memberCount: { outcome: 'loaded', memberCount: 0 } });

    expect(textCount('0人')).toBe(1);
  });

  it('人数を取りに行っている間は、数も取れなかった旨も出さない', () => {
    // B-76 規則2
    renderSettings({ memberCount: { outcome: 'loading' } });

    expect([textCount(/^\d+人$/), textCount(MEMBER_COUNT_FAILURE_NOTICE)]).toEqual([0, 0]);
  });

  it('人数を取れなかったときは、状態の案内「人数を読み込めませんでした」を1つ出す', () => {
    // B-76 規則2・17: 失敗の案内は `role="status"` で、原因を断定しない。
    renderSettings({ memberCount: { outcome: 'failed' } });

    expect(statusTexts()).toEqual([MEMBER_COUNT_FAILURE_NOTICE]);
  });
});

/** 抜ける操作と招待の操作を出す条件（B-76 設計 6章 規則3・4 / FR-46 / FR-44）。 */
describe('設定画面 SettingsScreen の共有の操作を出す条件', () => {
  it('メンバーが2人なら、抜ける操作を1つ出す', () => {
    // B-76 規則3 / FR-46
    renderSettings({ memberCount: sharedByTwo });

    expect(operationCount(LEAVE_LABEL)).toBe(1);
  });

  it('メンバーが1人なら、抜ける操作を出さない', () => {
    // B-76 規則3 / ADR-087 決定6: 自分しか居なければ抜けられない。
    renderSettings({ memberCount: alone });

    expect(operationCount(LEAVE_LABEL)).toBe(0);
  });

  it('人数を取りに行っている間は、抜ける操作を出さない', () => {
    // B-76 規則3
    renderSettings({ memberCount: { outcome: 'loading' } });

    expect(operationCount(LEAVE_LABEL)).toBe(0);
  });

  it('人数を取れなかったときは、抜ける操作を出さない', () => {
    // B-76 規則3
    renderSettings({ memberCount: { outcome: 'failed' } });

    expect(operationCount(LEAVE_LABEL)).toBe(0);
  });

  it.each<[string, HouseholdMemberCountState]>([
    ['メンバーが1人', alone],
    ['人数を取りに行っている間', { outcome: 'loading' }],
    ['人数を取れなかったとき', { outcome: 'failed' }],
  ])('%sでも、招待リンクを作る操作を出す', (_, memberCount) => {
    // B-76 規則4 / FR-44: 1人でも招ける。
    renderSettings({ memberCount });

    expect(operationCount(CREATE_INVITATION_LABEL)).toBe(1);
  });
});

/** 招待リンクを作る（B-76 設計 6章 規則5・6・17 / FR-44）。 */
describe('設定画面 SettingsScreen の招待リンク', () => {
  it('招待リンクを作る前は、コピーの操作を出さない', () => {
    // B-76 規則5: コピーはリンクと並べて出す。
    renderSettings();

    expect(operationCount(COPY_LABEL)).toBe(0);
  });

  it('招待リンクを作る操作を押すと、招待の作成が1回送られる', async () => {
    // B-76 規則5: 押したときに1往復だけ。
    const { household } = renderSettings();

    await createInvitation();

    expect(household.createCount).toBe(1);
  });

  it('招待が作れたら、基点にトークンを付けたリンクを文字で出す', async () => {
    // B-76 規則5・6 / ADR-087 決定4
    renderSettings({}, { household: { create: [{ outcome: 'created', token: 'abc' }] } });

    await createInvitation();

    expect(textCount(linkOfAbc)).toBe(1);
  });

  it('招待が作れたら、コピーの操作を1つ出す', async () => {
    // B-76 規則5
    renderSettings({}, { household: { create: [{ outcome: 'created', token: 'abc' }] } });

    await createInvitation();

    expect(operationCount(COPY_LABEL)).toBe(1);
  });

  it('招待が作れただけでは、文字を写さない', async () => {
    // B-76 規則5: 写すのはコピーを押したときだけ（iOS は往復の後の書き込みを断る）。
    const { clipboard } = renderSettings(
      {},
      { household: { create: [{ outcome: 'created', token: 'abc' }] } },
    );

    await createInvitation();

    expect(clipboard.writtenTexts).toEqual([]);
  });

  it('もう一度作ると、新しいリンクに置き換わり、前のリンクは出ない', async () => {
    // B-76 規則5
    renderSettings(
      {},
      {
        household: {
          create: [
            { outcome: 'created', token: 'first' },
            { outcome: 'created', token: 'second' },
          ],
        },
      },
    );

    await createInvitation();
    await createInvitation();

    expect([
      textCount('https://fridge.example/?invite=first'),
      textCount('https://fridge.example/?invite=second'),
    ]).toEqual([0, 1]);
  });

  it('招待を作れなかったときは、状態の案内を1つ出す', async () => {
    // B-76 規則17 / 7章: 原因を断定しない案内を `role="status"` で出す。
    renderSettings({}, { household: { create: [{ outcome: 'failed' }] } });

    await createInvitation();

    expect(statusTexts()).toEqual([INVITATION_FAILURE_NOTICE]);
  });

  it('招待を作っている間は、招待リンクを作る操作が押せない', async () => {
    // B-76 規則5: 押したときに1往復だけ — 二重に作らない。
    const { household } = renderSettings(
      {},
      { household: { create: [{ heldUntilSettled: { outcome: 'created', token: 'abc' } }] } },
    );

    fireEvent.click(operation(CREATE_INVITATION_LABEL));

    expect(operation(CREATE_INVITATION_LABEL).disabled).toBe(true);

    await act(async () => {
      household.settle();
    });
  });

  it('招待の失敗のあと、もう一度作ると失敗の案内は消える', async () => {
    // B-76 規則5・17: 案内は次に作ったときに消える。2度目は保留にして、作っている間に
    // 案内が残っていないことを観る。
    const { household } = renderSettings(
      {},
      {
        household: {
          create: [
            { outcome: 'failed' },
            { heldUntilSettled: { outcome: 'created', token: 'abc' } },
          ],
        },
      },
    );

    await createInvitation();
    await createInvitation();

    expect(screen.queryAllByRole('status')).toHaveLength(0);

    await act(async () => {
      household.settle();
    });
  });
});

/** リンクを写す（B-76 設計 6章 規則5・7 / FR-44）。 */
describe('設定画面 SettingsScreen のコピー', () => {
  const createdAbc: FixedHouseholdRequestsOptions = {
    create: [{ outcome: 'created', token: 'abc' }],
  };

  it('コピーを押すと、招待リンクを写す', async () => {
    // B-76 規則5: 押した操作の中で写す。
    const { clipboard } = renderSettings({}, { household: createdAbc });
    await createInvitation();

    await copyLink();

    expect(clipboard.writtenTexts).toEqual([linkOfAbc]);
  });

  it('写せたら「コピーしました」を出す', async () => {
    // B-76 規則7
    renderSettings({}, { household: createdAbc, copies: ['copied'] });
    await createInvitation();

    await copyLink();

    expect(textCount(COPIED_NOTICE)).toBe(1);
  });

  it('写せなかったら「コピーできませんでした。リンクを選んでコピーしてください」を出す', async () => {
    // B-76 規則7
    renderSettings({}, { household: createdAbc, copies: ['failed'] });
    await createInvitation();

    await copyLink();

    expect(textCount(COPY_FAILURE_NOTICE)).toBe(1);
  });

  it('写せなくても、リンクの文字は残る', async () => {
    // B-76 規則7: 手で写せるようにする。
    renderSettings({}, { household: createdAbc, copies: ['failed'] });
    await createInvitation();

    await copyLink();

    expect(textCount(linkOfAbc)).toBe(1);
  });

  it('写せなかったあとに写せたら、「コピーしました」だけを出す', async () => {
    // B-76 規則7: 結末は1つだけ出し、次に写したときに置き換わる。
    renderSettings({}, { household: createdAbc, copies: ['failed', 'copied'] });
    await createInvitation();

    await copyLink();
    await copyLink();

    expect([textCount(COPIED_NOTICE), textCount(COPY_FAILURE_NOTICE)]).toEqual([1, 0]);
  });

  it('リンクを作り直すと、前のコピーの結末は消える', async () => {
    // B-76 規則7: リンクを作り直したときに置き換わる。
    renderSettings(
      {},
      {
        household: {
          create: [
            { outcome: 'created', token: 'abc' },
            { outcome: 'created', token: 'second' },
          ],
        },
        copies: ['copied'],
      },
    );
    await createInvitation();
    await copyLink();

    await createInvitation();

    expect(textCount(COPIED_NOTICE)).toBe(0);
  });
});

/** この冷蔵庫から抜ける（B-76 設計 6章 規則8・9・17 / FR-46）。メンバーは2人。 */
describe('設定画面 SettingsScreen の抜ける操作', () => {
  it('抜ける操作を押すと、確認「この冷蔵庫から抜けますか。抜けると、空の冷蔵庫から始まります」が出る', () => {
    // B-76 規則8
    renderSettings({ memberCount: sharedByTwo });

    fireEvent.click(operation(LEAVE_LABEL));

    expect(textCount(LEAVE_CONFIRM_SENTENCE)).toBe(1);
  });

  it('抜ける操作を押しただけでは、抜けるは送られない', async () => {
    // B-76 規則8: 確認を経て送る。
    const { household } = renderSettings({ memberCount: sharedByTwo });

    fireEvent.click(operation(LEAVE_LABEL));
    await flush();

    expect(household.leaveCount).toBe(0);
  });

  it('確認で「抜ける」を押すと、抜けるが1回送られる', async () => {
    // B-76 規則8
    const { household } = renderSettings({ memberCount: sharedByTwo });

    await confirmLeave();

    expect(household.leaveCount).toBe(1);
  });

  it('確認でやめると、抜けるは送られない', async () => {
    // B-76 規則8
    const { household } = renderSettings({ memberCount: sharedByTwo });

    fireEvent.click(operation(LEAVE_LABEL));
    fireEvent.click(operation(CANCEL_LABEL));
    await flush();

    expect(household.leaveCount).toBe(0);
  });

  it('確認でやめると、抜ける操作に戻る', () => {
    // B-76 規則8
    renderSettings({ memberCount: sharedByTwo });

    fireEvent.click(operation(LEAVE_LABEL));
    fireEvent.click(operation(CANCEL_LABEL));

    expect(operationCount(LEAVE_LABEL)).toBe(1);
  });

  it('抜けるの確認を出している間に削除の操作を押すと、抜けるの確認は閉じて削除の確認が出る', () => {
    // B-76 規則8: 確認は同時に1つだけ。
    renderSettings({ memberCount: sharedByTwo });
    fireEvent.click(operation(LEAVE_LABEL));

    fireEvent.click(operation(DELETE_LABEL));

    expect([textCount(LEAVE_CONFIRM_SENTENCE), textCount(SHARED_CONFIRM_SENTENCE)]).toEqual([0, 1]);
  });

  it('削除の確認を出している間に抜ける操作を押すと、削除の確認は閉じて抜けるの確認が出る', () => {
    // B-76 規則8: 確認は同時に1つだけ。
    renderSettings({ memberCount: sharedByTwo });
    fireEvent.click(operation(DELETE_LABEL));

    fireEvent.click(operation(LEAVE_LABEL));

    expect([textCount(SHARED_CONFIRM_SENTENCE), textCount(LEAVE_CONFIRM_SENTENCE)]).toEqual([0, 1]);
  });

  it('抜けるの確認を出している間に戻ると、確認が閉じて抜ける操作が出る', () => {
    // B-76 規則8 / B-75 規則1・2: 削除の確認と同じく端末の戻るで閉じる。
    const { backNavigation } = renderSettingsWithBack([], {}, { memberCount: sharedByTwo });
    fireEvent.click(operation(LEAVE_LABEL));

    pressBack(backNavigation);

    expect([textCount(LEAVE_CONFIRM_SENTENCE), operationCount(LEAVE_LABEL)]).toEqual([0, 1]);
  });

  it('抜けるの確認を戻るで閉じても、設定は閉じない', () => {
    // B-76 規則8 / B-75 規則1: 戻る1回で閉じるのは1つだけである。
    const closed: string[] = [];
    const { backNavigation } = renderSettingsWithBack(closed, {}, { memberCount: sharedByTwo });
    fireEvent.click(operation(LEAVE_LABEL));

    pressBack(backNavigation);

    expect(closed).toEqual([]);
  });

  it('抜けるを送っている間は、どの操作も押せない', async () => {
    // B-76 規則8: 送っている間は設定画面のどの操作も効かない（削除と同じ置き方）。
    const { household } = renderSettings(
      { memberCount: sharedByTwo },
      { household: { leave: [{ heldUntilSettled: { outcome: 'failed' } }] } },
    );

    fireEvent.click(operation(LEAVE_LABEL));
    fireEvent.click(operation(LEAVE_CONFIRM_LABEL));

    expect(enabledOperationNames()).toEqual([]);

    await act(async () => {
      household.settle();
    });
  });

  it('抜けるを送っている間に戻っても、確認も設定も閉じない', async () => {
    // B-76 規則8 / B-75 規則6: 送っている間は戻るを飲み込む。
    const closed: string[] = [];
    const { household, backNavigation } = renderSettingsWithBack(
      closed,
      { household: { leave: [{ heldUntilSettled: { outcome: 'failed' } }] } },
      { memberCount: sharedByTwo },
    );
    fireEvent.click(operation(LEAVE_LABEL));
    fireEvent.click(operation(LEAVE_CONFIRM_LABEL));

    pressBack(backNavigation);

    expect([closed, operationCount(LEAVE_CONFIRM_LABEL)]).toEqual([[], 1]);

    await act(async () => {
      household.settle();
    });
  });

  it('抜けられなかったときも、確認は出たままである', async () => {
    // B-76 規則9: 利用者はもう一度抜けるか、やめるかを選べる。
    renderSettings({ memberCount: sharedByTwo }, { household: { leave: [{ outcome: 'failed' }] } });

    await confirmLeave();

    expect([LEAVE_CONFIRM_LABEL, CANCEL_LABEL].map(operationCount)).toEqual([1, 1]);
  });

  it('抜けられなかったときは、状態の案内を1つ出す', async () => {
    // B-76 規則9・17 / 7章: 原因を断定しない案内を `role="status"` で出す。
    renderSettings({ memberCount: sharedByTwo }, { household: { leave: [{ outcome: 'failed' }] } });

    await confirmLeave();

    expect(statusTexts()).toEqual([LEAVE_FAILURE_NOTICE]);
  });

  it('抜けられなくても、自分では送り直さない', async () => {
    // B-76 規則9
    const { household } = renderSettings(
      { memberCount: sharedByTwo },
      { household: { leave: [{ outcome: 'failed' }] } },
    );

    await confirmLeave();
    await flush();

    expect(household.leaveCount).toBe(1);
  });

  it('抜けられなかったあとやめると、案内は消える', async () => {
    // B-76 規則9 / 先行 B-56f 規則8
    renderSettings({ memberCount: sharedByTwo }, { household: { leave: [{ outcome: 'failed' }] } });

    await confirmLeave();
    fireEvent.click(operation(CANCEL_LABEL));

    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('抜けられなかったあともう一度抜けると、もう一度送られ、案内は消える', async () => {
    // B-76 規則9 / 先行 B-56f 規則8: 2度目は保留にして、送っている間に案内が残っていないことを観る。
    const { household } = renderSettings(
      { memberCount: sharedByTwo },
      {
        household: { leave: [{ outcome: 'failed' }, { heldUntilSettled: { outcome: 'failed' } }] },
      },
    );

    await confirmLeave();
    fireEvent.click(operation(LEAVE_CONFIRM_LABEL));
    await flush();

    expect([household.leaveCount, screen.queryAllByRole('status').length]).toEqual([2, 0]);

    await act(async () => {
      household.settle();
    });
  });

  it('抜けられたら、確認を閉じる', async () => {
    // B-76 規則9
    renderSettings({ memberCount: sharedByTwo }, { household: { leave: [{ outcome: 'left' }] } });

    await confirmLeave();

    expect(textCount(LEAVE_CONFIRM_SENTENCE)).toBe(0);
  });

  it('抜けるの確認を出したまま人数が1人に変わると、確認も抜ける操作も出ない', () => {
    // B-76 規則3: 抜ける操作を出すのは2人以上のときだけ。
    const { rerenderWith } = renderSettings({ memberCount: sharedByTwo });
    fireEvent.click(operation(LEAVE_LABEL));

    rerenderWith({ memberCount: alone });

    expect([textCount(LEAVE_CONFIRM_SENTENCE), operationCount(LEAVE_LABEL)]).toEqual([0, 0]);
  });
});

/** 削除の確認の文の出し分け（B-76 設計 6章 規則10 / FR-27 / ADR-087 決定6）。 */
describe('設定画面 SettingsScreen の削除の確認の文', () => {
  it('メンバーが2人なら、共有しているメンバーのために残る旨の文を出し、すべて削除する文は出さない', () => {
    // B-76 規則10 / `docs/design/README.md`「削除の確認（メンバーが2人以上）」
    renderSettings({ memberCount: sharedByTwo });

    fireEvent.click(operation(DELETE_LABEL));

    expect([textCount(SHARED_CONFIRM_SENTENCE), textCount(CONFIRM_SENTENCE)]).toEqual([1, 0]);
  });

  it('メンバーが1人なら、確認の文「アカウントと、冷蔵庫の食材・履歴をすべて削除しますか」を出す', () => {
    // B-76 規則10 / B-67 規則15・16 / 原本 13b
    renderSettings({ memberCount: alone });

    fireEvent.click(operation(DELETE_LABEL));

    expect(textCount(CONFIRM_SENTENCE)).toBe(1);
  });

  it('人数を取りに行っている間は、すべて削除する文を出す', () => {
    // B-76 規則10: 分からないときは多く消える側を告げる。
    renderSettings({ memberCount: { outcome: 'loading' } });

    fireEvent.click(operation(DELETE_LABEL));

    expect(textCount(CONFIRM_SENTENCE)).toBe(1);
  });

  it('人数を取れなかったときは、すべて削除する文を出す', () => {
    // B-76 規則10: 分からないときは多く消える側を告げる。
    renderSettings({ memberCount: { outcome: 'failed' } });

    fireEvent.click(operation(DELETE_LABEL));

    expect(textCount(CONFIRM_SENTENCE)).toBe(1);
  });
});

/** 接続が切れている間の共有の操作（B-76 設計 6章 規則11 / FR-41）。 */
describe('設定画面 SettingsScreen の接続が切れている間の共有の操作', () => {
  it('接続が切れている間は、招待リンクを作る操作が押せない', () => {
    // B-76 規則11: 招待を作るのは書き込みを伴う操作である。
    renderSettings({ offline: true });

    expect(operation(CREATE_INVITATION_LABEL).disabled).toBe(true);
  });

  it('接続が切れている間は、抜けるの確認の「抜ける」が押せない', () => {
    // B-76 規則11
    renderSettings({ offline: true, memberCount: sharedByTwo });

    fireEvent.click(operation(LEAVE_LABEL));

    expect(operation(LEAVE_CONFIRM_LABEL).disabled).toBe(true);
  });

  it('接続が切れていても、抜けるの確認を開ける', () => {
    // B-76 規則11: 確認を開くのは遷移である。
    renderSettings({ offline: true, memberCount: sharedByTwo });

    fireEvent.click(operation(LEAVE_LABEL));

    expect(textCount(LEAVE_CONFIRM_SENTENCE)).toBe(1);
  });

  it('接続が切れていても、抜けるの確認をやめると抜ける操作に戻り、抜けるは送られない', () => {
    // B-76 規則11: やめるのは遷移である。
    const { household } = renderSettings({ offline: true, memberCount: sharedByTwo });

    fireEvent.click(operation(LEAVE_LABEL));
    fireEvent.click(operation(CANCEL_LABEL));

    expect([operationCount(LEAVE_LABEL), household.leaveCount]).toEqual([1, 0]);
  });

  it('作ったあとに接続が切れても、コピーは押せて写される', async () => {
    // B-76 規則11: コピーは止めない（手元の文字を写すだけ）。
    const { clipboard, rerenderWith } = renderSettings(
      {},
      { household: { create: [{ outcome: 'created', token: 'abc' }] } },
    );
    await createInvitation();
    rerenderWith({ offline: true });

    await copyLink();

    expect(clipboard.writtenTexts).toEqual([linkOfAbc]);
  });
});

/** 画面の字面（ADR-087 決定7 / B-76 2章）。 */
describe('設定画面 SettingsScreen の字面', () => {
  it('リンクを作り、抜けるの確認を開いても、画面に「世帯」を出さない', async () => {
    // ADR-087 決定7: 利用者に見せる言い方は「冷蔵庫」である。
    renderSettings(
      { memberCount: sharedByTwo },
      { household: { create: [{ outcome: 'created', token: 'abc' }] } },
    );
    await createInvitation();
    fireEvent.click(operation(LEAVE_LABEL));

    expect(document.body.textContent).not.toContain('世帯');
  });
});
