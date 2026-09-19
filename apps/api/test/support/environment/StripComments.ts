/**
 * 行コメントを落とす（B-07d 設計 規則10 / B-09 設計 規則12）。
 *
 * **落とすことが要**である — 落とさないと、設定を消したあとに「後で足す」とコメントへ
 * 書くだけで緑に戻り、守りが自分で穴を開ける。逆に負の照合（`service_role` や
 * 接続文字列が無いこと）では、コメントに書かれた語で**根拠なく赤になる**のを防ぐ。
 * `apps/api/test/support/migrations/InspectMigrationSql.ts` と同じ考え方（B-07c 規則9b）。
 *
 * `marker` は YAML / TOML なら `#`、SQL なら `--`。
 */
export function stripComments(content: string, marker: string): string {
  return content
    .split('\n')
    .map((line) => {
      const position = line.indexOf(marker);
      return position === -1 ? line : line.slice(0, position);
    })
    .join('\n');
}
