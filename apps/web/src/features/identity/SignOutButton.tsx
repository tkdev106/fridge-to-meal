/**
 * ログアウトの操作（B-35 設計 4章 / 6章 規則11）。
 *
 * **確認を出さない1操作である。** `signOut()` の解決を待たずに、門が `'signedOut'` を受けて
 * 画面を切り替える（`Session.ts` 規則8 — 手元のセッションは必ず捨てられる）。押している間だけ
 * 効かせない。
 *
 * **置き場所は設定画面である**（`SettingsScreen.tsx` / B-56c / `docs/screen-design.md` 2.1・8章）。
 * 入口は SP では3つのタブの見出しの歯車、PC ではサイドナビの下端の「設定」にあり（B-60）、
 * ADR-046 結果4 の「暫定」
 * （在庫タブの下）は解けた。
 */

import { useState } from 'react';

/** 操作の名札（原本 `docs/design/src/index.dc.html` 13。ADR-074 決定1 — デザインが正）。 */
const SIGN_OUT_LABEL = 'ログアウト';

export type SignOutButtonProps = {
  /** サインアウトの実行。サーバ側の失敗は画面に届かない（`Session.ts` 規則8）。 */
  onSignOut: () => Promise<void>;
  /**
   * 外から効かせない（B-56f 設計 規則6）。設定画面が削除を送っている間に渡す — 結末が届く前に
   * サインアウトすると、失敗の案内を出す相手が居なくなる。
   */
  disabled?: boolean;
  /** 置き場（設定画面）の見た目（B-67 規則13）。省略時は class を当てない。 */
  className?: string | undefined;
};

export function SignOutButton({ onSignOut, disabled = false, className }: SignOutButtonProps) {
  const [sending, setSending] = useState(false);

  async function signOut() {
    if (sending || disabled) return;

    setSending(true);
    try {
      await onSignOut();
    } finally {
      setSending(false);
    }
  }

  return (
    <button type="button" className={className} disabled={sending || disabled} onClick={signOut}>
      {SIGN_OUT_LABEL}
    </button>
  );
}
