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
import type { PantryListState } from './features/pantry/PantryList.js';
import { StockItemForm } from './features/pantry/StockItemForm.js';
import { todayOf } from './features/pantry/RemainingDays.js';
import type { Session, SessionState } from './session/Session.js';
import type { ListStockItems } from './server/StockItemRequests.js';

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
  /**
   * 在庫一覧を取りに行く口（B-22 設計 5章）。**組み立てるのは `main.tsx` だけ**であり、
   * 門は呼ぶだけで、基点も `fetch` もトークンの取り出し方も知らない。
   */
  listStockItems: ListStockItems;
};

export function App({ session, listStockItems }: AppProps) {
  // 購読を始めた時点の状態は subscribe が1度目に渡す（`Session.ts` 規則5）ので、
  // ここで先に決めない。最初の描画は購読が始まるまでの一瞬だけ 'unknown' でよい。
  const [state, setState] = useState<SessionState>('unknown');

  // 在庫は取りに行くまで「読み込み中」である。**0件を初期値にしない**（B-22 設計 7章）—
  // 在庫があるのに無いように見せてしまう。
  const [stockItems, setStockItems] = useState<PantryListState>({ outcome: 'loading' });

  // 購読は1本。`session` が同じなら張り替えず、外れるとき戻り値で解除する（規則2）。
  useEffect(() => session.subscribe(setState), [session]);

  // 取りに行くのは**サインイン済みのときだけ1度**（B-22 設計 規則10）。サインアウトしている間は
  // 叩いても 401 が返るだけで、往復を1つ無駄にする。
  //
  // **効果が解除されたら結果を捨てる**（同 規則10）。StrictMode の二重呼び出しと、
  // サインアウトが割り込んだ場合に、古い結果を画面に置かないため。
  //
  // **自動で取りに行き直さない。** 継ぎ目は例外を投げず結末で返す（同 規則9）ので、
  // ここに `catch` は要らない。
  useEffect(() => {
    if (state !== 'signedIn') return;

    let active = true;
    setStockItems({ outcome: 'loading' });

    void listStockItems().then((outcome) => {
      if (active) setStockItems(outcome);
    });

    return () => {
      active = false;
    };
  }, [state, listStockItems]);

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

  // 在庫はサーバから取った結末をそのまま渡す（B-22）。並べ替えも帯分けも `PantryList` の側の
  // 純粋関数が行う。
  // 遷移がまだ無いので、登録の画面は一覧の下に並べて置く（B-12 設計 10章）。
  // ログアウトはさらにその下（規則11。暫定 — 設定画面ができたら移す。ADR-046 結果4）。
  return (
    <main>
      <PantryList stockItems={stockItems} today={todayOf(new Date())} />
      <StockItemForm onRegister={registerStockItem} />
      <SignOutButton onSignOut={() => session.signOut()} />
    </main>
  );
}
