/**
 * マイグレーションの SQL を1件ぶん受け取り、**そのファイルが作る表ごとに**
 * 行レベルセキュリティの4点（有効化・強制・4ポリシー・権限）が在るかを読み取る純関数
 * （B-07c 設計 規則9・9b / B-44 設計 規則13・14）。
 *
 * 見るのは「表を作るファイルに RLS が同居していること」の1点だけである。ポリシーの
 * 述語が正しいか（`household_id = (select auth.uid())`）は実 DB に対して B-07b と
 * B-44 が見る。
 *
 * **判定の単位は表である**（B-44 設計 規則13 / ADR-029 結果8）。ファイル全体への真偽で
 * 読むと、1ファイルに2つ目の表を足したときに2表目が素通りする。
 *
 * **表の名前は位置で読む**（同 規則14）。`create table <名>` / `alter table <名>` /
 * `create policy … on <名>` / `grant … on <名の並び> to` / `revoke … on <名の並び> from`。
 * 語の出現で数えると `references "meals"` に引っ張られる。引用符とスキーマ修飾は
 * 落としてから比べ、`on` の後ろがカンマ区切りなら並んだ表すべてに数える。
 *
 * **照合の前に SQL コメント（`--` 以降）を落とすこと。** 落とさないと
 * `force row level security` を消したあと「後で足す」とコメントに書くだけで緑に戻り、
 * 守りが自分で穴を開ける。小文字に揃えることも要る — `drizzle-kit` は
 * `CREATE TABLE "stock_items"` と大文字で吐き、手書きの部分は小文字である。
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

/** 1つの表についての読み取り（B-44 設計 5章）。 */
export type TableInspection = {
  /** 引用符とスキーマ修飾（`public.`）を落とした名前。 */
  readonly tableName: string;
  readonly enablesRowLevelSecurity: boolean;
  readonly forcesRowLevelSecurity: boolean;
  readonly policies: { readonly [K in Operation]: PolicyInspection | null };
  readonly revokesAllFromAnon: boolean;
  readonly operationsGrantedToAuthenticated: readonly Operation[];
  /** この表に足りない点の名前。空ならこの表の4点が揃っている。 */
  readonly missing: readonly string[];
};

/**
 * **表の一覧そのものが「表を作っているか」を表す**（B-44 設計 5章）。空なら表を
 * 作らないファイルである。並び順は約束しない — 引くのは `tableName` である。
 */
export type MigrationInspection = {
  readonly tables: readonly TableInspection[];
};

const OPERATIONS: readonly Operation[] = ['select', 'insert', 'update', 'delete'];

/** 引用符付き・無しのどちらでも書ける識別子。スキーマ修飾は `.` で繋がる。 */
const IDENTIFIER = String.raw`(?:"[^"]+"|[a-z0-9_$]+)`;
/** スキーマ修飾ごと1つの塊として捕まえる。落とすのは `unqualify` の仕事。 */
const TABLE_REFERENCE = String.raw`(${IDENTIFIER}(?:\s*\.\s*${IDENTIFIER})*)`;

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

/**
 * 引用符とスキーマ修飾（`public.`）を落とす（規則14）。落とさないと
 * `create table public."meals"` と `alter table meals` が別の表になり、**どちらの表も
 * 4点が欠けたことになる。**
 */
function unqualify(tableReference: string): string {
  const parts = tableReference.replaceAll('"', '').split('.');
  return (parts[parts.length - 1] ?? '').trim();
}

/** 文の先頭の語（`create table` / `alter table` …）に続く表の名前。**位置で読む**（規則14）。 */
function tableNameAfter(statement: string, keyword: RegExp): string | null {
  const matched = new RegExp(`${keyword.source}\\s+${TABLE_REFERENCE}`).exec(statement);
  return matched === null ? null : unqualify(matched[1] ?? '');
}

/** `on` と終端の語（`to` / `from`）に挟まれたカンマ区切りの表の並び（規則14）。 */
function tableNamesBetween(statement: string, head: RegExp, tail: RegExp): readonly string[] {
  const matched = new RegExp(
    `${head.source}\\b([\\s\\S]*?)\\bon\\b([\\s\\S]*?)${tail.source}\\b`,
  ).exec(statement);
  if (matched === null) return [];

  return (matched[2] ?? '')
    .replace(/^\s*table\s+/, '')
    .split(',')
    .map((reference) => unqualify(reference))
    .filter((tableName) => tableName !== '');
}

