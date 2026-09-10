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
type グロブできるimportMeta = {
  glob(
    パターン: string,
    設定: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
};

const 読み込んだSQL = (import.meta as unknown as グロブできるimportMeta).glob(
  '../../../../../supabase/migrations/*.sql',
  { query: '?raw', import: 'default', eager: true },
);

const 読み込んだ生成の土台 = (import.meta as unknown as グロブできるimportMeta).glob(
  '../../../../../supabase/migrations/meta/*.json',
  { query: '?raw', import: 'default', eager: true },
);

function ファイル名(パス: string): string {
  return パス.slice(パス.lastIndexOf('/') + 1);
}

/** `[ファイル名, SQL の全文]` の一覧。並びはファイル名順で決定的。 */
export const マイグレーションのSQL: [string, string][] = Object.entries(読み込んだSQL)
  .map(([パス, 中身]): [string, string] => [ファイル名(パス), 中身])
  .sort(([左], [右]) => 左.localeCompare(右));

/** `supabase/migrations/meta/` に在る生成物のファイル名（規則8・9c）。 */
export const 生成の土台のファイル名: string[] = Object.keys(読み込んだ生成の土台)
  .map(ファイル名)
  .sort();
