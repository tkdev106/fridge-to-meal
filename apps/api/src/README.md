# apps/api のディレクトリ

`CLAUDE.md` のディレクトリ構成と、`docs/adr.md` A章の依存ルールに対応する。

```
contexts/<ctx>/
  domain/            ← 何も import しない。ここに LLM・プロンプト・JSON・モデル名・SQL は現れない
    entity/          エンティティ（集約ルートを含む）
    value/           値オブジェクト
    service/         ドメインサービス（純粋関数）
    repository/      リポジトリの interface。実装はここに置かない
    port/            外部への出口の interface（MealGenerator など）
    error/           規則違反を断る例外（PantryRuleViolation など）。ADR-025
  usecase/           domain の**兄弟**。domain/usecase/ ではない
  infrastructure/    repository/port の実装。腐敗防止層はここ
  api/               HTTP のハンドラ。usecase だけを呼ぶ
shared/domain/       コンテキストをまたいで共有する最小限の型（HouseholdId など）
main.ts              composition root。実装クラスを new してよい唯一の場所
```

**空のディレクトリは git に載らない。** 各層に `.gitkeep` を置いてある。
最初のファイルを追加したら `.gitkeep` は消してよい。

依存ルールは `pnpm lint:deps`（dependency-cruiser）が機械的に検査する。
規則の一覧は `../../../.dependency-cruiser.cjs` にあり、`docs/adr.md` A章の
表と1対1で対応している。
