# features/identity

世帯コンテキストに対応する画面。`docs/screen-design.md` の第8章（設定・認証）の
「ログイン／サインアップ」と、設定画面（`SettingsScreen`。B-56c）がここに来る。設定画面の操作は
閉じる・ログアウト・アカウントとデータの削除（FR-27。B-56f）の3つで、削除は画面の中の確認を経て
`DELETE /household-data` に届き、通ったら門がサインアウトする。
入口は履歴タブの右上にあり、開いているかは門（`App.tsx`）が持つ。
