/**
 * ログアウトの操作（B-35 設計 4章 / 6章 規則11）。
 *
 * **確認を出さない1操作である。** `signOut()` の解決を待たずに、門が `'signedOut'` を受けて
 * 画面を切り替える（`Session.ts` 規則8 — 手元のセッションは必ず捨てられる）。押している間だけ
 * 効かせない。
 *
 * **置き場所は設定画面である**（`SettingsScreen.tsx` / B-56c / `docs/screen-design.md` 2.1・8章）。
 * 入口は履歴タブの右上にあり、ADR-046 結果4 の「暫定」（在庫タブの下）は解けた。
 */

import { useState } from 'react';

/** 操作の名札。仮の文言である（`docs/screen-design.md` 論点3）。 */
const SIGN_OUT_LABEL = 'ログアウト';

export type SignOutButtonProps = {
  /** サインアウトの実行。サーバ側の失敗は画面に届かない（`Session.ts` 規則8）。 */
  onSignOut: () => Promise<void>;
};

export function SignOutButton({ onSignOut }: SignOutButtonProps) {
  const [sending, setSending] = useState(false);

  async function signOut() {
    if (sending) return;

    setSending(true);
    try {
      await onSignOut();
    } finally {
      setSending(false);
    }
  }

  return (
    <button type="button" disabled={sending} onClick={signOut}>
      {SIGN_OUT_LABEL}
    </button>
  );
}
