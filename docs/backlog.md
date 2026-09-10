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
- [ ] **B-08** `pantry/api`: Hono のルート。やりとりは DTO だけで、ドメインの型を HTTP 層に出さない（ADR-003）。
  **`PantryRuleViolation.rule` から状態コードを引く表を設計書に持たせる** — B-06 の
  `update.notFound` と B-06a の `delete.notFound`（どちらも見つからない）を規則違反の
  一種として表したため、404 と 400 の区別が `rule` の値に載っている。表が無いと
  すべて 400 になる
- [ ] **B-09** `apps/api/src/main.ts`: composition root で結線する。実装クラスの生成をここだけに閉じる
- [ ] **B-10** `apps/web`: feature flag の仕組み。`features.ts` の1か所で `VITE_FEATURE_*` を読み、既定は無効（ADR-024 / docs/workflow.md）
- [ ] **B-11** `apps/web`: 在庫一覧の画面。残日数を出し、期限が近いものを区別する。**色だけで表さない**（FR-04 / FR-11 / FR-12 / NFR-17）
- [ ] **B-12** `apps/web`: 在庫登録の画面。1件を10秒以内、片手で完結（FR-01 / FR-03 / NFR-14 / NFR-15）
- [ ] **B-13** `meal/domain/service`: `MealCoverageService`。**主材料だけを名称の完全一致で突き合わせる**（C-6 / C-16）。
  **突き合わせる前に両側の前後空白を落とす** — 在庫品の名称は登録時に落としてあり、片側だけ正規化すると一致が静かにずれる
- [ ] **B-14** `meal/domain/service`: `CookableMealFinder`。不足0件のみ、並びは決定的（C-10 / C-12 / C-13）
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

## 判断待ち（着手しない）

ループが触れたら止まるもの。**decision が入るまで backlog の「次にやること」に上げない。**

| 待っているもの | これが決まらないと着手できないタスク |
| --- | --- |
| 食材マスタの初期データ（出所・件数） | 食材名のサジェスト（FR-02）。充足の当たり方（C-6）がここに懸かっている |
| LLM プロバイダ（ADR-019） | `MealGenerator` の腐敗防止層の実装。**ポートの定義（B-15）までは進められる** |
| 献立の保持期間 | 献立の削除・期限切れの扱い |
| 賞味期限と消費期限の区別 | 期限の警告の出し分け（FR-12） |
| Supabase 無料プランの一時停止対応 | 稼働の維持に関する運用タスク |
