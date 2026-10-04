// @vitest-environment jsdom
/**
 * 参加の確認の画面 `HouseholdJoinScreen`（B-77 設計 6章 規則10〜14 / 7章 / FR-45 / FR-41 /
 * ADR-087 決定4・7 / `docs/testing.md` 4.1）。
 *
 * **文言は `docs/design/README.md` の行「冷蔵庫の共有に参加」から取ったもので仮ではない**
 * （ADR-074 決定1）ので、字面で確かめる。操作は**名前で引く**。失敗の案内は役割 `status` で
 * 引く（先行 `SettingsScreen.test.tsx` の冷蔵庫の共有の失敗の案内）。
 *
 * **`vi.fn()` で呼び出しを検めない**（`docs/testing.md` 2章）。参加するの口に届いたことは
 * `FixedHouseholdRequests` が積んだトークンで、参加しない・閉じるに届いたことはテストが渡した
 * 関数が配列に積んだもので観る。「送っている間」は `PendingReleases` の保留で作る（同 5章）。
 */

import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '../../support/dom/renderComponent.js';
import type { Delivery } from '../../support/HeldDelivery.js';
import { FixedHouseholdRequests } from '../../support/server/FixedHouseholdRequests.js';
import { HouseholdJoinScreen } from '../../../src/features/identity/HouseholdJoinScreen.js';
import type { HouseholdJoinScreenProps } from '../../../src/features/identity/HouseholdJoinScreen.js';
import type { JoinHouseholdOutcome } from '../../../src/server/HouseholdRequests.js';

/*
 * 文言は `docs/design/README.md` の行「冷蔵庫の共有に参加」から取った（ADR-074 決定1）。
 */

const HEADING = '冷蔵庫の共有に参加';
const CONFIRM_SENTENCE =
  '招待された冷蔵庫を共有します。参加すると、あなたの冷蔵庫の食材・献立・履歴は消え、招待した人の冷蔵庫のものにそろいます。';
const JOIN_LABEL = '参加する';
const DECLINE_LABEL = '参加しない';
const CLOSE_LABEL = '閉じる';
const UNAVAILABLE_NOTICE = 'いまは参加できませんでした。時間をおいてもう一度お試しください。';
const INVALID_INVITATION_NOTICE =
  'この招待リンクは使えません。リンクは1回だけ使え、24時間で切れます。招待した人に新しいリンクを作ってもらってください。';
const ALREADY_MEMBER_NOTICE = 'すでにこの冷蔵庫を共有しています。';

/** 画面は送るトークンを知らない（門が持つ）。口に届いたことを数えるためだけの標本。 */
const invitationToken = 'tok-1';

const invalidInvitation: JoinHouseholdOutcome = {
  outcome: 'rejected',
  rule: 'joinHousehold.invalidInvitation',
};
const alreadyMember: JoinHouseholdOutcome = {
  outcome: 'rejected',
  rule: 'joinHousehold.alreadyMember',
};

/**
 * 既定の参加するの口は、**呼ばれたら積んで結末を保留する**（送っている間のまま）。参加が本題で
 * ない観点では呼ばれないが、呼ばれても結末を配らないので画面は何も変えない。
 */
const HELD_JOIN: readonly Delivery<JoinHouseholdOutcome>[] = [
  { heldUntilSettled: { outcome: 'failed' } },
];

/**
 * 参加の確認を描く。既定は接続している状態。本題の props だけを `overrides` に、参加するの
 * 台本を `joins` に渡す。
 */
