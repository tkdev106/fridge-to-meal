import { describe, expect, it } from 'vitest';
import { configDefaults } from 'vitest/config';
import vitestConfig from '../../../../vitest.config.js';
import dbConfig from '../../../../vitest.db.config.js';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import { composeYaml, initSql } from '../support/environment/EnvironmentFiles.js';
import { migrationSqlFiles } from '../support/migrations/MigrationFiles.js';
import { inspectMigrationSql } from '../support/migrations/InspectMigrationSql.js';

/**
 * ローカル Postgres の枠そのものの守り（B-07d 設計 規則1・4・8・9・10）。
 *
 * **`apps/api/test/db/**` の外に置く。** 中に置くと `pnpm test` 側の `exclude` に当たって
 * 走らなくなる。ここは Docker を要さない — 見ているのは設定とファイルの中身だけで、
 * `docs/testing.md` 5章がプロセス外の依存の禁止から外している範囲に収まる。
 *
 * 設定は**モジュールとして読み、値として見る**（設計 規則14）。`?raw` の正規表現で追うと、
 * 書き方を変えただけで赤くなりリファクタリング耐性を失う。`?raw` を使うのは YAML と SQL だけ。
 */
const excludePatterns = vitestConfig.test?.exclude ?? [];

const tableCreatingFiles = migrationSqlFiles.filter(
  ([, sql]) => inspectMigrationSql(sql).createsTable,
);

const eachFile = it.each(tableCreatingFiles);

/**
 * コメントを落とす。**落とすことが要**である — 落とさないと、`healthcheck` を消したあとに
 * 「後で足す」とコメントへ書くだけで緑に戻り、守りが自分で穴を開ける。逆に負の照合
 * （`service_role` が無いこと）では、コメントに書かれた語で**根拠なく赤になる**のを防ぐ。
 * `apps/api/test/support/migrations/InspectMigrationSql.ts` と同じ考え方（B-07c 規則9b）。
 */
function stripComments(content: string, marker: string): string {
  return content
    .split('\n')
    .map((line) => {
      const position = line.indexOf(marker);
      return position === -1 ? line : line.slice(0, position);
    })
    .join('\n');
}

/** compose が公開しているホスト側のポート。 */
function publishedPort(yaml: string): string | null {
  return /(\d+):5432/.exec(yaml)?.[1] ?? null;
}

/** 接続文字列が指しているポート。 */
function portOf(connectionString: string): string | null {
  return /:(\d+)\//.exec(connectionString)?.[1] ?? null;
}

describe('ローカル Postgres の枠', () => {
  it('pnpm test の設定はデータベースに繋ぐテストを走らせない', () => {
    // 規則8: 分け方は置き場で決める。除外しないと同じテストが2度走り、
    // Docker の無い環境で pnpm test が落ちる。
    expect(excludePatterns).toContain('apps/api/test/db/**');
  });

  it('データベースのテストを除外しても既定の除外は残る', () => {
    // 規則8: exclude を上書きすると node_modules まで走査してしまう。
    for (const defaultPattern of configDefaults.exclude) {
      expect(excludePatterns).toContain(defaultPattern);
    }
  });

  it('pnpm test:db の設定は apps/api/test/db/ だけを拾う', () => {
    // 規則8: apps/api/test/migrations/ は Docker を要さないので pnpm test 側に残る。
    expect(dbConfig.test?.include).toEqual(['apps/api/test/db/**/*.test.ts']);
  });

  it('pnpm test:db はファイルを並列に走らせない', () => {
    // 規則8: データベースは共有資源で、globalSetup が公開スキーマごと作り直す。
    expect(dbConfig.test?.fileParallelism).toBe(false);
  });

  it('初期化 SQL は行レベルセキュリティを迂回する役を作らない', () => {
    // 規則4 / ADR-029 結果1 / NFR-09: service_role を使えないことを環境で担保する。
    // 迂回できる役が1つでも在ると、世帯の分離（C-9）は書いてあるだけのものになる。
    expect(initSql, 'supabase/local/init.sql が無い').not.toBeNull();

    const content = stripComments(initSql ?? '', '--').toLowerCase();

    expect(content).not.toContain('service_role');
    expect(content).not.toContain('bypassrls');
    expect(content).not.toContain('superuser');
  });

  eachFile('%s は1トランザクションのまま残る', (_fileName, sql) => {
    // 規則1 / ADR-028: 適用は sql.unsafe(全文).simple() で流す。begin; / commit; を
    // 落とすと、表と RLS が別トランザクションに割れる窓がふたたび開く。
    expect(sql).toMatch(/^begin;$/m);
    expect(sql).toMatch(/^commit;$/m);
  });

  it('compose の healthcheck は TCP で起き切りを検査する', () => {
    // 規則10 / ADR-029 結果5: initdb 中の一時サーバは UNIX ソケットしか開かないため、
    // ソケット越しの検査は初期化中に成功してしまう。
    expect(composeYaml, 'docker-compose.yml が無い').not.toBeNull();

    const content = stripComments(composeYaml ?? '', '#');

    expect(content).toContain('healthcheck');
    expect(content).toContain('pg_isready');
    expect(content).toContain('-h');
  });

  it('テストが繋ぐポートと compose が公開するポートが一致する', () => {
    // 規則9: 既定の 5432 と衝突させない。変えるときは compose と定数の2か所を直す。
    expect(composeYaml, 'docker-compose.yml が無い').not.toBeNull();

    expect(publishedPort(stripComments(composeYaml ?? '', '#'))).toBe('55432');
    expect(portOf(APP_CONNECTION_STRING)).toBe('55432');
  });
});
