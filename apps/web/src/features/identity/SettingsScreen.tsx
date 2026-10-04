/**
 * 設定画面（B-56c / B-56f / B-76 / `docs/screen-design.md` 8章）。
 *
 * 題 `設定` の下に帯を3つ、`アカウント` → `冷蔵庫の共有` → `データ` の順に置く（B-76 規則1）。
 * 操作は 戻る → ログアウト → 招待リンクを作る →（作った後は）コピー →（メンバーが2人以上なら）
 * この冷蔵庫から抜ける → アカウントとデータを削除 の順で、どれも確認の前は1操作だけである。
 *
 * **削除と抜けるは確認を経なければ送られない**（FR-27 / FR-46 / B-56f 規則4 / B-76 規則8）。
 * 押すと、問う文と `削除する`（または `抜ける`）・`やめる` の2つの操作がその操作に置き換わる。
 * **確認は同時に1つだけ**で、片方を開けばもう片方は閉じる。確認は画面の中に描く —
 * `window.confirm` は描いて観察できず、確認のための依存も足さない。**確認を出しているかは
 * ここが持つ**（門は持たない。設定を閉じて開き直せば確認は出ていない）。削除の確認の文は、
 * メンバーが2人以上と分かっているときだけ「共有しているメンバーのために残る」文にし、
 * 分からないときは多く消える側を告げる（B-76 規則10）。
 *
 * **削除か抜けるを送っている間はすべての操作が効かない**（B-56f 規則6 / B-76 規則8）—
 * 二重送信を防ぎ、結末が届く前に画面を離れて失敗の案内を失うことを防ぐ。消えた回のサインアウトは
 * 門が済ませる（ADR-071 結果2）。抜けられた回は確認を閉じ、人数とデータの取り直しは門が持つ。
 * **失敗した回は確認を出したまま、原因を断定しない案内を1つ出す**（B-56f 規則8 / B-76 規則9）—
 * 自分では送り直さず、案内は次に送ったとき・やめたときに消える。
 *
 * 人数は門が取りに行き、ここは自分を除いた数で出す（届く人数は自分を含む。B-76 規則2）。抜ける操作は
 * メンバーが2人以上と分かっているときだけ出す（規則3。自分しか居なければ抜けられない）。
 * 招待リンクは押した回に1往復だけ作り、文字で出す。**作った時点では写さず、`コピー` を
 * 押した操作の中で写す**（規則5 — iOS は往復の後の書き込みを断る）。写した結末は1つだけ出し、
 * 失敗してもリンクの文字は残す（規則7）。
 *
 * **接続が切れている間は書き込みを伴う操作だけを止める**（FR-41 / B-70 規則12 / B-76 規則11）—
 * `削除する`・`抜ける`・`招待リンクを作る`。確認を開く・やめる・コピー・ログアウト・戻るは止めない。
 *
 * ログアウトは既存の `SignOutButton` をそのまま使う（確認を出さない1操作。B-35 設計 規則11）。
 * 閉じるはログアウトを送っている間も効かせたままにする — サインアウトの結末は画面に届かない
 * ので（`Session.ts` 規則8）、閉じて捨てるものが無い。端末の戻るは、確認を出していれば確認を、
 * そうでなければ設定を閉じる（B-75 規則1・2）。
 *
 * 開いているかを持つのは門である（ADR-066 と同じ理由）。**設定はタブの外の4つ目の行き先であり**、
 * 門が組んだこの画面を器（`TabbedScreen`）が選んでいたタブの中身の代わりに描く（B-60 設計 6章 規則7）。
 * どのタブを押しても閉じる — ただし削除を送っている間は門が帯を止めるので、タブからは閉じない
 * （B-60b 規則1）。ここはセッションの型を見ず、口を受け取るだけである（ADR-046 決定3）。
 *
 * **見た目と文言はデザインに揃えた**（13 / 13b と `docs/design/README.md` の「冷蔵庫の共有」。
 * 値は `SettingsScreen.module.css`）。帯は見出し `h2` で置く — 帯は操作ではなく、題 `h1` の下の
 * 区分として読み上げで辿れるようにする。文言はデザインが正である（ADR-074 決定1）。削除の失敗の
 * 案内だけはデザインに無く暫定である。画面に「世帯」を出さない（ADR-087 決定7）。
 */

