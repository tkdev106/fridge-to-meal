# backlog

自律ループ（`/next`）の入力。**上から順に1件ずつ着手し、1件 = 1 PR** で `main` に入れる。
運用は `docs/workflow.md`。

- 完了した行は**消す**。何をやったかの履歴は `git log` にあり、ここに二重に持たない
- 1 PR で説明できる大きさに収める。収まらないなら、実装より先に**分割する PR** を出す
- 画面に出せない段階でもマージする。表示は feature flag で止める（ADR-024）
- ここに無いものを勝手に足さない。必要になったら、まず backlog に行を足す提案をする
- 各行の括弧内は根拠（FR / NFR は `docs/requirements.md`、C-n は `docs/domain-model.md` 第7章、
  ADR-n は `docs/adr.md`）。運用由来のものは `docs/workflow.md` でよい。
  **根拠を書けないタスクは backlog に入れない**

> 順序は「在庫を1本の縦切りで通してから献立に入る」という方針。**ドメインを先に置き、DTO は
> そこから導く**（依存の向きと揃える）。**2026-09-08 にユーザーが確定**。以後は上から順に取る。

---

## 次にやること

- [ ] **B-07f** **Workers から Postgres への接続経路を確かめる**（Hyperdrive の要否）。**このコンテナでは確かめられない** —
  Cloudflare と Supabase の実環境が要る。結果しだいで **ADR-029 の承認が動き**、要れば設定の追加として新しい ADR を起こす。
  **B-09（結線）の前に置く**（ADR-029 の結果3 / ADR-015 / ADR-020 の結果2）。
  **同じ周で JWT の署名方式（共有秘密 / 非対称鍵）も確かめる** — B-07e は `.dev.vars` の雛形から
  共有秘密（HS256）を採ったが、確かめるまで **ADR-031 は `提案` のまま**である（ADR-031 の結果2）
- [ ] **B-09** `apps/api/src/main.ts`: composition root で結線する。実装クラスの生成をここだけに閉じる
- [ ] **B-12** `apps/web`: 在庫登録の画面。1件を10秒以内、片手で完結（FR-01 / FR-03 / NFR-14 / NFR-15）
- [ ] **B-14a** `meal/domain`: 献立集約 `Meal`（`entity`）と `MealId` / `CookingStep` / `CookingRecord`（`value`）。
  不変条件は **domain-model 4章の表がすべて**であり、生成時に見る（`title` は空でない / `ingredients` は
  1件以上でうち主材料1件以上 / `steps` は1件以上で順序を持つ / ちょうど1つの世帯に属し所属は変わらない /
  `cookingRecords` は追加のみ / 生成後 `title` `ingredients` `steps` は不変）。**`generatedAt` と
  `provenance` を落とさない** — C-12 の第3の鍵（生成日時の新しい順）と C-1 がこれに依る。
  **材料に 分量 をどう届かせるかをこの周で決める** — 持つことは用語表（domain-model 3章。`Amount` の
  コンテキストは「在庫・献立」）で既に決まっており、未決なのは `Amount` が
  `contexts/pantry/domain/value/` にあって `meal/domain/` から届かないことの解き方（`shared/domain` へ移すか、
  献立側に起こすか）である。ADR-033 が「献立集約を作る周で決める」と宿題にしている。
  **決めるところまでをこの周に入れ、`Amount` の移動が要ると決まったら B-17 の隣に行を足す** —
  移動は `StockItem` / リポジトリ / ユースケースとそのテストに及び、集約の新規実装と同じ PR には収まらない
  （domain-model 3章・4章 / C-1 / C-3 / C-16 / FR-17 / ADR-008 / ADR-033 の結果3）
- [ ] **B-14b** `meal/domain`: 作れる献立 `CookableMeal`（`value`）と `CookableMealFinder`（`service`）。
  不足0件のみ、並びは決定的。**B-14a の後。**
  **どちらも設計の決定なので、実装の前に ADR を起こして相談する**（B-21 と同じ扱い） —
  C-12 の「期限の近い在庫をより多く使う」の量り方がどの文書にも無い（FR-12 の「3日以内」は画面の帯、
  prompt-design 9.2 の「残日数1日以内」は生成品質の評価であって、どちらも並び順のための線ではない）。
  同じ ADR で、期限を見るために在庫を何で渡すか（ADR-033 の結果4 の branded 型。同名で期限の違う
  在庫品をどう数えるかも含む）と、上位3件を切るのが finder か呼ぶ側か（domain-model 4章は「選び出す」、
  6章は切り取りを提案側に描く）も決まる。**ADR-033 が結果1 で自分の書き換え先を挙げたのと同じ形で、
  domain-model 4章・6章・7章（C-12）の追随も同じ周で行う**
  （C-10 / C-12 / C-13 / FR-34 / NFR-C1b / ADR-033）
