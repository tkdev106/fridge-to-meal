# householdInvitation

招待リンクで開いたときのトークンを、ログインやアカウント作成をまたいで持ち越す継ぎ目（B-77 / ADR-087 決定4）。

- `PendingHouseholdInvitation` — 画面と門が見る型。読み・書き・消しの3つで、例外を投げない
- `PendingHouseholdInvitationImpl` — `localStorage` に置く実装。`new` するのは `main.tsx` だけ

`localStorage` に触るのはここだけである。
