# session

**ここは画面ではない。** `features/` が画面の置き場であるのに対し、ここはセッションの**継ぎ目**である。
ADR-046 決定3 の言うとおり、**腐敗防止層（ADR-005）と同じ置き方を web の中でもう一度した**ものである。

**層を1つ増やしたのではない。** `docs/adr.md` A章 の表は `apps/web/` をまとめてプレゼンテーション層に
対応づけ、**その表以外の対応を作らないこと**と定めている。ここもその内側であり、外向きの依存
（`apps/api` を import しない）は先行と変わらない。

アクセストークンの取得・保持・更新・破棄をこの背後に閉じ、**画面は `@supabase/supabase-js` の型を
1つも見ない。** 画面が見るのは `Session.ts` の型だけである。

`features/` の下に置かないのは、継ぎ目が特定の画面のものではないためである — 在庫（B-22 / B-24）も
献立も、サーバを叩くときはここからトークンを受け取る。

| ファイル | 役割 |
| --- | --- |
| `Session.ts` | 画面が見る唯一の型。実装もライブラリも知らない |
| `SessionConfig.ts` | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` の読み取り |
| `SignUpOutcomes.ts` | サインアップの断りを種別に読み分ける判断（B-73 / ADR-081）。supabase-js を import せず、`pnpm test` で観察する |
| `SessionImpl.ts` | supabase-js への薄い写し。**単体テストを置かない** |

**`SessionImpl` に単体テストを置かないのは意図である。** 差し替える相手が継ぎ目ではなく
supabase-js の側になるため、本物の外部に出る部分は `pnpm test` で観察しない（`docs/testing.md` 5章）。
`HouseholdAuthenticatorImpl` がテストを持つのは、あちらに観察する**判断**があるからで
（`kid` の選び方・鍵の保持・失敗した取得の捨て方）、こちらは委譲しかない。
**判断が増えたら**（再試行・失敗の種別分け・独自の期限管理）、その周で内側の口を起こすか決め直す。
**B-73 でサインアップの断りの種別分けが増えた**ので、判断は純粋関数 `SignUpOutcomes.ts` に起こし、
`SessionImpl` は詰め替えて渡すだけにした（ADR-081）。

**`apps/web/src/session/` の外から `@supabase/*` を import しない。** `pnpm lint:deps` が
`webの画面はsupabaseを直接importしない` で機械的に断る（`CLAUDE.md` の依存ルールの表と1対1）。

設定の値は `apps/web/.env.local` に置く（Vite の既定。`.gitignore` の `.env.*` で git 管理外）。
**`VITE_` の付いたものはビルド時にバンドルへ焼き込まれる** — anon key は公開される前提の鍵であり、
RLS が守る（ADR-046 決定4）。`apps/api/.dev.vars` は**サーバ専用**で、こちらの値を足さない。