- [ ] **B-15** `meal/domain/port`: `MealGenerator` ポートの定義。プロバイダ未決のまま進める（ADR-019 / NFR-18）
- [ ] **B-16** 置き換え済みの **ADR-020 への参照を掃除する**。`apps/api/src/shared/domain/HouseholdId.ts` と
  `packages/contract/src/pantry.ts` に残っている。B-07 で直したのは backlog が名指しした
  `StockItemRepository` の1文だけで、**範囲外には触れていない**（ADR-029 の結果1）
- [ ] **B-17** トランザクションの helper（`withHouseholdTransaction`）を
  `contexts/pantry/infrastructure/db/` から **`shared/` 側へ移す**。**2つ目のコンテキストが表を持つ日に着手する** —
  コンテキストをまたぐ import は禁止のため、そのままでは2つ目の実装が写しを作る。
  **移動であって決定の変更ではない**（B-07 設計 10章 / ADR-029 決定3(a)）
- [ ] **B-18** **`docs/html/` が Markdown に追いついていない。** `adr.html` は
  **v0.2 / ADR-001〜021** のままで、ADR-022 以降が丸ごと無い（`domain-model.html` も要確認）。
  手で書き写すと次に同じことが起きるので、**Markdown から生成する手段を置く**か、
  **閲覧用 HTML をやめる**かのどちらかを選ぶ。**正は Markdown**（CLAUDE.md）であり、
  古い HTML が残っていること自体が読み手を誤らせる（docs/workflow.md）
- [ ] **B-19** `apps/web`: feature flag `pantryList` を消す。在庫一覧（B-11）を既定で出すと決めた時点で、
  `features.ts` の行・`VITE_FEATURE_PANTRY_LIST`・プレゼンテーション層の分岐を同時に削る。
  **放置されたフラグは死んだ分岐になり、次の実装の判断を狂わせる**（ADR-024 結果2 / docs/workflow.md 1章）
- [ ] **B-20** `import.meta.env` の読み出しが `apps/web/src/features.ts` の1か所に閉じていることを
  **ESLint で機械的に止める**。`eslint.config.js` に `no-restricted-syntax` を1本足し、`features.ts` だけ
  `files` で除く（禁止語の規則と同じ形。**依存の追加は要らない**）。**いまは設計レビューだけが守っている** —
  読み出しが増えても `features.pantryList` の値は変わらないため、振る舞いのテストでは赤にできない
  （ADR-024 決定2 / docs/workflow.md 1章 / CLAUDE.md「依存ルールは lint での機械的な強制を推奨」）
- [ ] **B-21** `apps/web`: **feature flag の無効側が配信物から落ちていない。** `features` がオブジェクト1つで
  あるため `vite build` は `features.pantryList` を定数に畳めず、フラグを無効にしてビルドしても
  `PantryList` の文言が成果物に残る（**B-11 で実測**）。落とすなら `features.ts` の形を変えることになり、
  **ADR-024 決定2「読み出しは1か所」と `apps/web/test/features.test.ts` に触れる**。落とさないと決めるなら
  その旨を ADR-024 に結果として追記する。**どちらも設計の決定なので、実装の前に ADR を起こして相談する**
  （ADR-024 決定2・結果1 / `apps/web/src/features.ts` の doc が B-11 に課していた確認）
- [ ] **B-22** `apps/web`: **在庫一覧をサーバから取得する。** `ListStockItems` の `GET` を叩く薄い層を置き、
  `PantryList` に渡す。**いまは `App.tsx` が常に0件を渡しており、フラグを有効にしても在庫は出ない**
  （B-11 は画面だけを作り、取得は範囲外とした）。テストは `fetch` を差し替える。**B-09（結線）の後**
  （FR-04 / ADR-003 / B-11 設計 2章・10章）
- [ ] **B-23** `apps/web`: 在庫の削除（FR-06）。行のスワイプで消し、確認は出さない。
  **ADR-027 が B-11 を名指ししていた「削除が冪等でない」の宿題をここで引き取る** — 取りこぼした再送が
  受け取る 404 を「すでに消えている」として扱うか、利用者に見せるかを決める。B-11 は一覧の表示だけを
  作り、削除を範囲外としたため宿題が宙に浮いていた（FR-06 / ADR-027 の結果 / screen-design 5章）

## 判断待ち（着手しない）

ループが触れたら止まるもの。**decision が入るまで backlog の「次にやること」に上げない。**

| 待っているもの | これが決まらないと着手できないタスク |
| --- | --- |
| 食材マスタの初期データ（出所・件数） | 食材名のサジェスト（FR-02）。充足の当たり方（C-6）がここに懸かっている |
| LLM プロバイダ（ADR-019） | `MealGenerator` の腐敗防止層の実装。**ポートの定義（B-15）までは進められる** |
| 献立の保持期間 | 献立の削除・期限切れの扱い |
| 賞味期限と消費期限の区別 | **期限の種別ごとの**警告の出し分け（FR-12）。単一の「期限」のままの帯分けは B-11 で済んでいる |
| Supabase 無料プランの一時停止対応 | 稼働の維持に関する運用タスク |
