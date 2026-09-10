# マイグレーション

`stock_items` などの表と RLS ポリシーを置く。**表を作る部分の正はスキーマの側**
（`apps/api/src/contexts/pantry/infrastructure/db/schema.ts`）にあり、SQL を手で書かない（ADR-029 決定2）。

## 表を足す・直す手順

```sh
# 1. スキーマ（.ts）を直す
# 2. 生成する（--name は <動詞_対象>。ファイル名になる）
pnpm --filter @fridge-to-meal/api db:generate --name create_stock_items
# 3. 生成物に RLS の4点を手で足す（下記）
# 4. SQL と meta/ をまとめてコミットする
```

**`meta/_journal.json` と snapshot を必ずコミットする。** `drizzle-kit generate` は snapshot との
差分だけを**新しいファイル**に書き、既存のファイルを書き換えない。手で足した RLS が消える筋は
**「snapshot ごと捨てて 0000 から作り直す」場合だけ**であり、journal がリポジトリに在ることが
一次の防波堤になる。

**`drizzle-kit push` は使わない。** 生成物が残らず、RLS を足す場所そのものが無くなる。

## 生成物に手で足す4点

| # | 何を |
| --- | --- |
| (a) | `alter table ... enable row level security` |
| (b) | `alter table ... force row level security` — 所有者ロールで繋がざるをえない場合にも効かせる |
| (c) | 4つのポリシー（select / insert / update / delete）。`to authenticated`、述語は `household_id = (select auth.uid())` |
| (d) | `revoke all ... from anon` と `grant select, insert, update, delete ... to authenticated` |

**足し忘れは `pnpm test` が止める** — `apps/api/test/migrations/stockItemsMigration.test.ts` が、
`create table` を含むファイルに4点が同居していることを見る。**コメントに書いただけでは通らない。**

## RLS を書くときに落とさないこと

| 操作 | `using` | `with check` |
| --- | --- | --- |
| `select` | 要る | — |
| `insert` | **存在しない** | **要る** |
| `update` | 要る | 要る |
| `delete` | 要る | — |

**`insert` の `with check` を落とすと、他世帯の行を作れてしまう。** 作った本人には `select`
ポリシーで見えないため、画面上は何も起きていないように見え、**気づけない。**

**RLS は効いていないことに気づけない。** ポリシーを1行消してもアプリは正常に動き続ける。
述語が本当に効いているかは、ローカル Postgres に対する回帰テスト（B-07b）が確かめる。

## その他の決めごと

- ファイル名は `drizzle-kit` が付ける `<YYYYMMDDHHmmss>_<名前>.sql`。**生成後に手で変えない**
  （`meta/_journal.json` の `tag` と食い違う）
- **1タスク1ファイル。適用済みのファイルは書き換えない。** 直すときはスキーマを直して生成し直す
- **表の作成と RLS を同じファイルに置く。** 分けると、片方だけ適用された状態＝**RLS の無い表が
  実在する窓**ができる。あわせて `begin;` / `commit;` で囲む
- **`create role` を書かない。** Supabase には `authenticated` が既に在り、ローカル側の役者は
  B-07d の初期化 SQL が用意する
- **`service_role` で適用しない前提の内容にする。** 権限は `authenticated` にだけ与える（ADR-020 / NFR-09）

## 適用

**Supabase CLI はまだ依存に入っていない。** 現状は Supabase の SQL エディタに貼って適用する。
CLI の導入と CI での適用は **B-07d**（ローカル Postgres と `pnpm test:db` を置く周）で決める。
