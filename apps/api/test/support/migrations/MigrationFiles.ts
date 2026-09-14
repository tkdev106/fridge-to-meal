/**
 * `supabase/migrations/` の中身を読み込む。**ファイル名を決め打ちせず走査する** —
 * この周でファイル名自体が生成物に置き換わり、次に表が増えたときには自動で守りが
 * 掛かることが要件だからである（B-07c 設計 規則9）。
 *
 * 読み込みに `node:fs` ではなく vite（vitest）の `import.meta.glob` を使うのは、
 * このリポジトリに `@types/node` が無く、依存を足すのはユーザーの承認が要るため。
 * 読むのはリポジトリ内の数 KB のファイルで、`docs/testing.md` 5章がプロセス外の依存の
 * 禁止から明示的に外している範囲に収まる。
 */

/** `import.meta.glob` は vite が変換時に解決する。呼び出しは直書きでないと展開されない。 */
type GlobbableImportMeta = {
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
};

const loadedSql = (import.meta as unknown as GlobbableImportMeta).glob(
  '../../../../../supabase/migrations/*.sql',
  { query: '?raw', import: 'default', eager: true },
);

const loadedMeta = (import.meta as unknown as GlobbableImportMeta).glob(
  '../../../../../supabase/migrations/meta/*.json',
  { query: '?raw', import: 'default', eager: true },
);

function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** `[ファイル名, SQL の全文]` の一覧。並びはファイル名順で決定的。 */
export const migrationSqlFiles: [string, string][] = Object.entries(loadedSql)
  .map(([path, content]): [string, string] => [fileNameOf(path), content])
  .sort(([left], [right]) => left.localeCompare(right));

/** `supabase/migrations/meta/` に在る生成物のファイル名（規則8・9c）。 */
export const migrationMetaFileNames: string[] = Object.keys(loadedMeta).map(fileNameOf).sort();
