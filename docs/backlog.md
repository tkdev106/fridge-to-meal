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

- [ ] **B-01** `packages/contract` に在庫の DTO を定義する（FR-01 / FR-04 / FR-05 / FR-06）
- [ ] **B-04** `pantry/usecase`: 在庫品を登録する。カタログに無い食材名でも登録が止まらない（FR-01 / FR-03）
- [ ] **B-05** `pantry/usecase`: 在庫を期限の近い順に一覧する。期限未入力の在庫品は警告・優先の対象外（FR-04 / FR-11 / FR-13）
- [ ] **B-06** `pantry/usecase`: 在庫品の数量・期限の更新と、削除（FR-05 / FR-06）
- [ ] **B-07** `pantry/infrastructure`: Supabase 実装。**利用者の JWT で問い合わせる。`service_role` は使わない**（ADR-020 / NFR-09）
- [ ] **B-08** `pantry/api`: Hono のルート。やりとりは DTO だけで、ドメインの型を HTTP 層に出さない（ADR-003）
- [ ] **B-09** `apps/api/src/main.ts`: composition root で結線する。実装クラスの生成をここだけに閉じる
- [ ] **B-10** `apps/web`: feature flag の仕組み。`features.ts` の1か所で `VITE_FEATURE_*` を読み、既定は無効（ADR-024 / docs/workflow.md）
- [ ] **B-11** `apps/web`: 在庫一覧の画面。残日数を出し、期限が近いものを区別する。**色だけで表さない**（FR-04 / FR-11 / FR-12 / NFR-17）
- [ ] **B-12** `apps/web`: 在庫登録の画面。1件を10秒以内、片手で完結（FR-01 / FR-03 / NFR-14 / NFR-15）
- [ ] **B-13** `meal/domain/service`: `MealCoverageService`。**主材料だけを名称の完全一致で突き合わせる**（C-6 / C-16）。
  **突き合わせる前に両側の前後空白を落とす** — 在庫品の名称は登録時に落としてあり、片側だけ正規化すると一致が静かにずれる
- [ ] **B-14** `meal/domain/service`: `CookableMealFinder`。不足0件のみ、並びは決定的（C-10 / C-12 / C-13）
- [ ] **B-15** `meal/domain/port`: `MealGenerator` ポートの定義。プロバイダ未決のまま進める（ADR-019 / NFR-18）
- [ ] **B-17** `docs/html/adr.html` が ADR-022 以降を欠いている。閲覧用 HTML を Markdown に追いつかせる
  （正は Markdown。`CLAUDE.md`「迷ったらここを見る」）

## 判断待ち（着手しない）

ループが触れたら止まるもの。**decision が入るまで backlog の「次にやること」に上げない。**

| 待っているもの | これが決まらないと着手できないタスク |
| --- | --- |
| 食材マスタの初期データ（出所・件数） | 食材名のサジェスト（FR-02）。充足の当たり方（C-6）がここに懸かっている |
| LLM プロバイダ（ADR-019） | `MealGenerator` の腐敗防止層の実装。**ポートの定義（B-15）までは進められる** |
| 献立の保持期間 | 献立の削除・期限切れの扱い |
| 賞味期限と消費期限の区別 | 期限の警告の出し分け（FR-12） |
| Supabase 無料プランの一時停止対応 | 稼働の維持に関する運用タスク |
