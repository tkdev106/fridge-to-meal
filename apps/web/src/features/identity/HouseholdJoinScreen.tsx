/**
 * 参加の確認の画面（FR-45 / ADR-087 決定4・5・7 / B-77）。`docs/screen-design.md` 第8章の
 * 「冷蔵庫の共有に参加」に当たる。招待リンクで開いた利用者に、サインインの後でタブの代わりに出す。
 *
 * 送るトークンは門（`App.tsx`）が持ち、ここは `onJoin` を呼んで結末を読むだけである。結末の読み分けは
 * `HouseholdJoinNotice.ts` に置き、**日本語はここにしか置かない**（文言の正は `docs/design/README.md` の
 * 行「冷蔵庫の共有に参加」）。画面に「世帯」は出さない（ADR-087 決定7）。
 *
 * 見た目はログインの画面に揃え、値は `SignInForm.module.css` の class を引いて共有する。足りない値だけ
 * `HouseholdJoinScreen.module.css`（ADR-055 決定1・2）。
 *
 * 「戻る」の口は登録しない — 戻るはアプリを離れ、トークンは残るので開き直せばこの確認が出る
 * （`docs/screen-design.md` 2.3）。
 */

import { useEffect, useRef, useState } from 'react';
import type { JoinHouseholdOutcome } from '../../server/HouseholdRequests.js';
import type { HouseholdJoinNotice } from './HouseholdJoinNotice.js';
import { householdJoinNoticeOf } from './HouseholdJoinNotice.js';
import shared from './SignInForm.module.css';
import styles from './HouseholdJoinScreen.module.css';

/** ロゴ（ログインの画面と同じ文字）。 */
const LOGO = 'fridge to meal';

/** 見出し。断りの案内に置き換わっても残す。 */
const HEADING = '冷蔵庫の共有に参加';

/** 送る前に、参加すると何が起きるかを告げる本文（FR-45 / ADR-087 決定5）。 */
const CONFIRM_SENTENCE =
  '招待された冷蔵庫を共有します。参加すると、あなたの冷蔵庫の食材・献立・履歴は消え、招待した人の冷蔵庫のものにそろいます。';

const JOIN_LABEL = '参加する';
const DECLINE_LABEL = '参加しない';
const CLOSE_LABEL = '閉じる';

/** 失敗の案内。操作を残し、操作の上に出す。原因を断定しない。 */
const UNAVAILABLE_NOTICE = 'いまは参加できませんでした。時間をおいてもう一度お試しください。';

/** 本文と操作を置き換える断りの案内。利用者に打ち手が無いので `閉じる` だけを残す。 */
const REJECTION_NOTICES: Record<Exclude<HouseholdJoinNotice, 'unavailable'>, string> = {
  invalidInvitation:
    'この招待リンクは使えません。リンクは1回だけ使え、24時間で切れます。招待した人に新しいリンクを作ってもらってください。',
  alreadyMember: 'すでにこの冷蔵庫を共有しています。',
};

/** 失敗の案内に添える記号。色だけで分けないための手がかりで、読み上げには出さない（NFR-17）。 */
const FAILURE_MARK = '!';

/**
 * class を在るものだけ空白で繋ぐ。`noUncheckedIndexedAccess` のもとで `styles.x` は
 * `string | undefined` であり、そのまま連結すると `"undefined"` が混ざる（先行 `SignInForm.tsx`）。
 */
const classOf = (...names: readonly (string | undefined)[]): string =>
  names.filter((name): name is string => name !== undefined).join(' ');

export type HouseholdJoinScreenProps = {
  /** 参加の実行。失敗は reject ではなく結末の値で返る（`server/HouseholdRequests.ts`）。 */
  onJoin: () => Promise<JoinHouseholdOutcome>;
  /** 参加しない */
  onDecline: () => void;
  /** 断られた案内を閉じる */
  onClose: () => void;
  /** 接続が切れているか。切れている間は `参加する` だけを止める（FR-41）。 */
  offline: boolean;
};

export function HouseholdJoinScreen({
  onJoin,
  onDecline,
  onClose,
  offline,
}: HouseholdJoinScreenProps) {
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<HouseholdJoinNotice | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // 断りなら本文と操作を置き換える案内、そうでなければ `null`。
  const rejection =
    notice === 'invalidInvitation' || notice === 'alreadyMember' ? REJECTION_NOTICES[notice] : null;
  const rejected = rejection !== null;

  // 断りで `参加する` が消えるので、焦点を `閉じる` に移す。
  useEffect(() => {
    if (rejected) closeButton.current?.focus();
  }, [rejected]);

  async function join() {
    setSending(true);
    setNotice(null); // 次に送ったら前の案内を消す
    try {
      // `joined` は何も出さない — 閉じるのは門である。
      setNotice(householdJoinNoticeOf(await onJoin()));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={classOf(shared.screen)}>
      <div className={classOf(shared.logo)}>{LOGO}</div>

      <div className={classOf(shared.form)}>
        {/* 門がタブの代わりにこの画面だけを描き、上位の見出しが無いので h1 にする。 */}
        <h1 className={classOf(shared.heading)}>{HEADING}</h1>

        {rejected ? (
          <>
            <p role="status" className={classOf(styles.sentence)}>
              {rejection}
            </p>
            {/* 手元で閉じるだけなので、接続が切れていても止めない。 */}
            <button
              ref={closeButton}
              type="button"
              onClick={onClose}
              className={classOf(shared.primary)}
            >
              {CLOSE_LABEL}
            </button>
          </>
        ) : (
          <>
            <p className={classOf(styles.sentence)}>{CONFIRM_SENTENCE}</p>

            {notice === 'unavailable' && (
              <p className={classOf(shared.notice, shared.noticeRejected)}>
                <span aria-hidden="true" className={classOf(shared.noticeMark)}>
                  {FAILURE_MARK}
                </span>
                <span role="status">{UNAVAILABLE_NOTICE}</span>
              </p>
            )}

            {/* 送っている間はどちらも効かない（二重送信と、結末の前に離れることを防ぐ）。 */}
            <button
              type="button"
              disabled={sending || offline}
              onClick={join}
              className={classOf(shared.primary)}
            >
              {JOIN_LABEL}
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={onDecline}
              className={classOf(shared.secondary)}
            >
              {DECLINE_LABEL}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
