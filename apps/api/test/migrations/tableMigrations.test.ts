import { describe, expect, it } from 'vitest';
import type { Operation, TableInspection } from '../support/migrations/InspectMigrationSql.js';
import { inspectMigrationSql } from '../support/migrations/InspectMigrationSql.js';
import { migrationSqlFiles, migrationMetaFileNames } from '../support/migrations/MigrationFiles.js';

/**
 * 表を作るマイグレーションに、行レベルセキュリティの4点が**同じファイルで**同居して
 * いることの守り（B-07c 設計 規則9 / B-44 設計 規則13・14 / ADR-029 結果8 / NFR-09）。
 * 分けて置くと、片方だけ適用された状態＝RLS の無い表が実在する窓ができる（ADR-029 決定2）。
 *
 * **1ファイルごと、さらにそのファイルが作る1表ごとに判定する。** 全ファイルを連結して
 * から照合すると「表とポリシーが別ファイル」でも緑になり、ファイル全体への真偽で
 * 照合すると**2つ目の表が素通りする**（B-44 設計 規則13）。守りたいものがそのまま抜ける。
 *
 * ここでは**ポリシーが正しいか**を見ない。述語（`household_id = (select private.current_household_id())`）は
 * 実 DB に対して各表の RLS のテストが見る。
 */

/** 4点の揃った表を1つぶん書く SQL。**本題だけが `overrides` に現れる**形にする。 */
type TableSqlOverrides = {
  readonly enablesRowLevelSecurity: boolean;
  readonly forcesRowLevelSecurity: boolean;
  /** `create policy` を書く操作。減らせばその本が落ちる。 */
  readonly policyOperations: readonly Operation[];
  readonly insertHasWithCheck: boolean;
  readonly revokesAllFromAnon: boolean;
  readonly grantsToAuthenticated: boolean;
};

function policySql(tableName: string, operation: Operation, hasWithCheck: boolean): string {
  const predicate = `"household_id" = (select private.current_household_id())`;
  const clauses = [
    operation === 'insert' ? '' : `using (${predicate})`,
    operation === 'insert' || operation === 'update'
      ? hasWithCheck
        ? `with check (${predicate})`
        : ''
      : '',
  ].filter((clause) => clause !== '');

  return `create policy "${tableName}_${operation}" on "${tableName}"
  for ${operation} to authenticated
  ${clauses.join('\n  ')};`;
}

/** 表を1つ作るだけの文。4点は `guardSql` の側にある。 */
function createTableSql(tableName: string): string {
  return `create table "${tableName}" ("id" uuid primary key, "household_id" uuid not null);`;
}

/** ある表を名指しした RLS の4点。`overrides` に現れたものだけが欠ける。 */
function guardSql(tableName: string, overrides: Partial<TableSqlOverrides> = {}): string {
  const {
    enablesRowLevelSecurity = true,
    forcesRowLevelSecurity = true,
    policyOperations = ['select', 'insert', 'update', 'delete'],
    insertHasWithCheck = true,
    revokesAllFromAnon = true,
    grantsToAuthenticated = true,
  } = overrides;

  return [
    enablesRowLevelSecurity ? `alter table "${tableName}" enable row level security;` : '',
    forcesRowLevelSecurity ? `alter table "${tableName}" force row level security;` : '',
    ...policyOperations.map((operation) => policySql(tableName, operation, insertHasWithCheck)),
    revokesAllFromAnon ? `revoke all on "${tableName}" from anon;` : '',
    grantsToAuthenticated
      ? `grant select, insert, update, delete on "${tableName}" to authenticated;`
      : '',
  ]
    .filter((statement) => statement !== '')
    .join('\n');
}

/** 表1つと、その表の4点。 */
function tableSql(tableName: string, overrides: Partial<TableSqlOverrides> = {}): string {
  return [createTableSql(tableName), guardSql(tableName, overrides)].join('\n');
}

