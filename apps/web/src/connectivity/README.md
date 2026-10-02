# connectivity

**ここは画面ではない。** `features/` が画面の置き場であるのに対し、ここは接続状態の**継ぎ目**である
（先行 `session/`）。`navigator.onLine` と `online` / `offline` の出来事をこの背後に閉じ、
**門（`App.tsx`）が見るのは `Connectivity.ts` の型だけである**（B-70 / FR-41）。

| ファイル | 役割 |
| --- | --- |
| `Connectivity.ts` | 門が見る唯一の型。購読の始めに今の状態を1度渡し、以後は変わったときだけ渡す |
| `ConnectivityImpl.ts` | 窓の写し。窓は構造型 `ConnectivitySource` で受け、DOM の型を口に出さない |
| `OfflineBanner.tsx` | 帯。文言 `オフラインです` はここだけ（正は `docs/design/`。ADR-074） |
| `OfflineBanner.module.css` | 帯の見た目。値はトークンから引く（ADR-055） |

- **`new ConnectivityImpl(window)` を書くのは `main.tsx` だけ。** ここを import するのは
  `App.tsx` と `main.tsx` だけで、**`features/` は import しない** — 画面は門から `offline` の
  真偽1つを受け取る
- **検知できるのは「明らかに切れている」ことだけである。** `onLine` が真でも届かないことはあり、
  その回は既存の失敗の結末に落ちる（設計 規則2）
- **保留・再送も、復帰時の取り直しもしない**（ADR-016）。戻ったら止めた操作が押せるようになるだけ
- `ConnectivityImpl` は判断（初期値の読み・聞き手の付け外し）を持つので、偽の窓で単体テストを置く
  （`test/connectivity/`）。差し替えは `test/support/connectivity/FixedConnectivity.ts`
