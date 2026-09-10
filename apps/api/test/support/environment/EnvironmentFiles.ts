/**
 * リポジトリ直下の環境ファイル（`docker-compose.yml` と `supabase/local/init.sql`）を
 * 読み込む（B-07d 設計 4章）。
 *
 * 読み込みに `node:fs` ではなく vite（vitest）の `import.meta.glob` を使うのは、
 * このリポジトリに `@types/node` が無く、依存を足すのはユーザーの承認が要るためである
 * （`MigrationFiles.ts` と同じ手）。読むのはリポジトリ内の数 KB のファイルで、
 * `docs/testing.md` 5章がプロセス外の依存の禁止から明示的に外している範囲に収まる。
 *
 * **まだ置かれていないファイルは `null` として返す。** 「無い」を値として扱えないと、
 * 未実装のときにモジュールが解決できずに落ち、**期待値の不一致という赤にならない**。
 */

/** `import.meta.glob` は vite が変換時に解決する。呼び出しは直書きでないと展開されない。 */
type グロブできるimportMeta = {
  glob(
    パターン: string,
    設定: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
};

// 第2引数は**オブジェクトリテラルでないと** vite が展開しない（定数に括り出せない）。
const 読み込んだcompose = (import.meta as unknown as グロブできるimportMeta).glob(
  '../../../../../docker-compose.yml',
  { query: '?raw', import: 'default', eager: true },
);

const 読み込んだ初期化SQL = (import.meta as unknown as グロブできるimportMeta).glob(
  '../../../../../supabase/local/*.sql',
  { query: '?raw', import: 'default', eager: true },
);

function 最初の中身(読み込んだもの: Record<string, string>): string | null {
  const 中身 = Object.entries(読み込んだもの).sort(([左], [右]) => 左.localeCompare(右))[0];
  return 中身 === undefined ? null : 中身[1];
}

/** `docker-compose.yml` の全文。無ければ `null`。 */
export const composeのYAML: string | null = 最初の中身(読み込んだcompose);

/** `supabase/local/init.sql` の全文。無ければ `null`。 */
export const 初期化SQL: string | null = 最初の中身(読み込んだ初期化SQL);
