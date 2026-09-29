/**
 * 設定画面（B-56c / `docs/screen-design.md` 8章）。
 *
 * **操作は「閉じる」と「ログアウト」の2つだけである**（B-56c 設計 規則6）。閉じるを先、
 * ログアウトを後に置く。**アカウントとデータの削除（FR-27）はまだ置かない** — 押しても呼べない
 * 操作も、打ち手の無い予告の文も出さない（B-56f。依存 B-56d / ADR-071）。
 *
 * ログアウトは既存の `SignOutButton` をそのまま使う（確認を出さない1操作。B-35 設計 規則11）。
 * 閉じるはログアウトを送っている間も効かせたままにする — サインアウトの結末は画面に届かない
 * ので（`Session.ts` 規則8）、閉じて捨てるものが無い（B-56c 設計 規則7）。
 *
 * 開いているかを持つのは門である（B-56c 設計 規則1 / ADR-066 と同じ理由）。ここはセッションの
 * 型を見ず、口を2つ受け取るだけである（ADR-046 決定3）。
 *
 * **文言は仮である**（`docs/screen-design.md` 論点3）。
 */

import type { JSX } from 'react';
import { SignOutButton } from './SignOutButton.js';

/** 閉じる操作の名札（**仮**）。 */
const CLOSE_LABEL = '← 戻る';

/** 画面の見出し（**仮**）。 */
const SETTINGS_HEADING = '設定';

export type SettingsScreenProps = {
  /** サインアウトの実行。SignOutButton へ素通しする（Session.ts 規則8）。 */
  onSignOut: () => Promise<void>;
  /** 設定を閉じて履歴の一覧へ戻る。 */
  onClose: () => void;
};

export function SettingsScreen({ onSignOut, onClose }: SettingsScreenProps): JSX.Element {
  return (
    <div>
      <button type="button" onClick={onClose}>
        {CLOSE_LABEL}
      </button>
      <h2>{SETTINGS_HEADING}</h2>
      <SignOutButton onSignOut={onSignOut} />
    </div>
  );
}
