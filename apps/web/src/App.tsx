/**
 * 画面の骨組みはこれから。構造は `docs/screen-design.md` に定めてある。
 * 下タブ3つ（献立 / 在庫 / 履歴）で、起動時にどれを開くかは判断待ち（同書 論点1）。
 *
 * **文言と配色は決まっていない**（同書 冒頭）。ここに書く日本語も仮である。
 *
 * **ここは門である**（ADR-046 結果4 / B-35 設計 6章 規則1・2）。`Session.subscribe` の3値で
 * 「何も出さない／ログイン／今の画面」を出し分ける。セッションは props で受け取り、
 * 実装を `new` するのは `main.tsx` だけ（規則3）。
 */
import { useEffect, useState } from 'react';
import { SignInForm } from './features/identity/SignInForm.js';
import { SignOutButton } from './features/identity/SignOutButton.js';
import { PantryList } from './features/pantry/PantryList.js';
import { StockItemForm } from './features/pantry/StockItemForm.js';
import { todayOf } from './features/pantry/RemainingDays.js';
import type { Session, SessionState } from './session/Session.js';

/**
 * 登録の実行。**サーバへ送る手段がまだ無いことを表して必ず断る**（B-12 設計 10章）。
 *
 * 解決させると、保存できていないのに保存できたように見える。偽の成功を出さないための形であり、
 * `POST /stock-items` を叩く層を置く B-24 まで続く（未完成は隠さない — CLAUDE.md）。
 */
function registerStockItem(): Promise<void> {
  return Promise.reject(new Error('在庫の登録をサーバへ送る経路はまだありません（B-24）'));
}

export type AppProps = {
  /** セッションの継ぎ目。画面はこの型だけを見る（ADR-046 決定3）。 */
  session: Session;
};

export function App({ session }: AppProps) {
  // 購読を始めた時点の状態は subscribe が1度目に渡す（`Session.ts` 規則5）ので、
  // ここで先に決めない。最初の描画は購読が始まるまでの一瞬だけ 'unknown' でよい。
  const [state, setState] = useState<SessionState>('unknown');

  // 購読は1本。`session` が同じなら張り替えず、外れるとき戻り値で解除する（規則2）。
  useEffect(() => session.subscribe(setState), [session]);

  // **`'unknown'` をログイン画面に倒さない**（規則1 / `Session.ts` 規則6）。保存されたセッションの
  // 復元は非同期で、倒すとサインイン済みの利用者にログイン画面が一瞬見える。
  if (state === 'unknown') return null;

  if (state === 'signedOut') {
    return (
      <main>
        <SignInForm
          onSignIn={(email, password) => session.signIn(email, password)}
          onSignUp={(email, password) => session.signUp(email, password)}
        />
      </main>
    );
  }

  // 在庫品は当面0件を渡す。サーバからの取得はまだ無い（B-22）ので、出るのは0件の案内である。
  // 遷移がまだ無いので、登録の画面は一覧の下に並べて置く（B-12 設計 10章）。
  // ログアウトはさらにその下（規則11。暫定 — 設定画面ができたら移す。ADR-046 結果4）。
  return (
    <main>
      <PantryList stockItems={[]} today={todayOf(new Date())} />
      <StockItemForm onRegister={registerStockItem} />
      <SignOutButton onSignOut={() => session.signOut()} />
    </main>
  );
}
