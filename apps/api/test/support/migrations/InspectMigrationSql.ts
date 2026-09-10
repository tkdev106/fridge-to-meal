/**
 * マイグレーションの SQL を1件ぶん受け取り、行レベルセキュリティの4点（有効化・強制・
 * 4ポリシー・権限）が**その文字列の中に**在るかを読み取る純関数（B-07c 設計 規則9・9b）。
 *
 * 見るのは「表を作るファイルに RLS が同居していること」の1点だけである。ポリシーの
 * 述語が正しいか（`household_id = (select auth.uid())`）は実 DB に対して B-07b が見る。
 *
 * 純関数にしてあるのは、テスト自身がこの読み取りを検分できるようにするため（規則9b）。
 */

export type 操作 = 'select' | 'insert' | 'update' | 'delete';

export type ポリシーの検分 = {
  readonly 操作: 操作;
  /** `to` に並んだロール。 */
  readonly 対象ロール: readonly string[];
  readonly usingを持つ: boolean;
  readonly withCheckを持つ: boolean;
};

export type マイグレーションの検分 = {
  readonly 表を作る: boolean;
  readonly 行レベルセキュリティを有効にする: boolean;
  readonly 行レベルセキュリティを強制する: boolean;
  readonly ポリシー: { readonly [K in 操作]: ポリシーの検分 | null };
  readonly anonから全権限を取り上げる: boolean;
  readonly authenticatedに許す操作: readonly 操作[];
  /** 足りない点の名前。空なら4点が揃っている。 */
  readonly 不足: readonly string[];
};

const 操作の並び: readonly 操作[] = ['select', 'insert', 'update', 'delete'];

/**
 * SQL コメント（`--` 以降）を落とし、小文字に揃える。
 *
 * **コメントを落とすことが規則9b の要**である。落とさないと `force row level security` を
 * 消したあと「後で足す」とコメントに書くだけで緑に戻り、守りが自分で穴を開ける。
 * 小文字化は `drizzle-kit` が `CREATE TABLE "stock_items"` と大文字で吐き、手書きが
 * 小文字であるため。どちらでも同じ判定になる。
 */
function 照合できる形にする(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').toLowerCase();
}

function ポリシーを読み取る(文: readonly string[], 対象: 操作): ポリシーの検分 | null {
  const 該当 = 文.find(
    (一文) => /\bcreate\s+policy\b/.test(一文) && new RegExp(`\\bfor\\s+${対象}\\b`).test(一文),
  );
  if (該当 === undefined) return null;

  const ロール = /\bto\s+([a-z_]+(?:\s*,\s*[a-z_]+)*)/.exec(該当);
  return {
    操作: 対象,
    対象ロール: ロール === null ? [] : (ロール[1] ?? '').split(',').map((名前) => 名前.trim()),
    usingを持つ: /\busing\s*\(/.test(該当),
    withCheckを持つ: /\bwith\s+check\s*\(/.test(該当),
  };
}

/** `grant ... on ... to authenticated` で許された操作。規則5(d)・7。 */
function authenticatedに許された操作(文: readonly string[]): readonly 操作[] {
  const 許可 = new Set<操作>();

  for (const 一文 of 文) {
    if (!/\bgrant\b/.test(一文) || !/\bto\s+authenticated\b/.test(一文)) continue;
    const 対象 = /\bgrant\b([\s\S]*?)\bon\b/.exec(一文)?.[1] ?? '';
    for (const 操作 of 操作の並び) {
      if (new RegExp(`\\b${操作}\\b`).test(対象)) 許可.add(操作);
    }
  }

  return 操作の並び.filter((操作) => 許可.has(操作));
}

export function マイグレーションを検分する(sql: string): マイグレーションの検分 {
  const 本文 = 照合できる形にする(sql);
  const 文 = 本文.split(';');

  const ポリシー = {
    select: ポリシーを読み取る(文, 'select'),
    insert: ポリシーを読み取る(文, 'insert'),
    update: ポリシーを読み取る(文, 'update'),
    delete: ポリシーを読み取る(文, 'delete'),
  };
  const 行レベルセキュリティを有効にする = /\benable\s+row\s+level\s+security\b/.test(本文);
  const 行レベルセキュリティを強制する = /\bforce\s+row\s+level\s+security\b/.test(本文);
  const anonから全権限を取り上げる = 文.some(
    (一文) => /\brevoke\s+all\b/.test(一文) && /\bfrom\s+anon\b/.test(一文),
  );
  const 許された操作 = authenticatedに許された操作(文);

  const 不足: string[] = [];
  if (!行レベルセキュリティを有効にする) 不足.push('enable row level security');
  if (!行レベルセキュリティを強制する) 不足.push('force row level security');
  for (const 操作 of 操作の並び) {
    const 一件 = ポリシー[操作];
    if (一件 === null || !一件.対象ロール.includes('authenticated')) {
      不足.push(`${操作} ポリシー（to authenticated）`);
    }
  }
  if (ポリシー.insert !== null && !ポリシー.insert.withCheckを持つ) {
    不足.push('insert ポリシーの with check');
  }
  if (ポリシー.update !== null && !ポリシー.update.usingを持つ) {
    不足.push('update ポリシーの using');
  }
  if (ポリシー.update !== null && !ポリシー.update.withCheckを持つ) {
    不足.push('update ポリシーの with check');
  }
  if (!anonから全権限を取り上げる) 不足.push('revoke all ... from anon');
  if (許された操作.length !== 操作の並び.length) 不足.push('grant ... to authenticated');

  return {
    表を作る: /\bcreate\s+table\b/.test(本文),
    行レベルセキュリティを有効にする,
    行レベルセキュリティを強制する,
    ポリシー,
    anonから全権限を取り上げる,
    authenticatedに許す操作: 許された操作,
    不足,
  };
}
