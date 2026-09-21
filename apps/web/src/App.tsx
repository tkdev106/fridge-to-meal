/**
 * 画面の骨組み。構造は `docs/screen-design.md` に定めてある。
 * 下タブ3つ（献立 / 在庫 / 履歴）の器は `navigation/TabbedScreen.tsx` にあり、門は
 * **3つの中身を組み立てて渡すだけ**である（B-38 設計 10章）。起動時に開くのは在庫タブで
 * （要件 第7章）、献立を既定にするかは `判断待ち` のまま（同書 論点1）。
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
import { HistoryTab } from './features/meal/HistoryTab.js';
import { MealsTab } from './features/meal/MealsTab.js';
import { deleteFailureNoticeOf } from './features/pantry/DeleteFailureNotice.js';
import { PantryList } from './features/pantry/PantryList.js';
import type { PantryListState } from './features/pantry/PantryList.js';
import { StockItemForm } from './features/pantry/StockItemForm.js';
import { todayOf } from './features/pantry/RemainingDays.js';
import { TabbedScreen } from './navigation/TabbedScreen.js';
import type { Session, SessionState } from './session/Session.js';
import type {
  DeleteStockItem,
  ListStockItems,
  RegisterStockItem,
} from './server/StockItemRequests.js';

export type AppProps = {
  /** セッションの継ぎ目。画面はこの型だけを見る（ADR-046 決定3）。 */
  session: Session;
  /**
   * 在庫一覧を取りに行く口（B-22 設計 5章）。**組み立てるのは `main.tsx` だけ**であり、
   * 門は呼ぶだけで、基点も `fetch` もトークンの取り出し方も知らない。
   */
  listStockItems: ListStockItems;
  /** 在庫を登録しに行く口（B-24）。組み立てるのはやはり `main.tsx` だけである。 */
  registerStockItem: RegisterStockItem;
  /** 在庫を削除しに行く口（B-23）。同じく組み立てるのは `main.tsx` だけである。 */
  deleteStockItem: DeleteStockItem;
};

export function App({ session, listStockItems, registerStockItem, deleteStockItem }: AppProps) {
  // 購読を始めた時点の状態は subscribe が1度目に渡す（`Session.ts` 規則5）ので、
  // ここで先に決めない。最初の描画は購読が始まるまでの一瞬だけ 'unknown' でよい。
  const [state, setState] = useState<SessionState>('unknown');

  // 在庫は取りに行くまで「読み込み中」である。**0件を初期値にしない**（B-22 設計 7章）—
  // 在庫があるのに無いように見せてしまう。
  const [stockItems, setStockItems] = useState<PantryListState>({ outcome: 'loading' });

  // 一覧を取り直した回数。登録が通るたび（B-24）と、消えたと読めるたび（B-23）に1つ増やし、
  // 下の効果をもう1度走らせる。
  const [reloadCount, setReloadCount] = useState(0);

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
  }, [state, listStockItems, reloadCount]);

  /**
   * 登録が通ったら一覧を取り直す（FR-01 / FR-04 / B-24）。
   *
   * **登録した在庫品を web で列に足さない。** 並び（期限の近い順）を決めるのはサーバであり
   * （B-22 設計 規則3）、足すと帯の中の位置を web が決めることになる。継ぎ目が成功に
   * 在庫品を載せていないのもこのためである。
   *
   * 結末はそのまま画面へ返す — 断りの文言を選ぶのは `StockItemForm` の側である（ADR-032 決定3）。
   */
  const registerAndReload: RegisterStockItem = async (input) => {
    const outcome = await registerStockItem(input);
    if (outcome.outcome === 'registered') setReloadCount((count) => count + 1);

    return outcome;
  };

  /**
   * **消えたと読めたら一覧を取り直す**（FR-06 / B-23 / ADR-050）。
   *
   * 読みは `deleteFailureNoticeOf` の1つだけを使う — 案内を出すかどうかを決めるのと
   * **同じ関数**であり（`DeleteFailureNotice.ts`）、2か所に判断を置くと「案内は出さないのに
   * 一覧は古いまま」のような食い違いが生まれる。`null` は「思ったとおりになった」を表す。
   *
   * **web で列から行を抜かない。** 登録と同じ理由で、並び（期限の近い順）を決めるのは
   * サーバである（B-22 設計 規則3 / B-24）。**取り直しは読みの検めでもある** — 404 を
   * 「すでに消えている」と読んだ回も、消えていなければ行がそのまま戻ってくる。
   *
   * **消せなかった回は取り直さない。** 一覧は変わっておらず、往復を1つ無駄にするうえ、
   * その取得も失敗すれば断りが一覧全体の断りに置き換わってしまう（`PantryList`）。
   */
  const deleteAndReload: DeleteStockItem = async (id) => {
    const outcome = await deleteStockItem(id);
    if (deleteFailureNoticeOf(outcome) === null) setReloadCount((count) => count + 1);

    return outcome;
  };

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

  // **器を mount するのはこの枝だけである**（B-38 設計 6章 規則9）。サインアウトを挟んで
  // 入り直すと器ごと作り直され、開くのは既定のタブに戻る（2.3 の `login --> pantry`）。
  //
  // **在庫を取りに行く効果は門に残したままである**（同 規則11 / B-22 設計 規則10）。タブを
  // 移っても上の効果は走り直さず、取れていた在庫も失敗の結末もそのまま保たれる —
  // 取り直すのは登録が通った回（B-24）と、消えたと読めた回（B-23）だけである。
  //
  // 在庫はサーバから取った結末をそのまま渡す（B-22）。並べ替えも帯分けも `PantryList` の側の
  // 純粋関数が行う。
  // 登録の画面を一覧の下に並べて置くのは今までどおり（B-12 設計 10章。独立した画面にするのは B-39）。
  // ログアウトはさらにその下（暫定 — 設定画面ができたら移す。ADR-046 結果4）。
  //
  // 献立タブと履歴タブは**中身が無いまま出す**（同 規則7。feature flag を置かない）。
  return (
    <main>
      <TabbedScreen
        meals={<MealsTab />}
        pantry={
          <>
            <PantryList
              stockItems={stockItems}
              today={todayOf(new Date())}
              onDelete={deleteAndReload}
            />
            <StockItemForm onRegister={registerAndReload} />
            <SignOutButton onSignOut={() => session.signOut()} />
          </>
        }
        history={<HistoryTab />}
      />
    </main>
  );
}
