/**
 * リポジトリ直下の環境ファイル（`docker-compose.yml` と `supabase/local/init.sql`）と、
 * api の設定ファイル（`apps/api/wrangler.toml` と `apps/api/package.json`）を読み込む
 * （B-07d 設計 4章 / B-09 設計 4章）。
 *
 * `package.json` も `?raw` で読むのは、`tsconfig.base.json` が `resolveJsonModule` を持たず、
 * テストの都合で tsconfig を緩めないためである。値として見る側（`wrangler.test.ts`）が
 * `JSON.parse` する。
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
type GlobbableImportMeta = {
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
};

// 第2引数は**オブジェクトリテラルでないと** vite が展開しない（定数に括り出せない）。
const loadedCompose = (import.meta as unknown as GlobbableImportMeta).glob(
  '../../../../../docker-compose.yml',
  { query: '?raw', import: 'default', eager: true },
);

const loadedInitSql = (import.meta as unknown as GlobbableImportMeta).glob(
  '../../../../../supabase/local/*.sql',
  { query: '?raw', import: 'default', eager: true },
);

const loadedWranglerToml = (import.meta as unknown as GlobbableImportMeta).glob(
  '../../../wrangler.toml',
  { query: '?raw', import: 'default', eager: true },
);

const loadedApiPackageJson = (import.meta as unknown as GlobbableImportMeta).glob(
  '../../../package.json',
  { query: '?raw', import: 'default', eager: true },
);

function firstContent(loaded: Record<string, string>): string | null {
  const content = Object.entries(loaded).sort(([left], [right]) => left.localeCompare(right))[0];
  return content === undefined ? null : content[1];
}

/** `docker-compose.yml` の全文。無ければ `null`。 */
export const composeYaml: string | null = firstContent(loadedCompose);

/** `supabase/local/init.sql` の全文。無ければ `null`。 */
export const initSql: string | null = firstContent(loadedInitSql);

/** `apps/api/wrangler.toml` の全文。無ければ `null`。 */
export const wranglerToml: string | null = firstContent(loadedWranglerToml);

/** `apps/api/package.json` の全文（未パース）。無ければ `null`。 */
export const apiPackageJson: string | null = firstContent(loadedApiPackageJson);