import type { JSX } from 'react';
import { useState } from 'react';
import type { DeleteHouseholdDataOutcome } from '../../server/HouseholdDataRequests.js';
import type {
  CreateHouseholdInvitation,
  LeaveHousehold,
  ShowHouseholdMemberCountOutcome,
} from '../../server/HouseholdRequests.js';
import type { ClipboardWriter, CopyOutcome } from '../../clipboard/ClipboardWriter.js';
import { Icon } from '../../icons/Icon.js';
import { SignOutButton } from './SignOutButton.js';
import { householdInvitationLink } from './HouseholdInvitationLink.js';
import styles from './SettingsScreen.module.css';
import { useBackHandler } from '../../backNavigation/BackHandler.js';

/*
 * 文言は原本 `docs/design/src/index.dc.html` 13 / 13b と `docs/design/README.md` の
 * 「冷蔵庫の共有」「削除の確認（メンバーが2人以上）」の行から取った（ADR-074 決定1 — デザインが正）。
 */

/**
 * 閉じる操作の名前（B-67 規則11・20）。**見える文字は持たず**、`back` のアイコンだけを出す
 * （先行 `MealDetail`）。
 */
const CLOSE_LABEL = '戻る';

/** 画面の題（`h1`）。 */
const SETTINGS_HEADING = '設定';

/** ログアウトの行の上の帯。 */
const ACCOUNT_BAND = 'アカウント';

/** 人数・招待・抜けるの上の帯。 */
const SHARING_BAND = '冷蔵庫の共有';

/** 削除の置き場の上の帯。 */
const DATA_BAND = 'データ';

/** 人数の行の名札。 */
const MEMBER_ROW_LABEL = '冷蔵庫を共有しているメンバー';

/** 人数を取れなかった案内。原因を断定しない（B-76 規則17）。 */
const MEMBER_COUNT_FAILURE_NOTICE = '人数を読み込めませんでした';

/** 招待リンクを作る操作の名札。 */
const CREATE_INVITATION_LABEL = '招待リンクを作る';

/** 招待リンクを作る操作の下の補助の文字。 */
const INVITATION_HINT =
  'この冷蔵庫を共有したい相手に以下の招待リンクを共有してください。1回のみ使用可能で、有効期限は24時間です。';

/** 招待を作れなかった案内。 */
const INVITATION_FAILURE_NOTICE =
  'いまは招待リンクを作れませんでした。時間をおいてもう一度お試しください。';

/** リンクを写す操作の名札。 */
const COPY_LABEL = 'コピー';

/** 写した結末の案内（B-76 規則7）。 */
const COPY_NOTICES: Record<CopyOutcome, string> = {
  copied: 'コピーしました',
  failed: 'コピーできませんでした。リンクを選んでコピーしてください',
};

/** 抜ける操作の名札。 */
const LEAVE_LABEL = 'この冷蔵庫から抜ける';

/** 抜けるの確認の文。 */
const LEAVE_CONFIRM_NOTICE = 'この冷蔵庫から抜けますか。抜けると、空の冷蔵庫から始まります';

/** 確認の中で抜けるを送る操作の名札。 */
const LEAVE_CONFIRM_LABEL = '抜ける';

/** 抜けられなかった案内。 */
const LEAVE_FAILURE_NOTICE = 'いまは抜けられませんでした。時間をおいてもう一度お試しください。';

/** 削除の操作の名札。 */
const DELETE_LABEL = 'アカウントとデータを削除';

/** 削除の確認の文（1人のとき・人数が分からないとき）。何が消えるかを問う（B-67 規則15・16）。 */
const CONFIRM_NOTICE = 'アカウントと、冷蔵庫の食材・履歴をすべて削除しますか';

/** 削除の確認の文（メンバーが2人以上のとき。B-76 規則10）。 */
const SHARED_CONFIRM_NOTICE =
  'アカウントを削除しますか。冷蔵庫の食材・履歴は、共有しているメンバーのために残ります';

/** 確認の中で削除を送る操作の名札。 */
const CONFIRM_LABEL = '削除する';

/** やめる操作の名札（削除と抜けるの確認で共通）。 */
const CANCEL_LABEL = 'やめる';

