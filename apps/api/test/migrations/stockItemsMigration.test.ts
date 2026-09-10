import { describe, expect, it } from 'vitest';
import { マイグレーションを検分する } from '../support/migrations/InspectMigrationSql.js';
import {
  マイグレーションのSQL,
  生成の土台のファイル名,
} from '../support/migrations/MigrationFiles.js';

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
const 表を作るファイル = マイグレーションのSQL.filter(
  ([, sql]) => マイグレーションを検分する(sql).表を作る,
);

const 各ファイル = it.each(表を作るファイル);

describe('在庫品のマイグレーション', () => {
  it('表を作るマイグレーションが少なくとも1件見つかる', () => {
    // 走査が空振りすると以下がすべて素通りし、守りが消えたことに誰も気づけない。
    expect(表を作るファイル.length).toBeGreaterThan(0);
  });

  各ファイル('%s は同じファイルで行レベルセキュリティを有効にする', (_名前, sql) => {
    // 規則5(a)
    expect(マイグレーションを検分する(sql).行レベルセキュリティを有効にする).toBe(true);
  });

  各ファイル('%s は同じファイルで行レベルセキュリティを強制する', (_名前, sql) => {
    // 規則5(b)・6: 表の所有者ロールで繋がざるをえない場合に RLS が素通りするのを塞ぐ。
    expect(マイグレーションを検分する(sql).行レベルセキュリティを強制する).toBe(true);
  });

  各ファイル('%s は authenticated 向けの select ポリシーを持つ', (_名前, sql) => {
    // 規則5(c)
    expect(マイグレーションを検分する(sql).ポリシー.select?.対象ロール).toEqual(['authenticated']);
  });

  各ファイル('%s は authenticated 向けの insert ポリシーを持つ', (_名前, sql) => {
    // 規則5(c)
    expect(マイグレーションを検分する(sql).ポリシー.insert?.対象ロール).toEqual(['authenticated']);
  });

  各ファイル('%s は authenticated 向けの update ポリシーを持つ', (_名前, sql) => {
    // 規則5(c)
    expect(マイグレーションを検分する(sql).ポリシー.update?.対象ロール).toEqual(['authenticated']);
  });

  各ファイル('%s は authenticated 向けの delete ポリシーを持つ', (_名前, sql) => {
    // 規則5(c)
    expect(マイグレーションを検分する(sql).ポリシー.delete?.対象ロール).toEqual(['authenticated']);
  });

  各ファイル('%s の insert ポリシーは with check を持つ', (_名前, sql) => {
    // 落とすと他世帯の行を作れる。しかも作った本人には select ポリシーで見えない。
    expect(マイグレーションを検分する(sql).ポリシー.insert?.withCheckを持つ).toBe(true);
  });

  各ファイル('%s の update ポリシーは using を持つ', (_名前, sql) => {
    // 無いと他世帯の行を掴める。
    expect(マイグレーションを検分する(sql).ポリシー.update?.usingを持つ).toBe(true);
  });

  各ファイル('%s の update ポリシーは with check を持つ', (_名前, sql) => {
    // 無いと自分の行を他世帯へ移せる。
    expect(マイグレーションを検分する(sql).ポリシー.update?.withCheckを持つ).toBe(true);
  });

  各ファイル('%s は anon からすべての権限を取り上げる', (_名前, sql) => {
    // 規則5(d) / NFR-09
    expect(マイグレーションを検分する(sql).anonから全権限を取り上げる).toBe(true);
  });

  各ファイル('%s は authenticated に4つの操作を許可する', (_名前, sql) => {
    // 規則5(d)・7: 接続ロールは set local role authenticated に切り替えて読み書きするため、
    // 権限は authenticated に付いていれば足りる。
    expect(マイグレーションを検分する(sql).authenticatedに許す操作).toEqual([
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
    const コメントに書いただけのSQL = [
      'create table public.stock_items (id uuid primary key);',
      '-- force row level security を後で足す',
    ].join('\n');

    expect(マイグレーションを検分する(コメントに書いただけのSQL).不足).toContain(
      'force row level security',
    );
  });

  it('生成の土台（meta/_journal.json）がコミットされている', () => {
    // 規則8・9c: drizzle-kit generate は snapshot との差分だけを新しいファイルに書く。
    // 手で足した RLS が消える筋は「snapshot ごと捨てて 0000 から作り直す」場合だけであり、
    // journal がリポジトリに在ることがその一次の防波堤になる。
    expect(生成の土台のファイル名).toContain('_journal.json');
  });
});
