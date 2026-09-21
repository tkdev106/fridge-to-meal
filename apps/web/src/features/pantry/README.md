# features/pantry

在庫コンテキストに対応する画面。`docs/screen-design.md` の第5章（在庫タブ）と
第6章（食材の登録・編集）がここに来る。

**一覧と登録の出し分けを持つのは `PantryTab.tsx` である**（B-39）。在庫タブの中身は一覧
（`PantryList`）か登録（`StockItemForm`）の**一方だけ**を木に置き、いまどちらを出しているかの
状態はここにある — 器（`navigation/TabbedScreen.tsx`）にも門（`App.tsx`）にも持たせない。門が
一覧を取り直しても開いている登録の画面は閉じず、別のタブを挟むと器が中身を外すので閉じる。