/** 削除の失敗の案内（**暫定** — デザインに無い）。原因を断定しない（B-56f 規則8）。 */
const DELETE_FAILURE_NOTICE = 'いまは削除できませんでした。時間をおいてもう一度お試しください。';

/** 世帯の人数の状態。取りに行っている間は `loading`（B-76 規則2）。 */
export type HouseholdMemberCountState =
  { readonly outcome: 'loading' } | ShowHouseholdMemberCountOutcome;

/** 出している確認。同時に1つだけ（B-76 規則8）。 */
type Confirmation = 'none' | 'delete' | 'leave';

export type SettingsScreenProps = {
  /** サインアウトの実行。SignOutButton へ素通しする（Session.ts 規則8）。 */
  onSignOut: () => Promise<void>;
  /** 設定を閉じて、開く前に選んでいたタブへ戻る（B-60 規則9）。 */
  onClose: () => void;
  /** 削除を送る。消えた回のサインアウトは門が済ませてから解決する（B-56f 設計 5章）。 */
  onDeleteHouseholdData: () => Promise<DeleteHouseholdDataOutcome>;
  /** 接続が切れているか（B-70 / FR-41）。省略は `false`。 */
  offline?: boolean;
  /** 世帯の人数（FR-47 / B-76 規則2・3・10）。取りに行くのは門である。 */
  memberCount: HouseholdMemberCountState;
  /** 招待リンクの基点。末尾の `/` を持たない（B-76 規則6）。 */
  webOrigin: string;
  /** 招待を作る口（FR-44 / B-76 規則5）。 */
  onCreateHouseholdInvitation: CreateHouseholdInvitation;
  /** 世帯を抜ける口（FR-46 / B-76 規則8・9）。 */
  onLeaveHousehold: LeaveHousehold;
  /** 文字を写す継ぎ目（FR-44 / B-76 規則5・7）。 */
  clipboard: ClipboardWriter;
};