function renderJoinScreen(
  overrides: Partial<HouseholdJoinScreenProps> = {},
  joins: readonly Delivery<JoinHouseholdOutcome>[] = HELD_JOIN,
) {
  const household = new FixedHouseholdRequests({ join: joins });
  // 押された回を、押された順に記録する（`vi.fn()` で数えない。`docs/testing.md` 2章）。
  const declined: true[] = [];
  const closed: true[] = [];
  const props: HouseholdJoinScreenProps = {
    onJoin: () => household.joinHousehold(invitationToken),
    onDecline: () => declined.push(true),
    onClose: () => closed.push(true),
    offline: false,
    ...overrides,
  };

  const { rerender } = render(<HouseholdJoinScreen {...props} />);

  return {
    household,
    declined,
    closed,
    /** 門が props を変えた回（接続が切れた）を再現する。 */
    rerenderWith: (changes: Partial<HouseholdJoinScreenProps>) => {
      rerender(<HouseholdJoinScreen {...props} {...changes} />);
    },
  };
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
function textCount(text: string): number {
  return screen.queryAllByText(text).length;
}

/** `role="status"` の案内の文を文書順に並べる（先行 `SettingsScreen.test.tsx`）。 */
function statusTexts(): readonly (string | null)[] {
  return screen.queryAllByRole('status').map((notice) => notice.textContent);
}

/** 押せる操作の名前。**操作が1つも無ければ落ちる**（空の画面で緑にしない）。 */
function enabledOperationNames(): readonly (string | null)[] {
  return (screen.getAllByRole('button') as HTMLButtonElement[])
    .filter((button) => !button.disabled)
    .map((button) => button.getAttribute('aria-label') ?? button.textContent);
}

/** 押したあとに届く更新を `act` の中で流す。 */
async function flush(): Promise<void> {
  await act(async () => {});
}

/** 参加するを押し、結末を流す。 */
async function join(): Promise<void> {
  fireEvent.click(operation(JOIN_LABEL));
  await flush();
}

/** 保留している参加の結末を解く。 */
async function settle(household: FixedHouseholdRequests): Promise<void> {
  await act(async () => {
    household.settle();
  });
}

/** `before` が文書順で `after` より前にあるか（jsdom はレイアウトを持たない。先行 `SettingsScreen.test.tsx`）。 */
function precedes(before: Node, after: Node): boolean {
  return (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('参加の確認の画面 HouseholdJoinScreen の構造', () => {
  it('画面の上にロゴ「fridge to meal」が出る', () => {
    renderJoinScreen();

    // 規則14 / ADR-074: ログインの画面と同じ組み方で、ロゴは原本の文字1つ（先行 `SignInForm`）。
    expect(screen.getByText('fridge to meal')).not.toBeNull();
  });

  it('見出しは「冷蔵庫の共有に参加」の1つだけで、階層1である', () => {
    renderJoinScreen();

    // 規則10・14: 門がタブの代わりにこの画面だけを描き、上位の見出しが無いので h1 にする
    // （先行 `SignInForm.test.tsx`）。
    const headings = screen.getAllByRole('heading');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toBe(screen.getByRole('heading', { level: 1, name: HEADING }));
  });

  it('参加すると自分の食材・献立・履歴が消え、招待した人の冷蔵庫のものにそろうことを書く', () => {
    renderJoinScreen();

    // 規則10 / FR-45 / ADR-087 決定5。
    expect(textCount(CONFIRM_SENTENCE)).toBe(1);
  });

  it('操作は「参加する」「参加しない」の順に並ぶ', () => {
    renderJoinScreen();

    // 規則10: `参加する`（主）・`参加しない`（副）。
    expect(screen.getAllByRole('button')).toEqual([
      operation(JOIN_LABEL),
      operation(DECLINE_LABEL),
    ]);
  });
});

describe('参加の確認の画面 HouseholdJoinScreen の操作', () => {
  it('参加するを押すと、参加するの口に1回届く', async () => {
    const { household } = renderJoinScreen({}, [{ outcome: 'joined' }]);

    await join();

    // FR-45 / 規則7: 押した回に1往復だけ。
    expect(household.joinedTokens).toEqual([invitationToken]);
  });

  it('参加しないを押すと参加しないの口に届き、参加するの口には届かない', () => {
    // 規則9 / ADR-087 決定4: 断ったら送らない。
    const { household, declined } = renderJoinScreen({}, [{ outcome: 'joined' }]);

    fireEvent.click(operation(DECLINE_LABEL));

    expect([declined.length, household.joinedTokens.length]).toEqual([1, 0]);
  });

  it('参加できた回は、失敗の案内も断りの案内も出さない', async () => {
    renderJoinScreen({}, [{ outcome: 'joined' }]);

    await join();

    // 規則8: `joined` は案内を出さない（閉じるのは門）。
    expect([
      textCount(UNAVAILABLE_NOTICE),
      textCount(INVALID_INVITATION_NOTICE),
      textCount(ALREADY_MEMBER_NOTICE),
    ]).toEqual([0, 0, 0]);
  });

  it('送っている間は、参加するも参加しないも押せない', async () => {
    // 規則11: 二重送信と、結末の前に離れることを防ぐ。
    const { household } = renderJoinScreen();

    fireEvent.click(operation(JOIN_LABEL));

    expect([operation(JOIN_LABEL).disabled, operation(DECLINE_LABEL).disabled]).toEqual([
      true,
      true,
    ]);

    await settle(household);
  });
});

describe('参加の確認の画面 HouseholdJoinScreen の接続が切れている間', () => {
  it('接続が切れていると、参加するが押せない', () => {
    renderJoinScreen({ offline: true });

    // 規則11 / FR-41: 書き込みを伴う操作は止める。
    expect(operation(JOIN_LABEL).disabled).toBe(true);
  });

  it('接続が切れていても、参加しないは押せて参加しないの口に届く', () => {
    const { declined } = renderJoinScreen({ offline: true });

    fireEvent.click(operation(DECLINE_LABEL));

    // 規則11: 参加しないは手元で閉じるだけなので止めない。
    expect(declined).toHaveLength(1);
  });

  it('使えないリンクの案内のあと接続が切れても、閉じるは押せて閉じるの口に届く', async () => {
    const { closed, rerenderWith } = renderJoinScreen({}, [invalidInvitation]);

    await join();
    rerenderWith({ offline: true });
    fireEvent.click(operation(CLOSE_LABEL));

    // 規則11: 閉じるは手元で閉じるだけなので止めない。
    expect(closed).toHaveLength(1);
  });
});

describe('参加の確認の画面 HouseholdJoinScreen の失敗', () => {
  it('参加できなかったときは、状態の案内を1つ出す', async () => {
    renderJoinScreen({}, [{ outcome: 'failed' }]);

    await join();

    // 規則12 / 7章: 原因を断定しない案内を `role="status"` で出す（先行 B-76 規則17）。
    expect(statusTexts()).toEqual([UNAVAILABLE_NOTICE]);
  });

  it('失敗の案内は、参加するより前に出る', async () => {
    renderJoinScreen({}, [{ outcome: 'failed' }]);

    await join();

    // 規則12 / `docs/design/README.md`: 失敗は操作の上に出す。
    expect(precedes(screen.getByRole('status'), operation(JOIN_LABEL))).toBe(true);
  });

  it('参加できなかったあとも、参加するも参加しないも押せる', async () => {
    renderJoinScreen({}, [{ outcome: 'failed' }]);

    await join();

    // 規則12: 操作を残し、もう一度送るか断るかを選べる。
    expect(enabledOperationNames()).toEqual([JOIN_LABEL, DECLINE_LABEL]);
  });

  it('参加できなかったあともう一度押すと、失敗の案内は消える', async () => {
    // 規則12: 次に送ったときに消える。2度目は保留にして、送っている間に案内が残っていないことを観る。
    const { household } = renderJoinScreen({}, [
      { outcome: 'failed' },
      { heldUntilSettled: { outcome: 'failed' } },
    ]);

    await join();
    await join();

    expect(screen.queryAllByRole('status')).toHaveLength(0);

    await settle(household);
  });
});

describe('参加の確認の画面 HouseholdJoinScreen の断り', () => {
  it('使えない招待と断られたら、使えないリンクの案内を出す', async () => {
    renderJoinScreen({}, [invalidInvitation]);

    await join();

    // 規則13 / ADR-087 決定4。
    expect(textCount(INVALID_INVITATION_NOTICE)).toBe(1);
  });

  it('使えない招待と断られたら、操作は閉じるの1つだけになる', async () => {
    renderJoinScreen({}, [invalidInvitation]);

    await join();

    // 規則13: 操作を `閉じる`（主）に置き換える。
    expect(screen.getAllByRole('button')).toEqual([operation(CLOSE_LABEL)]);
  });

  it('使えない招待と断られたら、確認の本文は消える', async () => {
    renderJoinScreen({}, [invalidInvitation]);

    await join();

    // 規則13: 本文を案内に置き換える。
    expect(textCount(CONFIRM_SENTENCE)).toBe(0);
  });

  it('使えない招待と断られても、見出しは残る', async () => {
    renderJoinScreen({}, [invalidInvitation]);

    await join();

    // 規則13: 見出しは残す。
    expect(screen.getByRole('heading', { level: 1, name: HEADING })).not.toBeNull();
  });

  it('使えない招待と断られたら、閉じるに焦点が移る', async () => {
    renderJoinScreen({}, [invalidInvitation]);

    await join();

    // 規則13: 押した操作が消えるため、焦点を `閉じる` に移す。
    expect(document.activeElement).toBe(operation(CLOSE_LABEL));
  });

  it('すでに共有していると断られたら、その案内と閉じるを出し、参加するは無い', async () => {
    renderJoinScreen({}, [alreadyMember]);

    await join();

    // 規則13 / ADR-087 決定5。
    expect([
      textCount(ALREADY_MEMBER_NOTICE),
      operationCount(CLOSE_LABEL),
      operationCount(JOIN_LABEL),
    ]).toEqual([1, 1, 0]);
  });

  it('断りの閉じるを押すと閉じるの口に届き、参加しないの口には届かない', async () => {
    const { closed, declined } = renderJoinScreen({}, [invalidInvitation]);

    await join();
    fireEvent.click(operation(CLOSE_LABEL));

    // 規則9: 断りを閉じるのと、参加を断るのは別の口である（門はトークンを消す時点が違う）。
    expect([closed.length, declined.length]).toEqual([1, 0]);
  });
});

/** 画面の字面（ADR-087 決定7）。 */
describe('参加の確認の画面 HouseholdJoinScreen の字面', () => {
  it('確認と失敗の案内に「世帯」を出さない', async () => {
    renderJoinScreen({}, [{ outcome: 'failed' }]);

    await join();

    // 規則10・12 / ADR-087 決定7: 利用者に見せる言い方は「冷蔵庫」である。
    expect([
      textCount(CONFIRM_SENTENCE),
      textCount(UNAVAILABLE_NOTICE),
      document.body.textContent?.includes('世帯'),
    ]).toEqual([1, 1, false]);
  });

  it('使えないリンクとすでに共有している案内に「世帯」を出さない', async () => {
    renderJoinScreen({}, [invalidInvitation]);
    await join();
    // 2つ目の画面を描く。1つ目は `参加する` を持たないので、名前で引けば2つ目のものになる。
    renderJoinScreen({}, [alreadyMember]);
    await join();

    // 規則13 / ADR-087 決定7。
    expect([
      textCount(INVALID_INVITATION_NOTICE),
      textCount(ALREADY_MEMBER_NOTICE),
      document.body.textContent?.includes('世帯'),
    ]).toEqual([1, 1, false]);
  });
});
