# features/meal

献立コンテキストに対応する画面。`docs/screen-design.md` の第3章（献立タブ）と
第4章（献立詳細）、第7章（履歴タブ）がここに来る。

API のクライアントであり、**サーバ側のドメインを import しない**（ADR-003）。
やりとりするのは `@fridge-to-meal/contract` の DTO だけ。