/**
 * 関数だけを通す表（B-73 設計 規則3・12 / ADR-087 決定3）を1つぶん書く SQL の部品。
 * 既定は「足りない点の無い」形 — 有効化・`anon` と `authenticated` からの取り上げ・
 * ポリシー0本・`authenticated` への grant 0・強制なし。**本題だけが `overrides` に現れる。**
 */
type FunctionOnlyTableSqlOverrides = {
  readonly enablesRowLevelSecurity: boolean;
  readonly forcesRowLevelSecurity: boolean;
  readonly revokesAllFromAnon: boolean;
  readonly revokesAllFromAuthenticated: boolean;
  readonly policyOperations: readonly Operation[];
  readonly grantsToAuthenticated: boolean;
};

function functionOnlyTableSql(
  tableName: string,
  overrides: Partial<FunctionOnlyTableSqlOverrides> = {},
): string {
  const {
    enablesRowLevelSecurity = true,
    forcesRowLevelSecurity = false,
    revokesAllFromAnon = true,
    revokesAllFromAuthenticated = true,
    policyOperations = [],
    grantsToAuthenticated = false,
  } = overrides;
  const revokedRoles = [
    revokesAllFromAnon ? 'anon' : '',
    revokesAllFromAuthenticated ? 'authenticated' : '',
  ].filter((role) => role !== '');

  return [
    createTableSql(tableName),
    enablesRowLevelSecurity ? `alter table "${tableName}" enable row level security;` : '',
    forcesRowLevelSecurity ? `alter table "${tableName}" force row level security;` : '',
    ...policyOperations.map((operation) => policySql(tableName, operation, true)),
    revokedRoles.length > 0 ? `revoke all on "${tableName}" from ${revokedRoles.join(', ')};` : '',
    grantsToAuthenticated
      ? `grant select, insert, update, delete on "${tableName}" to authenticated;`
      : '',
  ]
    .filter((statement) => statement !== '')
    .join('\n');
}

/** **並び順に依存しない。** 設計は `tables` の順序を約束していないので名前で引く。 */
function tableNamed(sql: string, tableName: string): TableInspection {
  const found = inspectMigrationSql(sql).tables.find((table) => table.tableName === tableName);
  expect(found, `${tableName} が読み取れていない`).toBeDefined();
  return found as TableInspection;
}

/** 実際の移行ファイル × そのファイルが作る表。**判定の単位はこの組である**（規則13）。 */
const tableCases: [string, string, TableInspection][] = migrationSqlFiles.flatMap(
  ([fileName, sql]) =>
    inspectMigrationSql(sql).tables.map((table): [string, string, TableInspection] => [
      fileName,
      table.tableName,
      table,
    ]),
);

/**
 * 関数だけを通す表（`authenticated` から `revoke all` されている表）と、それ以外の普通の表に
 * 分ける（B-73 設計 規則12 / ADR-087 決定3）。普通の表への要求（4点）は今のまま。
 */
const functionOnlyTableCases = tableCases.filter(
  ([, , table]) => table.revokesAllFromAuthenticated,
);
const regularTableCases = tableCases.filter(([, , table]) => !table.revokesAllFromAuthenticated);

const eachTable = it.each(regularTableCases);
const eachFunctionOnlyTable = it.each(functionOnlyTableCases);

