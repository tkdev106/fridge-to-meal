# backNavigation

**ここは画面ではない。** `features/` が画面の置き場であるのに対し、ここは端末の「戻る」
（Android Chrome の戻るジェスチャー・ブラウザの戻る）の**継ぎ目**である（先行 `connectivity/`）。
`window.history` と `popstate` をこの背後に閉じ、**画面が見るのは `BackHandler.tsx` の hook だけである**
（B-75 / ADR-084）。

| ファイル | 役割 |
| --- | --- |
| `BackNavigation.ts` | 口の型。開いたものの口を格（`'screen'` / `'tab'`）つきで登録し、戻り値で外す |
| `BackNavigationImpl.ts` | 履歴の項目の出し入れと `popstate` の受け取り。窓は構造型 `BackNavigationSource` で受け、DOM の型を口に出さない |
| `BackHandler.tsx` | context・provider・`useBackHandler`。`features/` が import してよいのはこのファイルだけ |

- **`new BackNavigationImpl(window)` を書くのは `main.tsx` だけ。** `main.tsx` が provider で `App` を
  包む。`BackNavigation.ts` と `BackNavigationImpl.ts` を import するのは `main.tsx` と
  `BackHandler.tsx` だけで、**`features/` と `App.tsx` は hook だけを引く**
- **`window.history` に触るのはここだけである。** 画面は履歴を直接操作しない
- **URL を渡さない。** `pushState` の第3引数を渡さず、画面の状態を URL にもハッシュにも `localStorage` にも
  書かない（ADR-066 結果1 / ADR-084）。例外は構築時の1回だけで、読み込み時の URL にクエリ（招待リンクの
  `?invite=`）があれば `replaceState` で外す（state とハッシュは保ち、項目は増やさない。ADR-088）。項目の state に深さの印 `{ fridgeToMealBack: 深さ }` を持たせるだけで、
  再読み込みは既定の画面から始まる（読み込み時に印つきの項目に居れば、印の無い項目まで戻る）
- **開いているものの数だけ項目を積み、戻る1回で最後に開いたもの1つを閉じる。** `'tab'` の口は
  `'screen'` の口がすべて無いときにだけ呼ぶ。何も開いていない献立タブ・ログインの画面・
  冷蔵庫の共有に参加の確認では何も積まず、戻るはアプリを離れる（ADR-088）
- **口は見えている間だけ登録する。** 送っている間に戻るを飲み込むのは口の中身の仕事であり、
  登録は外さない（外すと、その間の戻るがアプリを離れる）。飲み込んだ回は項目を1つ積み直す
- **進むでは開き直さない。** 口を呼ばず、開いている数の深さへ揃え直す
- **provider の無い木では `useBackHandler` は何もしない** — 画面のテストは包まずに描ける
- `BackNavigationImpl` は判断（積む数の揃え方・読み流す `popstate`）を持つので、偽の窓で単体テストを
  置く（`test/backNavigation/`）。差し替えは `test/support/backNavigation/FixedBackNavigation.ts`
- **Android Chrome は利用者の操作なしに積まれた項目を戻るで飛ばすことがある**ため、積むのは
  開いた直後だけにしている。jsdom では確かめられず、実機（standalone の PWA と Chrome のタブ）で確かめる
