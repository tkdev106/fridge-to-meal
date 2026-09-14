/**
 * マイグレーションの SQL を1件ぶん受け取り、行レベルセキュリティの4点（有効化・強制・
 * 4ポリシー・権限）が**その文字列の中に**在るかを読み取る純関数（B-07c 設計 規則9・9b）。
 *
 * 見るのは「表を作るファイルに RLS が同居していること」の1点だけである。ポリシーの
 * 述語が正しいか（`household_id = (select auth.uid())`）は実 DB に対して B-07b が見る。
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

export type MigrationInspection = {
  readonly createsTable: boolean;
  readonly enablesRowLevelSecurity: boolean;
  readonly forcesRowLevelSecurity: boolean;
  readonly policies: { readonly [K in Operation]: PolicyInspection | null };
  readonly revokesAllFromAnon: boolean;
  readonly operationsGrantedToAuthenticated: readonly Operation[];
  /** 足りない点の名前。空なら4点が揃っている。 */
  readonly missing: readonly string[];
};

const OPERATIONS: readonly Operation[] = ['select', 'insert', 'update', 'delete'];

/**
 * SQL コメント（`--` 以降）を落とし、小文字に揃える。
 *
 * **コメントを落とすことが規則9b の要**である。落とさないと `force row level security` を
 * 消したあと「後で足す」とコメントに書くだけで緑に戻り、守りが自分で穴を開ける。
 * 小文字化は `drizzle-kit` が `CREATE TABLE "stock_items"` と大文字で吐き、手書きが
 * 小文字であるため。どちらでも同じ判定になる。
 */
function normalize(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').toLowerCase();
}

function readPolicy(statements: readonly string[], operation: Operation): PolicyInspection | null {
  const matched = statements.find(
    (statement) =>
      /\bcreate\s+policy\b/.test(statement) &&
      new RegExp(`\\bfor\\s+${operation}\\b`).test(statement),
  );
  if (matched === undefined) return null;

  const rolesMatch = /\bto\s+([a-z_]+(?:\s*,\s*[a-z_]+)*)/.exec(matched);
  return {
    operation,
    targetRoles:
      rolesMatch === null ? [] : (rolesMatch[1] ?? '').split(',').map((role) => role.trim()),
    hasUsing: /\busing\s*\(/.test(matched),
    hasWithCheck: /\bwith\s+check\s*\(/.test(matched),
  };
}

/** `grant ... on ... to authenticated` で許された操作。規則5(d)・7。 */
function readGrantedOperations(statements: readonly string[]): readonly Operation[] {
  const granted = new Set<Operation>();

  for (const statement of statements) {
    if (!/\bgrant\b/.test(statement) || !/\bto\s+authenticated\b/.test(statement)) continue;
    const privilegeClause = /\bgrant\b([\s\S]*?)\bon\b/.exec(statement)?.[1] ?? '';
    for (const operation of OPERATIONS) {
      if (new RegExp(`\\b${operation}\\b`).test(privilegeClause)) granted.add(operation);
    }
  }

  return OPERATIONS.filter((operation) => granted.has(operation));
}

export function inspectMigrationSql(sql: string): MigrationInspection {
  const normalizedSql = normalize(sql);
  const statements = normalizedSql.split(';');

  const policies = {
    select: readPolicy(statements, 'select'),
    insert: readPolicy(statements, 'insert'),
    update: readPolicy(statements, 'update'),
    delete: readPolicy(statements, 'delete'),
  };
  const enablesRowLevelSecurity = /\benable\s+row\s+level\s+security\b/.test(normalizedSql);
  const forcesRowLevelSecurity = /\bforce\s+row\s+level\s+security\b/.test(normalizedSql);
  const revokesAllFromAnon = statements.some(
    (statement) => /\brevoke\s+all\b/.test(statement) && /\bfrom\s+anon\b/.test(statement),
  );
  const grantedOperations = readGrantedOperations(statements);

  const missing: string[] = [];
  if (!enablesRowLevelSecurity) missing.push('enable row level security');
  if (!forcesRowLevelSecurity) missing.push('force row level security');
  for (const operation of OPERATIONS) {
    const policy = policies[operation];
    if (policy === null || !policy.targetRoles.includes('authenticated')) {
      missing.push(`${operation} ポリシー（to authenticated）`);
    }
  }
  if (policies.insert !== null && !policies.insert.hasWithCheck) {
    missing.push('insert ポリシーの with check');
  }
  if (policies.update !== null && !policies.update.hasUsing) {
    missing.push('update ポリシーの using');
  }
  if (policies.update !== null && !policies.update.hasWithCheck) {
    missing.push('update ポリシーの with check');
  }
  if (!revokesAllFromAnon) missing.push('revoke all ... from anon');
  if (grantedOperations.length !== OPERATIONS.length) missing.push('grant ... to authenticated');

  return {
    createsTable: /\bcreate\s+table\b/.test(normalizedSql),
    enablesRowLevelSecurity,
    forcesRowLevelSecurity,
    policies,
    revokesAllFromAnon,
    operationsGrantedToAuthenticated: grantedOperations,
    missing,
  };
}
