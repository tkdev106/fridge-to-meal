/**
 * 設定画面（B-56c / B-56f / `docs/screen-design.md` 8章）。
 *
 * **操作は「閉じる」「ログアウト」「アカウントとデータの削除」の3つである**（B-56f 設計 規則11。
 * B-56c 設計 規則6 の「2つ」を置き換えた）。並びはこの順で、削除は確認の前は1操作だけである。
 *
 * **削除は確認を経なければ送られない**（FR-27 / 設計 規則4）。削除を押すと、取り消せないこと・
 * 在庫・献立・調理記録がすべて消えることを示す文と、確かめる操作・やめる操作の2つが削除の操作に
 * 置き換わる（並びは 閉じる → ログアウト → 確かめる → やめる）。確認は画面の中に描く —
 * `window.confirm` は描いて観察できず、確認のための依存も足さない。**確認を出しているかは
 * ここが持つ**（門は持たない。設定を閉じて開き直せば確認は出ていない。規則5）。
 *
 * **送っている間はすべての操作が効かない**（規則6）— 二重送信を防ぎ、結末が届く前に画面を
 * 離れて失敗の案内を失うことを防ぐ。消えた回のサインアウトは門が済ませる（規則7 / ADR-071
 * 結果2）。**失敗した回は確認を出したまま、原因を断定しない案内を1つ出す**（規則8）—
 * 自分では送り直さず、案内は次に送ったとき・やめたときに消える。
 *
 * ログアウトは既存の `SignOutButton` をそのまま使う（確認を出さない1操作。B-35 設計 規則11）。
 * 閉じるはログアウトを送っている間も効かせたままにする — サインアウトの結末は画面に届かない
 * ので（`Session.ts` 規則8）、閉じて捨てるものが無い（B-56c 設計 規則7）。
 *
 * 開いているかを持つのは門である（B-56c 設計 規則1 / ADR-066 と同じ理由）。ここはセッションの
 * 型を見ず、口を受け取るだけである（ADR-046 決定3）。
 *
 * **文言は仮である**（`docs/screen-design.md` 論点3）。
 */

import type { JSX } from 'react';
import { useState } from 'react';
import type { DeleteHouseholdDataOutcome } from '../../server/HouseholdDataRequests.js';
import { SignOutButton } from './SignOutButton.js';

/** 閉じる操作の名札（**仮**）。 */
const CLOSE_LABEL = '← 戻る';

/** 画面の見出し（**仮**）。 */
const SETTINGS_HEADING = '設定';

/** 削除の操作の名札（**仮**）。 */
const DELETE_LABEL = 'アカウントとデータの削除';

/** 確認の文（**仮**）。取り消せないことと、何が消えるかを示す（設計 規則4）。 */
const CONFIRM_NOTICE =
  'アカウントと、在庫・献立・調理記録のデータがすべて消えます。この操作は取り消せません。';

/** 確かめる操作の名札（**仮**）。 */
const CONFIRM_LABEL = '削除する';

/** やめる操作の名札（**仮**）。 */
const CANCEL_LABEL = 'やめる';

/** 失敗の案内（**仮**）。原因を断定しない（設計 規則8）。 */
const DELETE_FAILURE_NOTICE = 'いまは削除できませんでした。時間をおいてもう一度お試しください。';

export type SettingsScreenProps = {
  /** サインアウトの実行。SignOutButton へ素通しする（Session.ts 規則8）。 */
  onSignOut: () => Promise<void>;
  /** 設定を閉じて履歴の一覧へ戻る。 */
  onClose: () => void;
  /** 削除を送る。消えた回のサインアウトは門が済ませてから解決する（B-56f 設計 5章）。 */
  onDeleteHouseholdData: () => Promise<DeleteHouseholdDataOutcome>;
  /** 接続が切れているか（B-70 / FR-41）。省略は `false`。 */
  offline?: boolean;
};

export function SettingsScreen({
  onSignOut,
  onClose,
  onDeleteHouseholdData,
  offline = false,
}: SettingsScreenProps): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirmDeletion() {
    // **接続が切れている間は確定を止める**（B-70 規則12）。確認を開く・やめるは止めない。
    if (deleting || offline) return;

    setDeleting(true);
    setFailed(false);
    try {
      const { outcome } = await onDeleteHouseholdData();
      // 消えた回は門がサインアウトを済ませており、この画面はもう出ていない（規則7）。
      setFailed(outcome === 'failed');
    } finally {
      setDeleting(false);
    }
  }

  function cancelDeletion() {
    setConfirming(false);
    setFailed(false);
  }

  return (
    <div>
      <button type="button" disabled={deleting} onClick={onClose}>
        {CLOSE_LABEL}
      </button>
      <h2>{SETTINGS_HEADING}</h2>
      <SignOutButton onSignOut={onSignOut} disabled={deleting} />
      {confirming ? (
        <div>
          <p>{CONFIRM_NOTICE}</p>
          <button type="button" disabled={deleting || offline} onClick={confirmDeletion}>
            {CONFIRM_LABEL}
          </button>
          <button type="button" disabled={deleting} onClick={cancelDeletion}>
            {CANCEL_LABEL}
          </button>
          {failed && <p role="status">{DELETE_FAILURE_NOTICE}</p>}
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>
          {DELETE_LABEL}
        </button>
      )}
    </div>
  );
}