function readPolicy(statement: string): PolicyInspection | null {
  const operation = OPERATIONS.find((candidate) =>
    new RegExp(`\\bfor\\s+${candidate}\\b`).test(statement),
  );
  if (operation === undefined) return null;

  const rolesMatch = /\bto\s+([a-z_]+(?:\s*,\s*[a-z_]+)*)/.exec(statement);
  return {
    operation,
    targetRoles:
      rolesMatch === null ? [] : (rolesMatch[1] ?? '').split(',').map((role) => role.trim()),
    hasUsing: /\busing\s*\(/.test(statement),
    hasWithCheck: /\bwith\s+check\s*\(/.test(statement),
  };
}

/** 1つの表について読み取った途中の状態。**表ごとに閉じている**（規則13）。 */
type TableReading = {
  enablesRowLevelSecurity: boolean;
  forcesRowLevelSecurity: boolean;
  policies: { [K in Operation]: PolicyInspection | null };
  revokesAllFromAnon: boolean;
  grantedOperations: Set<Operation>;
};

function emptyReading(): TableReading {
  return {
    enablesRowLevelSecurity: false,
    forcesRowLevelSecurity: false,
    policies: { select: null, insert: null, update: null, delete: null },
    revokesAllFromAnon: false,
    grantedOperations: new Set<Operation>(),
  };
}

/** この表に足りない点の名前。空ならこの表の4点が揃っている。 */
function missingOf(reading: TableReading, grantedOperations: readonly Operation[]): string[] {
  const missing: string[] = [];

  if (!reading.enablesRowLevelSecurity) missing.push('enable row level security');
  if (!reading.forcesRowLevelSecurity) missing.push('force row level security');
  for (const operation of OPERATIONS) {
    const policy = reading.policies[operation];
    if (policy === null || !policy.targetRoles.includes('authenticated')) {
      missing.push(`${operation} ポリシー（to authenticated）`);
    }
  }
  if (reading.policies.insert !== null && !reading.policies.insert.hasWithCheck) {
    missing.push('insert ポリシーの with check');
  }
  if (reading.policies.update !== null && !reading.policies.update.hasUsing) {
    missing.push('update ポリシーの using');
  }
  if (reading.policies.update !== null && !reading.policies.update.hasWithCheck) {
    missing.push('update ポリシーの with check');
  }
  if (!reading.revokesAllFromAnon) missing.push('revoke all ... from anon');
  if (grantedOperations.length !== OPERATIONS.length) missing.push('grant ... to authenticated');

  return missing;
}

export function inspectMigrationSql(sql: string): MigrationInspection {
  const statements = normalize(sql).split(';');

  // **表を作った文だけが表を生む**（5章）。ポリシーや grant が先に現れても、
  // その表をこのファイルが作っていないなら守る対象ではない。
  const readings = new Map<string, TableReading>();
  for (const statement of statements) {
    const created = tableNameAfter(statement, /\bcreate\s+table(?:\s+if\s+not\s+exists)?/);
    if (created !== null) readings.set(created, emptyReading());
  }

  /** 作られた表を名指ししている文だけを数える（規則13）。 */
  function readingsOf(tableNames: readonly string[]): TableReading[] {
    return tableNames.flatMap((tableName) => {
      const reading = readings.get(tableName);
      return reading === undefined ? [] : [reading];
    });
  }

  for (const statement of statements) {
    const altered = tableNameAfter(statement, /\balter\s+table(?:\s+if\s+exists)?(?:\s+only)?/);
    for (const reading of readingsOf(altered === null ? [] : [altered])) {
      if (/\benable\s+row\s+level\s+security\b/.test(statement)) {
        reading.enablesRowLevelSecurity = true;
      }
      if (/\bforce\s+row\s+level\s+security\b/.test(statement)) {
        reading.forcesRowLevelSecurity = true;
      }
    }

    if (/\bcreate\s+policy\b/.test(statement)) {
      const target = tableNameAfter(
        statement,
        new RegExp(`\\bcreate\\s+policy\\s+${IDENTIFIER}\\s+on`),
      );
      const policy = readPolicy(statement);
      for (const reading of readingsOf(target === null ? [] : [target])) {
        if (policy !== null && reading.policies[policy.operation] === null) {
          reading.policies[policy.operation] = policy;
        }
      }
    }

    if (/\brevoke\s+all\b/.test(statement) && /\bfrom\s+anon\b/.test(statement)) {
      for (const reading of readingsOf(tableNamesBetween(statement, /\brevoke/, /\bfrom/))) {
        reading.revokesAllFromAnon = true;
      }
    }

    if (/\bgrant\b/.test(statement) && /\bto\s+authenticated\b/.test(statement)) {
      const privileges = /\bgrant\b([\s\S]*?)\bon\b/.exec(statement)?.[1] ?? '';
      for (const reading of readingsOf(tableNamesBetween(statement, /\bgrant/, /\bto/))) {
        for (const operation of OPERATIONS) {
          if (new RegExp(`\\b${operation}\\b`).test(privileges)) {
            reading.grantedOperations.add(operation);
          }
        }
      }
    }
  }

  const tables = [...readings].map(([tableName, reading]): TableInspection => {
    const grantedOperations = OPERATIONS.filter((operation) =>
      reading.grantedOperations.has(operation),
    );

    return {
      tableName,
      enablesRowLevelSecurity: reading.enablesRowLevelSecurity,
      forcesRowLevelSecurity: reading.forcesRowLevelSecurity,
      policies: reading.policies,
      revokesAllFromAnon: reading.revokesAllFromAnon,
      operationsGrantedToAuthenticated: grantedOperations,
      missing: missingOf(reading, grantedOperations),
    };
  });

  return { tables };
}
