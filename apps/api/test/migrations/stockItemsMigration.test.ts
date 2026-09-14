import { describe, expect, it } from 'vitest';
import { inspectMigrationSql } from '../support/migrations/InspectMigrationSql.js';
import { migrationSqlFiles, migrationMetaFileNames } from '../support/migrations/MigrationFiles.js';

/**
 * 表を作るマイグレーションに、行レベルセキュリティの4点が**同じファイルで**同居して
 * いることの守り（B-07c 設計 規則9 / ADR-029 結果8 / NFR-09）。分けて置くと、片方だけ
 * 適用された状態＝RLS の無い stock_items が実在する窓ができる（ADR-028）。
 *
 * **1ファイルごとに判定する。** 全ファイルを連結してから照合すると「表とポリシーが
 * 別ファイル」でも緑になり、守りたいものがそのまま抜ける。
 *
 * ここでは**ポリシーが正しいか**を見ない。述語（`household_id = (select auth.uid())`）は
 * 実 DB に対して B-07b が見る。
 */
const tableCreatingFiles = migrationSqlFiles.filter(
  ([, sql]) => inspectMigrationSql(sql).createsTable,
);

const eachFile = it.each(tableCreatingFiles);

describe('在庫品のマイグレーション', () => {
  it('表を作るマイグレーションが少なくとも1件見つかる', () => {
    // 走査が空振りすると以下がすべて素通りし、守りが消えたことに誰も気づけない。
    expect(tableCreatingFiles.length).toBeGreaterThan(0);
  });

  eachFile('%s は同じファイルで行レベルセキュリティを有効にする', (_fileName, sql) => {
    // 規則5(a)
    expect(inspectMigrationSql(sql).enablesRowLevelSecurity).toBe(true);
  });

  eachFile('%s は同じファイルで行レベルセキュリティを強制する', (_fileName, sql) => {
    // 規則5(b)・6: 表の所有者ロールで繋がざるをえない場合に RLS が素通りするのを塞ぐ。
    expect(inspectMigrationSql(sql).forcesRowLevelSecurity).toBe(true);
  });

  eachFile('%s は authenticated 向けの select ポリシーを持つ', (_fileName, sql) => {
    // 規則5(c)
    expect(inspectMigrationSql(sql).policies.select?.targetRoles).toEqual(['authenticated']);
  });

  eachFile('%s は authenticated 向けの insert ポリシーを持つ', (_fileName, sql) => {
    // 規則5(c)
    expect(inspectMigrationSql(sql).policies.insert?.targetRoles).toEqual(['authenticated']);
  });

  eachFile('%s は authenticated 向けの update ポリシーを持つ', (_fileName, sql) => {
    // 規則5(c)
    expect(inspectMigrationSql(sql).policies.update?.targetRoles).toEqual(['authenticated']);
  });

  eachFile('%s は authenticated 向けの delete ポリシーを持つ', (_fileName, sql) => {
    // 規則5(c)
    expect(inspectMigrationSql(sql).policies.delete?.targetRoles).toEqual(['authenticated']);
  });

  eachFile('%s の insert ポリシーは with check を持つ', (_fileName, sql) => {
    // 落とすと他世帯の行を作れる。しかも作った本人には select ポリシーで見えない。
    expect(inspectMigrationSql(sql).policies.insert?.hasWithCheck).toBe(true);
  });

  eachFile('%s の update ポリシーは using を持つ', (_fileName, sql) => {
    // 無いと他世帯の行を掴める。
    expect(inspectMigrationSql(sql).policies.update?.hasUsing).toBe(true);
  });

  eachFile('%s の update ポリシーは with check を持つ', (_fileName, sql) => {
    // 無いと自分の行を他世帯へ移せる。
    expect(inspectMigrationSql(sql).policies.update?.hasWithCheck).toBe(true);
  });

  eachFile('%s は anon からすべての権限を取り上げる', (_fileName, sql) => {
    // 規則5(d) / NFR-09
    expect(inspectMigrationSql(sql).revokesAllFromAnon).toBe(true);
  });

  eachFile('%s は authenticated に4つの操作を許可する', (_fileName, sql) => {
    // 規則5(d)・7: 接続ロールは set local role authenticated に切り替えて読み書きするため、
    // 権限は authenticated に付いていれば足りる。
    expect(inspectMigrationSql(sql).operationsGrantedToAuthenticated).toEqual([
      'select',
      'insert',
      'update',
      'delete',
    ]);
  });

  it('コメントに書かれただけの語では4点を満たしたことにならない', () => {
    // 規則9b: 照合の前に SQL コメント（`--` 以降）を落とす。落とさないと、
    // force row level security を消したあと「後で足す」と書くだけで緑に戻り、
    // 守りが自分で穴を開ける。
    const commentOnlySql = [
      'create table public.stock_items (id uuid primary key);',
      '-- force row level security を後で足す',
    ].join('\n');

    expect(inspectMigrationSql(commentOnlySql).missing).toContain('force row level security');
  });

  it('生成の土台（meta/_journal.json）がコミットされている', () => {
    // 規則8・9c: drizzle-kit generate は snapshot との差分だけを新しいファイルに書く。
    // 手で足した RLS が消える筋は「snapshot ごと捨てて 0000 から作り直す」場合だけであり、
    // journal がリポジトリに在ることがその一次の防波堤になる。
    expect(migrationMetaFileNames).toContain('_journal.json');
  });
});