export function SettingsScreen({
  onSignOut,
  onClose,
  onDeleteHouseholdData,
  offline = false,
  memberCount,
  webOrigin,
  onCreateHouseholdInvitation,
  onLeaveHousehold,
  clipboard,
}: SettingsScreenProps): JSX.Element {
  const [requestedConfirmation, setRequestedConfirmation] = useState<Confirmation>('none');
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  const [creatingInvitation, setCreatingInvitation] = useState(false);
  const [invitationFailed, setInvitationFailed] = useState(false);
  const [copyOutcome, setCopyOutcome] = useState<CopyOutcome | null>(null);

  // メンバーが2人以上と分かっているときだけ抜けられ、削除で冷蔵庫が残る（B-76 規則3・10）。
  const shared = memberCount.outcome === 'loaded' && memberCount.memberCount >= 2;
  // 抜けるの確認を出したまま人数が2人未満になれば、確認も出さない（B-76 規則19）。
  const confirmation =
    requestedConfirmation === 'leave' && !shared ? 'none' : requestedConfirmation;

  // 端末の戻るは、確認を出していれば確認を、そうでなければ設定を閉じる（B-75 規則1・2）。
  // 確認の口は確認を出すたびに後から登録されるので、設定の口より先に呼ばれる。
  // **送っている間はどちらも飲み込む**（B-56f 規則6）— 閉じると失敗の案内を失う。
  useBackHandler(true, () => {
    if (!sending) onClose();
  });
  useBackHandler(confirmation !== 'none', () => {
    if (!sending) closeConfirmation();
  });

  function openConfirmation(next: Confirmation) {
    setRequestedConfirmation(next);
    setSendFailed(false);
  }

  function closeConfirmation() {
    openConfirmation('none');
  }

  /** 確認の中の確定を送る。**接続が切れている間は止める**（B-70 規則12 / B-76 規則11）。 */
  async function send(request: () => Promise<{ readonly outcome: string }>) {
    if (sending || offline) return;

    setSending(true);
    setSendFailed(false);
    try {
      const { outcome } = await request();
      if (outcome === 'failed') setSendFailed(true);
      else setRequestedConfirmation('none');
    } finally {
      setSending(false);
    }
  }

  // 消えた回は門がサインアウトを済ませており、この画面はもう出ていない（B-56f 規則7）。
  const confirmDeletion = () => send(onDeleteHouseholdData);
  const confirmLeave = () => send(onLeaveHousehold);

  async function createInvitation() {
    if (creatingInvitation || sending || offline) return;

    setCreatingInvitation(true);
    setInvitationFailed(false);
    try {
      const result = await onCreateHouseholdInvitation();
      if (result.outcome === 'created') {
        setInvitationLink(householdInvitationLink(webOrigin, result.token));
        setCopyOutcome(null);
      } else {
        setInvitationFailed(true);
      }
    } finally {
      setCreatingInvitation(false);
    }
  }

  async function copyInvitationLink(link: string) {
    setCopyOutcome(await clipboard.writeText(link));
  }

  function renderConfirmation(
    sentence: string,
    confirmLabel: string,
    onConfirm: () => Promise<void>,
    failureNotice: string,
  ) {
    return (
      <div className={styles.confirmation}>
        <p className={styles.confirmSentence}>{sentence}</p>
        <div className={styles.confirmActions}>
          <button
            type="button"
            className={styles.confirm}
            disabled={sending || offline}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={sending}
            onClick={closeConfirmation}
          >
            {CANCEL_LABEL}
          </button>
        </div>
        {sendFailed && (
          <p role="status" className={styles.notice}>
            {failureNotice}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.back}
          aria-label={CLOSE_LABEL}
          disabled={sending}
          onClick={onClose}
        >
          <Icon name="back" size={24} />
        </button>
        <h1 className={styles.title}>{SETTINGS_HEADING}</h1>
      </div>
      <h2 className={styles.band}>{ACCOUNT_BAND}</h2>
      <SignOutButton onSignOut={onSignOut} disabled={sending} className={styles.signOut} />
      <h2 className={`${styles.band} ${styles.bandSpaced}`}>{SHARING_BAND}</h2>
      <div className={styles.memberRow}>
        <span>{MEMBER_ROW_LABEL}</span>
        {memberCount.outcome === 'loaded' && (
          <span>{`${Math.max(memberCount.memberCount - 1, 0)}人`}</span>
        )}
        {memberCount.outcome === 'failed' && (
          <span role="status" className={styles.memberCountFailure}>
            {MEMBER_COUNT_FAILURE_NOTICE}
          </span>
        )}
      </div>
      <div className={styles.sharingArea}>
        <div className={styles.invitation}>
          <button
            type="button"
            className={styles.secondary}
            disabled={creatingInvitation || sending || offline}
            onClick={createInvitation}
          >
            {CREATE_INVITATION_LABEL}
          </button>
          <p className={styles.hint}>{INVITATION_HINT}</p>
          {invitationFailed && (
            <p role="status" className={styles.notice}>
              {INVITATION_FAILURE_NOTICE}
            </p>
          )}
          {invitationLink !== null && (
            <div className={styles.linkRow}>
              <p className={styles.link}>{invitationLink}</p>
              <button
                type="button"
                className={`${styles.secondary} ${styles.copy}`}
                disabled={sending}
                onClick={() => copyInvitationLink(invitationLink)}
              >
                {COPY_LABEL}
              </button>
            </div>
          )}
          {copyOutcome !== null && (
            <p role="status" className={styles.notice}>
              {COPY_NOTICES[copyOutcome]}
            </p>
          )}
        </div>
        {shared &&
          (confirmation === 'leave' ? (
            renderConfirmation(
              LEAVE_CONFIRM_NOTICE,
              LEAVE_CONFIRM_LABEL,
              confirmLeave,
              LEAVE_FAILURE_NOTICE,
            )
          ) : (
            <button
              type="button"
              className={styles.secondary}
              disabled={sending}
              onClick={() => openConfirmation('leave')}
            >
              {LEAVE_LABEL}
            </button>
          ))}
      </div>
      <h2 className={styles.band}>{DATA_BAND}</h2>
      <div className={styles.dataArea}>
        {confirmation === 'delete' ? (
          renderConfirmation(
            shared ? SHARED_CONFIRM_NOTICE : CONFIRM_NOTICE,
            CONFIRM_LABEL,
            confirmDeletion,
            DELETE_FAILURE_NOTICE,
          )
        ) : (
          <button
            type="button"
            className={styles.delete}
            disabled={sending}
            onClick={() => openConfirmation('delete')}
          >
            {DELETE_LABEL}
          </button>
        )}
      </div>
    </div>
  );
}