describe('表を作るマイグレーション', () => {
  it('表を1つも作らない SQL からは表が1件も読み取れない', () => {
    // 規則13 / 5章: 表の一覧そのものが「表を作っているか」を表す。ポリシーだけの
    // ファイルで表が読み取れると、下の走査が「作っていない表」を守ったことになる。
    const policyOnlySql = `create policy "a_select" on "a" for select to authenticated using (true);`;

    expect(inspectMigrationSql(policyOnlySql).tables).toEqual([]);
  });

  it('4つの表を作る SQL からは4つの表が名前で読み取れる', () => {
    // 規則13・14: 1ファイルに4表を置く（規則12: 移行は1タスク1ファイルのまま）。
    const fourTablesSql = [
      tableSql('meals'),
      tableSql('meal_ingredients'),
      tableSql('cooking_steps'),
      tableSql('cooking_records'),
    ].join('\n');

    const tableNames = inspectMigrationSql(fourTablesSql).tables.map((table) => table.tableName);

    expect([...tableNames].sort()).toEqual([
      'cooking_records',
      'cooking_steps',
      'meal_ingredients',
      'meals',
    ]);
  });

  it('4表のうち1つからポリシーを1本落とすと、その表だけが足りない表になる', () => {
    // **この周の主題そのもの**（B-44 設計 11章 / NFR-09）。ファイル全体への真偽で
    // 読むと、他の3表が delete ポリシーを持っているせいで cooking_records の欠けが
    // 素通りする。
    const missingOnePolicySql = [
      tableSql('meals'),
      tableSql('meal_ingredients'),
      tableSql('cooking_steps'),
      tableSql('cooking_records', { policyOperations: ['select', 'insert', 'update'] }),
    ].join('\n');

    expect(tableNamed(missingOnePolicySql, 'cooking_records').missing).not.toEqual([]);
    expect(tableNamed(missingOnePolicySql, 'meals').missing).toEqual([]);
    expect(tableNamed(missingOnePolicySql, 'meal_ingredients').missing).toEqual([]);
    expect(tableNamed(missingOnePolicySql, 'cooking_steps').missing).toEqual([]);
  });

  it('2つ目の表の行レベルセキュリティを有効にしなければ、その表だけが足りない表になる', () => {
    // 規則13 / ADR-029 決定2
    const sql = [tableSql('a'), tableSql('b', { enablesRowLevelSecurity: false })].join('\n');

    expect(tableNamed(sql, 'b').enablesRowLevelSecurity).toBe(false);
    expect(tableNamed(sql, 'b').missing).not.toEqual([]);
    expect(tableNamed(sql, 'a').missing).toEqual([]);
  });

  it('2つ目の表の行レベルセキュリティを強制しなければ、その表だけが足りない表になる', () => {
    // 規則13 / ADR-029 決定3(b): 表の所有者ロールで繋がざるをえない場合にも効かせる重ね掛け。
    const sql = [tableSql('a'), tableSql('b', { forcesRowLevelSecurity: false })].join('\n');

    expect(tableNamed(sql, 'b').forcesRowLevelSecurity).toBe(false);
    expect(tableNamed(sql, 'b').missing).not.toEqual([]);
    expect(tableNamed(sql, 'a').missing).toEqual([]);
  });

  it('2つ目の表から anon の権限を取り上げなければ、その表だけが足りない表になる', () => {
    // 規則13 / NFR-09
    const sql = [tableSql('a'), tableSql('b', { revokesAllFromAnon: false })].join('\n');

    expect(tableNamed(sql, 'b').revokesAllFromAnon).toBe(false);
    expect(tableNamed(sql, 'b').missing).not.toEqual([]);
    expect(tableNamed(sql, 'a').missing).toEqual([]);
  });

  it('2つ目の表を authenticated への grant の対象から外すと、その表だけが足りない表になる', () => {
    // 規則13 / ADR-029 決定3: 読み書きの前に set local role authenticated へ切り替える
    // ため、権限が authenticated に無い表は空振りする。
    const sql = [tableSql('a'), tableSql('b', { grantsToAuthenticated: false })].join('\n');

    expect(tableNamed(sql, 'b').operationsGrantedToAuthenticated).toEqual([]);
    expect(tableNamed(sql, 'b').missing).not.toEqual([]);
    expect(tableNamed(sql, 'a').missing).toEqual([]);
  });

  it('2つ目の表の insert ポリシーの with check は、1つ目の表のポリシーで代用されない', () => {
    // 規則13: with check を落とすことは「誰の行でも作れる」と書いたことに等しい。
    // しかも作った本人には select ポリシーで見えない。
    const sql = [tableSql('a'), tableSql('b', { insertHasWithCheck: false })].join('\n');

    expect(tableNamed(sql, 'b').policies.insert?.hasWithCheck).toBe(false);
    expect(tableNamed(sql, 'b').missing).not.toEqual([]);
  });

  it('子表が親を参照しているだけでは、親の表を名指しした文として数えない', () => {
    // 規則14: 語の出現で数えると `references "meals"` に引っ張られ、meals が
    // meal_ingredients のポリシーで満たされたことになる。
    const referencingSql = [
      'create table "meals" ("id" uuid primary key, "household_id" uuid not null,',
      '  constraint "meals_id_household_id_unique" unique ("id", "household_id"));',
      'create table "meal_ingredients" ("meal_id" uuid not null, "household_id" uuid not null,',
      '  constraint "meal_ingredients_meal_id_household_id_fk"',
      '  foreign key ("meal_id", "household_id") references "meals" ("id", "household_id"));',
      guardSql('meal_ingredients'),
    ].join('\n');

    expect(tableNamed(referencingSql, 'meals').missing).not.toEqual([]);
  });

  it('引用符とスキーマ修飾の違いは同じ表として数える', () => {
    // 規則14: 生成物は `CREATE TABLE "meals"`、手で足す側は `alter table meals` と
    // 書きうる。別の表と読むと、どちらの表も4点が欠けたことになる。
    const mixedQuotingSql = [
      'create table public."meals" ("id" uuid primary key);',
      'alter table meals enable row level security;',
    ].join('\n');

    const tables = inspectMigrationSql(mixedQuotingSql).tables;

    expect(tables.map((table) => table.tableName)).toEqual(['meals']);
    expect(tableNamed(mixedQuotingSql, 'meals').enablesRowLevelSecurity).toBe(true);
  });

  it('grant が表をカンマで並べていれば、並んだ表すべてに数える', () => {
    // 規則14: `on` の後ろがカンマ区切りなら並んだ表すべてに数える。
    const sharedGrantSql = [
      'create table "a" ("id" uuid primary key);',
      'create table "b" ("id" uuid primary key);',
      'grant select, insert, update, delete on "a", "b" to authenticated;',
    ].join('\n');

    expect(tableNamed(sharedGrantSql, 'a').operationsGrantedToAuthenticated).toEqual([
      'select',
      'insert',
      'update',
      'delete',
    ]);
    expect(tableNamed(sharedGrantSql, 'b').operationsGrantedToAuthenticated).toEqual([
      'select',
      'insert',
      'update',
      'delete',
    ]);
  });

  it('revoke が表をカンマで並べていれば、並んだ表すべてに数える', () => {
    // 規則14 / NFR-09
    const sharedRevokeSql = [
      'create table "a" ("id" uuid primary key);',
      'create table "b" ("id" uuid primary key);',
      'revoke all on "a", "b" from anon;',
    ].join('\n');

    expect(tableNamed(sharedRevokeSql, 'a').revokesAllFromAnon).toBe(true);
    expect(tableNamed(sharedRevokeSql, 'b').revokesAllFromAnon).toBe(true);
  });

  it('コメントに書かれただけの語では表の4点を満たしたことにならない', () => {
    // 規則9b: 照合の前に SQL コメント（`--` 以降）を落とす。落とさないと、
    // force row level security を消したあと「後で足す」と書くだけで緑に戻り、
    // 守りが自分で穴を開ける。
    const commentOnlySql = [
      'create table public.meals (id uuid primary key);',
      '-- force row level security を後で足す',
    ].join('\n');

    expect(tableNamed(commentOnlySql, 'meals').missing).not.toEqual([]);
  });

  it('有効化・anon と authenticated からの取り上げ・ポリシー0本・grant 0 の揃った表は、関数だけを通す表として足りない点が無い', () => {
    // B-73 設計 規則3・12 / ADR-087 決定3: 2表は authenticated に直接触らせず、関数だけが読み書きする。
    const sql = functionOnlyTableSql('a');

    expect(tableNamed(sql, 'a').missing).toEqual([]);
  });

  it('関数だけを通す表でも、行レベルセキュリティを有効にしなければ足りない表になる', () => {
    // B-73 設計 規則3・12
    const sql = functionOnlyTableSql('a', { enablesRowLevelSecurity: false });

    expect(tableNamed(sql, 'a').missing).not.toEqual([]);
  });

  it('関数だけを通す表でも、anon から取り上げなければ足りない表になる', () => {
    // B-73 設計 規則3・12 / NFR-09: `revoke all on "a" from authenticated` だけでは足りない。
    const sql = functionOnlyTableSql('a', { revokesAllFromAnon: false });

    expect(tableNamed(sql, 'a').missing).not.toEqual([]);
  });

  it('関数だけを通す表にポリシーを1本でも置けば、足りない表になる', () => {
    // B-73 設計 規則3・12 / ADR-087 決定3: ポリシーを置けば authenticated の読み書きの口が開きうる。
    const sql = functionOnlyTableSql('a', { policyOperations: ['select'] });

    expect(tableNamed(sql, 'a').missing).not.toEqual([]);
  });

  it('関数だけを通す表でも、authenticated への grant があれば足りない表になる', () => {
    // B-73 設計 規則3・12 / ADR-087 決定3
    const sql = functionOnlyTableSql('a', { grantsToAuthenticated: true });

    expect(tableNamed(sql, 'a').missing).not.toEqual([]);
  });

  it('authenticated から取り上げていない表にポリシーが無ければ、今のまま足りない表になる', () => {
    // B-73 設計 規則12: 例外は authenticated から revoke all された表だけに効く。
    const sql = functionOnlyTableSql('a', { revokesAllFromAuthenticated: false });

    expect(tableNamed(sql, 'a').missing).not.toEqual([]);
  });

  it('関数だけを通す表を強制すると、足りない表になる', () => {
    // B-73 設計 規則3・12 / ADR-087 決定3: 強制すると所有者である関数自身が0行しか読めない。
    // ローカルの postgres は superuser で強制を受けないため、DB の側の振る舞いでは見えない。
    const sql = functionOnlyTableSql('a', { forcesRowLevelSecurity: true });

    expect(tableNamed(sql, 'a').missing).not.toEqual([]);
  });

  it('1ファイルに関数だけを通す表と普通の表を並べても、authenticated からの取り上げは名指しした表にだけ効く', () => {
    // B-73 設計 規則12 / B-44 設計 規則13: 判定は表ごと。b は a と同じ形だが authenticated から
    // 取り上げていないので、ポリシーも grant も無い表として足りない。
    const sql = [
      functionOnlyTableSql('a'),
      functionOnlyTableSql('b', { revokesAllFromAuthenticated: false }),
    ].join('\n');

    expect(tableNamed(sql, 'a').missing).toEqual([]);
    expect(tableNamed(sql, 'b').missing).not.toEqual([]);
  });

  it('revoke がロールをカンマで並べていれば、authenticated, anon の順でもすべてから取り上げたと数える', () => {
    // B-73 設計 規則12 / 規則14: `from` の後ろがカンマ区切りなら並んだロールすべてに数える。
    const sql = [
      'create table "a" ("id" uuid primary key);',
      'alter table "a" enable row level security;',
      'revoke all on "a" from authenticated, anon;',
    ].join('\n');

    expect(tableNamed(sql, 'a').revokesAllFromAnon).toBe(true);
    expect(tableNamed(sql, 'a').revokesAllFromAuthenticated).toBe(true);
  });

  it('実際の移行ファイルで関数だけを通す表と読み取られるのは household_invitations と household_members だけである', () => {
    // B-73 設計 規則3・12 / ADR-087 決定3: 例外が他の表に広がっていないこと。
    const tableNames = functionOnlyTableCases.map(([, tableName]) => tableName);

    expect([...tableNames].sort()).toEqual(['household_invitations', 'household_members']);
  });

  eachFunctionOnlyTable('%s の %s は関数だけを通す表として足りない点が無い', (_f, _t, table) => {
    // B-73 設計 規則3・12 / ADR-087 決定3
    expect(table.missing).toEqual([]);
  });

  it('表を作るマイグレーションから表が少なくとも1つ見つかる', () => {
    // 走査が空振りすると以下がすべて素通りし、守りが消えたことに誰も気づけない。
    expect(tableCases.length).toBeGreaterThan(0);
  });

  eachTable('%s の %s は同じファイルで行レベルセキュリティを有効にする', (_f, _t, table) => {
    // 規則5(a) / 規則13
    expect(table.enablesRowLevelSecurity).toBe(true);
  });

  eachTable('%s の %s は同じファイルで行レベルセキュリティを強制する', (_f, _t, table) => {
    // 規則5(b)・6: 表の所有者ロールで繋がざるをえない場合に RLS が素通りするのを塞ぐ。
    expect(table.forcesRowLevelSecurity).toBe(true);
  });

  eachTable('%s の %s は authenticated 向けの select ポリシーを持つ', (_f, _t, table) => {
    // 規則5(c)
    expect(table.policies.select?.targetRoles).toEqual(['authenticated']);
  });

  eachTable('%s の %s は authenticated 向けの insert ポリシーを持つ', (_f, _t, table) => {
    // 規則5(c)
    expect(table.policies.insert?.targetRoles).toEqual(['authenticated']);
  });

  eachTable('%s の %s は authenticated 向けの update ポリシーを持つ', (_f, _t, table) => {
    // 規則5(c)
    expect(table.policies.update?.targetRoles).toEqual(['authenticated']);
  });

  eachTable('%s の %s は authenticated 向けの delete ポリシーを持つ', (_f, _t, table) => {
    // 規則5(c)
    expect(table.policies.delete?.targetRoles).toEqual(['authenticated']);
  });

  eachTable('%s の %s の insert ポリシーは with check を持つ', (_f, _t, table) => {
    // 落とすと他世帯の行を作れる。しかも作った本人には select ポリシーで見えない。
    expect(table.policies.insert?.hasWithCheck).toBe(true);
  });

  eachTable('%s の %s の update ポリシーは using を持つ', (_f, _t, table) => {
    // 無いと他世帯の行を掴める。
    expect(table.policies.update?.hasUsing).toBe(true);
  });

  eachTable('%s の %s の update ポリシーは with check を持つ', (_f, _t, table) => {
    // 無いと自分の行を他世帯へ移せる。
    expect(table.policies.update?.hasWithCheck).toBe(true);
  });

  eachTable('%s の %s は anon からすべての権限を取り上げる', (_f, _t, table) => {
    // 規則5(d) / NFR-09
    expect(table.revokesAllFromAnon).toBe(true);
  });

  eachTable('%s の %s は authenticated に4つの操作を許可する', (_f, _t, table) => {
    // 規則5(d)・7: 接続ロールは set local role authenticated に切り替えて読み書きするため、
    // 権限は authenticated に付いていれば足りる。
    expect(table.operationsGrantedToAuthenticated).toEqual([
      'select',
      'insert',
      'update',
      'delete',
    ]);
  });

  it('生成の土台（meta/_journal.json）がコミットされている', () => {
    // 規則8・9c: drizzle-kit generate は snapshot との差分だけを新しいファイルに書く。
    // 手で足した RLS が消える筋は「snapshot ごと捨てて 0000 から作り直す」場合だけであり、
    // journal がリポジトリに在ることがその一次の防波堤になる。
    expect(migrationMetaFileNames).toContain('_journal.json');
  });
});
