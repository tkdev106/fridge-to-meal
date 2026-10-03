/**
 * 設定画面（B-56c / B-56f / `docs/screen-design.md` 8章）。
 *
 * **操作は「戻る」「ログアウト」「アカウントとデータを削除」の3つである**（B-56f 設計 規則11。
 * B-56c 設計 規則6 の「2つ」を置き換えた）。並びはこの順で、削除は確認の前は1操作だけである。
 *
 * **削除は確認を経なければ送られない**（FR-27 / 設計 規則4）。削除を押すと、何が消えるかを問う文と、
 * `削除する`・`やめる` の2つの操作が削除の操作に置き換わる（並びは 戻る → ログアウト → 削除する →
 * やめる）。文から「取り消せない」は消えたが、確認を必須にすることは変えない（B-67 規則16）。確認は画面の中に描く —
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
 * 開いているかを持つのは門である（B-56c 設計 規則1 / ADR-066 と同じ理由）。**設定はタブの外の
 * 4つ目の行き先であり**、門が組んだこの画面を器（`TabbedScreen`）が選んでいたタブの中身の
 * 代わりに描く（B-60 設計 6章 規則7）。入口は SP では3つのタブの見出しの歯車、PC ではサイドナビの
 * 下端の「設定」である（同 規則4・12）。どのタブを押しても閉じる（同 規則8）— ただし削除を
 * 送っている間は門が帯を止めるので、タブからは閉じない（B-60b 規則1）。ここはセッションの
 * 型を見ず、口を受け取るだけである（ADR-046 決定3）。
 *
 * **見た目と文言はデザイン 13 / 13b に揃えた**（B-67。値は `SettingsScreen.module.css`）。
 * 題 `設定` の `h1` の下に、帯 `アカウント`（ログアウトの行）と帯 `データ`（削除の操作と確認）を
 * 見出し `h2` で置く — 帯は操作ではない（B-67 規則12・18。原本の帯は `div` だが、題 `h1` の下の区分として読み上げで辿れるよう `h2` にした）。文言はデザインが正で
 * ある（ADR-074 決定1）。削除の失敗の案内だけはデザインに無く暫定である。
 */

import type { JSX } from 'react';
import { useState } from 'react';
import type { DeleteHouseholdDataOutcome } from '../../server/HouseholdDataRequests.js';
import { Icon } from '../../icons/Icon.js';
import { SignOutButton } from './SignOutButton.js';
import styles from './SettingsScreen.module.css';
import { useBackHandler } from '../../backNavigation/BackHandler.js';

/*
 * 文言は原本 `docs/design/src/index.dc.html` 13 / 13b から取った（ADR-074 決定1 — デザインが正）。
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

/** 削除の置き場の上の帯。 */
const DATA_BAND = 'データ';

/** 削除の操作の名札。 */
const DELETE_LABEL = 'アカウントとデータを削除';

/** 確認の文。何が消えるかを問う（B-67 規則15・16）。 */
const CONFIRM_NOTICE = 'アカウントと、冷蔵庫の食材・履歴をすべて削除しますか';

/** 確認の中で削除を送る操作の名札。 */
const CONFIRM_LABEL = '削除する';

/** やめる操作の名札。 */
const CANCEL_LABEL = 'やめる';

/** 失敗の案内（**暫定** — デザインに無い）。原因を断定しない（設計 規則8）。 */
const DELETE_FAILURE_NOTICE = 'いまは削除できませんでした。時間をおいてもう一度お試しください。';

export type SettingsScreenProps = {
  /** サインアウトの実行。SignOutButton へ素通しする（Session.ts 規則8）。 */
  onSignOut: () => Promise<void>;
  /** 設定を閉じて、開く前に選んでいたタブへ戻る（B-60 規則9）。 */
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

  // 端末の戻るは、確認を出していれば確認を、そうでなければ設定を閉じる（B-75 規則1・2）。
  // 確認の口は確認を出すたびに後から登録されるので、設定の口より先に呼ばれる。
  // **削除を送っている間はどちらも飲み込む**（規則6）— 閉じると失敗の案内を失う。
  useBackHandler(true, () => {
    if (!deleting) onClose();
  });
  useBackHandler(confirming, () => {
    if (!deleting) cancelDeletion();
  });

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
    <div className={styles.screen}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.back}
          aria-label={CLOSE_LABEL}
          disabled={deleting}
          onClick={onClose}
        >
          <Icon name="back" size={24} />
        </button>
        <h1 className={styles.title}>{SETTINGS_HEADING}</h1>
      </div>
      <h2 className={styles.band}>{ACCOUNT_BAND}</h2>
      <SignOutButton onSignOut={onSignOut} disabled={deleting} className={styles.signOut} />
      <h2 className={`${styles.band} ${styles.bandSpaced}`}>{DATA_BAND}</h2>
      <div className={styles.dataArea}>
        {confirming ? (
          <div className={styles.confirmation}>
            <p className={styles.confirmSentence}>{CONFIRM_NOTICE}</p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirm}
                disabled={deleting || offline}
                onClick={confirmDeletion}
              >
                {CONFIRM_LABEL}
              </button>
              <button
                type="button"
                className={styles.cancel}
                disabled={deleting}
                onClick={cancelDeletion}
              >
                {CANCEL_LABEL}
              </button>
            </div>
            {failed && (
              <p role="status" className={styles.failure}>
                {DELETE_FAILURE_NOTICE}
              </p>
            )}
          </div>
        ) : (
          <button type="button" className={styles.delete} onClick={() => setConfirming(true)}>
            {DELETE_LABEL}
          </button>
        )}
      </div>
    </div>
  );
}
