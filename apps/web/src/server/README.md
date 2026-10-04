# server

**ここは画面ではない。** `features/` が画面の置き場であるのに対し、ここは `apps/api` への
**経路の継ぎ目**である。`session/` がアクセストークンの出入りを1か所に閉じたのと同じ置き方を、
サーバへの往復についてもう一度したものである（ADR-046 決定3 / `session/README.md`）。

**層を1つ増やしたのではない。** `docs/adr.md` A章 の表は `apps/web/` をまとめてプレゼンテーション層に
対応づけ、**その表以外の対応を作らないこと**と定めている。ここもその内側であり、外向きの依存
（`apps/api` の中身を import しない）は先行と変わらない。import してよいのは
`@fridge-to-meal/contract` の型だけである。

## `api/` と名づけない理由

**`api 層` はサーバ側の層の名である**（`apps/api/src/contexts/*/api/`）。同じ語を web の中で
もう一度使うと、「api 層」と言ったときにどちらを指すのか読めなくなる — `CLAUDE.md` が
「ドメイン」の2つの意味に注意を促しているのと同じ種類の曖昧性を、こちらでは**名前の側で避ける**
（B-22 設計 規則1）。ここに置くのは層ではなく、**相手（サーバ）への出口**である。

`features/` の下に置かないのも `session/` と同じ理由で、継ぎ目が特定の画面のものではないためである —
在庫（B-22 / B-24 / B-23）も献立も、サーバを叩くときはここを通る。

| ファイル | 役割 |
| --- | --- |
| `HttpFetch.ts` | 差し替える出口と、その要求・応答の**構造型**。`Response` も `Request` も `fetch` も型として口に出さない |
| `ApiBaseUrl.ts` | `VITE_API_BASE_URL` の読み取りと正規化 |
| `StockItemRequests.ts` | 在庫の要求を組む工場と、読み込み・登録・削除の結末 |
| `SuggestionRequests.ts` | 保存済みの提案を取りに行く工場と、その結末 |
| `IngredientNameRequests.ts` | 補完の元になる食材名を取りに行く工場と、その結末 |
| `MealRequests.ts` | 献立1件・調理記録・献立の履歴の要求を組む工場と、その結末 |
| `HouseholdDataRequests.ts` | 世帯のデータ（と利用者）を消す工場と、その結末（消えた／失敗の2つ。`rule` を運ばない） |
| `HouseholdRequests.ts` | 世帯の人数を取りに行く・招待を作る・世帯を抜ける3つの工場と、その結末（それぞれ読み込めた・作れた・抜けた／失敗の2つ。`rule` を運ばない） |

## ここで守ること

- **`@supabase/*` を1つも import しない。** `session/` の型（`Session`）も import しない —
  トークンは `accessToken: () => Promise<string | null>` の1引数で受け取る。組み合わせるのは
  `main.tsx` だけである（B-22 設計 規則1 / 9章）
- **`Response` / `Request` / `Context` / `fetch` の型を書かない。** `apps/web/test` は
  `types: []` / `lib: ES2022` で DOM の型を持たないため、差し替える出口は構造型（`HttpResponse` /
  `HttpFetch`）で表す。先行は `HouseholdAuthenticatorImpl` の `JwksResponse` / `FetchJwks`
- **DTO を詰め替えない。並べ替えない。** 画面は `@fridge-to-meal/contract` の DTO をそのまま
  受け取る（B-22 設計 規則2・3）。変換を足すと web が第2の DTO を持ち、サーバの並び
  （期限の近い順）を web が握り直すことになる
- **世帯を運ぶ引数を足さない**（C-9）。経路にもクエリにも本体にも載せず、サーバが
  アクセストークンから定める。web は世帯を1つも持たない
- **どの口も例外を外に出さない。** 通信の失敗も読めない本体も結末に畳む（B-22 設計 規則9）。
  外へ出すと `App.tsx` の効果で誰も受け止めず、読み込み中のまま画面が止まる（FR-41）
- **畳み方は口ごとに決める。** 取得は断りの応答まで `failed` の1つに畳むが、**登録は断りの
  `rule` を `rejected` の結末に載せる**（B-24 / ADR-032 決定3）— 登録には利用者が入力を直せば
  通る断りがあり（`name.empty` / `expiryDate.*`）、畳むとそれを伝えられない。
  **削除も `rule` を載せる**（B-23 / ADR-050）— こちらに直せる入力は無いが、
  **`delete.notFound` を「すでに消えている」と読む判断が画面にある**（ADR-027 が後続へ送った
  宿題）。畳むと、その読み分けの材料がここで失われる
- **`rule` から文言を選ばない。** 運ぶのは値だけで、どれを「直せる誤り」と読むかも、どんな
  文言を出すかも画面の判断である（`features/pantry/RegisterFailureNotice.ts`）。**ここは画面
  ではないので、画面の都合でこの層が動かないようにする。** `rule` の列挙もここには置かない —
  どの値が来るかは api 層の写像（`RuleViolationStatus.ts`）が正であり、2か所に持つとずれる
- **本体を持つ要求にだけ `Content-Type: application/json` を付ける。** `GET` に付けないのは
  preflight の許可対象を増やさないためで、許可の一覧（api 側の `ALLOWED_HEADERS`）に入って
  いるのは `Authorization` と `Content-Type` の2つだけである（ADR-048）
- **設定の読み取りは渡された記録だけを見る。** `import.meta.env` を読むのは `main.tsx` である
  （B-22 設計 規則4 / `docs/testing.md` 5章）

設定の値は `apps/web/.env.local` に置く（Vite の既定。`.gitignore` の `.env.*` で git 管理外）。
`VITE_API_BASE_URL` は**必須**で、既定値を埋め込まない — 欠けたら起動時に落ち、message に名前が
出る（B-22 設計 規則5 / ADR-045 結果2）。`apps/api/.dev.vars` は**サーバ専用**で、こちらの値を
足さない。

**経路の接頭辞は web の側で足さない**（`GET /stock-items` のまま。B-22 設計 規則15）。接頭辞が
効くのは web と api が1つのドメインを分け合うときで、本番の web は api と別の Worker から配信する
（ADR-082）。

本番では、設定の3つの値を Workers Builds のビルド変数に置く（ADR-082 決定4）。Vite がビルドの
時点でバンドルに埋め込むため、Worker の実行時の変数には置かない。
