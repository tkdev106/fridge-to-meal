/**
 * マイグレーションの SQL を1件ぶん受け取り、**そのファイルが作る表ごとに**
 * 行レベルセキュリティの4点（有効化・強制・4ポリシー・権限）が在るかを読み取る純関数
 * （B-07c 設計 規則9・9b / B-44 設計 規則13・14）。
 *
 * 見るのは「表を作るファイルに RLS が同居していること」の1点だけである。ポリシーの
 * 述語が正しいか（`household_id = (select auth.uid())`）は実 DB に対して B-07b と
 * B-44 が見る。
 *
 * **判定の単位は表である**（B-44 設計 規則13 / ADR-029 結果8）。ファイル全体への真偽で
 * 読むと、1ファイルに2つ目の表を足したときに2表目が素通りする。
 *
 * **表の名前は位置で読む**（同 規則14）。`create table <名>` / `alter table <名>` /
 * `create policy … on <名>` / `grant … on <名の並び> to` / `revoke … on <名の並び> from`。
 * 語の出現で数えると `references "meals"` に引っ張られる。引用符とスキーマ修飾は
 * 落としてから比べ、`on` の後ろがカンマ区切りなら並んだ表すべてに数える。
 *
 * **照合の前に SQL コメント（`--` 以降）を落とすこと。** 落とさないと
 * `force row level security` を消したあと「後で足す」とコメントに書くだけで緑に戻り、
 * 守りが自分で穴を開ける。小文字に揃えることも要る — `drizzle-kit` は
 * `CREATE TABLE "stock_items"` と大文字で吐き、手書きの部分は小文字である。
 *
 * 純関数にしてあるのは、テスト自身がこの読み取りを検分できるようにするため（規則9b）。
 */

export type Operation = 'select' | 'insert' | 'update' | 'delete';

export type PolicyInspection = {
  readonly operation: Operation;
  /** `to` に並んだロール。 */
  readonly targetRoles: readonly string[];
  readonly hasUsing: boolean;
  readonly hasWithCheck: boolean;
};

/** 1つの表についての読み取り（B-44 設計 5章）。 */
export type TableInspection = {
  /** 引用符とスキーマ修飾（`public.`）を落とした名前。 */
  readonly tableName: string;
  readonly enablesRowLevelSecurity: boolean;
  readonly forcesRowLevelSecurity: boolean;
  readonly policies: { readonly [K in Operation]: PolicyInspection | null };
  readonly revokesAllFromAnon: boolean;
  readonly operationsGrantedToAuthenticated: readonly Operation[];
  /** この表に足りない点の名前。空ならこの表の4点が揃っている。 */
  readonly missing: readonly string[];
};

/**
 * **表の一覧そのものが「表を作っているか」を表す**（B-44 設計 5章）。空なら表を
 * 作らないファイルである。並び順は約束しない — 引くのは `tableName` である。
 */
export type MigrationInspection = {
  readonly tables: readonly TableInspection[];
};

export function inspectMigrationSql(_sql: string): MigrationInspection {
  throw new Error('未実装');
}
