import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import type { Suggestion } from '../../src/contexts/meal/domain/entity/Suggestion.js';
import { createSuggestion } from '../../src/contexts/meal/domain/entity/Suggestion.js';
import { MealRuleViolation } from '../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { amountOf } from '../../src/contexts/meal/domain/value/Amount.js';
import { dateTimeOf } from '../../src/contexts/meal/domain/value/DateTime.js';
import { expiryDateOf } from '../../src/contexts/meal/domain/value/ExpiryDate.js';
import { mealIdOf } from '../../src/contexts/meal/domain/value/MealId.js';
import { createPantrySnapshot } from '../../src/contexts/meal/domain/value/PantrySnapshot.js';
import type { StockItem } from '../../src/contexts/meal/domain/value/StockItem.js';
import { createStockItem } from '../../src/contexts/meal/domain/value/StockItem.js';
import type {
  SuggestionEntry,
  SuggestionEntryOrigin,
} from '../../src/contexts/meal/domain/value/SuggestionEntry.js';
import { createSuggestionEntry } from '../../src/contexts/meal/domain/value/SuggestionEntry.js';
import type { SuggestionId } from '../../src/contexts/meal/domain/value/SuggestionId.js';
import { suggestionIdOf } from '../../src/contexts/meal/domain/value/SuggestionId.js';
import { SuggestionRepositoryImpl } from '../../src/contexts/meal/infrastructure/SuggestionRepositoryImpl.js';
import type { HouseholdTransaction } from '../../src/shared/infrastructure/db/HouseholdTransaction.js';
import { withHouseholdTransaction } from '../../src/shared/infrastructure/db/HouseholdTransaction.js';
import type { HouseholdId } from '../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../src/shared/domain/HouseholdId.js';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import { insertSuggestion, insertSuggestionChildRow } from '../support/db/SuggestionRows.js';
import { withTransaction } from '../support/db/WithTransaction.js';

/**
 * ローカル Postgres に対する `SuggestionRepositoryImpl` の2周目
 * （B-45 設計 規則1〜9 と 7章 / C-7 / C-9 / C-12 / C-14 / C-15 / ADR-029 / ADR-038）と、
 * 3周目の `countGeneratedByHouseholdSince`（規則10 / NFR-C2 / ADR-049 / C-4c）。
 * **`pnpm test:db` でだけ走る** — `pnpm test` は `apps/api/test/db/**` を除外する。
 *
 * 繋ぐのは `authenticator` だけ。所有者（`postgres`）の接続を使うと行レベルセキュリティが
 * 素通りし、**RLS が無くても緑になる**（先行 `mealRepository.test.ts`）。
 *
 * **トランザクションを開くのは `withHouseholdTransaction`（`shared/infrastructure/` のもの）である**
 * （B-17 で pantry から移った。本番と同じ1つの規則を通る）。
 *
 * **世帯 ID と提案 ID はケースごとに固有の固定値を使い、使い回さない。** 表は
 * `globalSetup` で1度だけ作られ、ファイルとケースをまたいで共有されるため。
 * **後片付けはしない。** 1周目の `suggestionsRls.test.ts` / `suggestionsTable.test.ts` とも
 * 先頭の並び（`6c6c6c6c`）で分けてある。並びを見るケースは世帯ごと分けており、
 * 他のケースの提案が混ざらない。
 */

/** ケース `n` の世帯。`other` は同じケースに出てくる2つ目の世帯。 */
function householdOf(caseNumber: string, other = false): HouseholdId {
  return householdIdOf(`6c6c6c6c-00${caseNumber}-4000-8000-00000000000${other ? '2' : '1'}`);
}

/** ケース `n` の提案の識別子。末尾の `a1` < `a2` < `a3` < `a4` が識別子の大小である。 */
function suggestionIdOfCase(caseNumber: string, suffix: 'a1' | 'a2' | 'a3' | 'a4'): SuggestionId {
  return suggestionIdOf(`6c6c6c6c-00${caseNumber}-4000-8000-0000000000${suffix}`);
}

/**
 * 提案の1件が指す献立の識別子。**献立の表には置かない**（設計 規則11 — 外部キーを
 * 張らないので、置かなくても保存できる）。
 */
const mealId1 = '6c6c6c6c-ffff-4000-8000-0000000000b1';
const mealId2 = '6c6c6c6c-ffff-4000-8000-0000000000b2';
const mealId3 = '6c6c6c6c-ffff-4000-8000-0000000000b3';

const olderGeneratedAt = '2026-09-21T09:00:00.000Z';
const middleGeneratedAt = '2026-09-22T09:00:00.000Z';
const newerGeneratedAt = '2026-09-23T09:00:00.000Z';
const newestGeneratedAt = '2026-09-24T09:00:00.000Z';

// 1本の接続で複数のトランザクションを張る（先行 `mealRepository.test.ts`）。
const connection = postgres(APP_CONNECTION_STRING, { max: 1 });
const db = drizzle(connection);

// 行を直接置くケースの接続。`SuggestionRows` は postgres の `TransactionSql` を取るため、
// drizzle の handle とは別に持つ。置いた行は commit してから repository で読む。
const rowConnection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await connection.end();
  await rowConnection.end();
});

/** 提案の1件を作る。由来を省けば生成（C-15）。 */
function entry(mealId: string, origin: SuggestionEntryOrigin = 'generated'): SuggestionEntry {
  return createSuggestionEntry({ mealId: mealIdOf(mealId), origin });
}

/**
 * 在庫品を1件作る。**本題でない値は省ける** — 省いた分量は `'2本'`、期限は
 * `'2026-09-25'`。`null` を渡したときだけ「無し」になる（ADR-010 / ADR-036）。
 */
function stockItem(props: {
  name: string;
  amount?: string | null;
  expiryDate?: string | null;
}): StockItem {
  return createStockItem({
    name: props.name,
    amount: amountOf(props.amount === undefined ? '2本' : props.amount),
    expiryDate: expiryDateOf(props.expiryDate === undefined ? '2026-09-25' : props.expiryDate),
  });
}

/**
 * 提案を1つ作る。既定は**生成の由来の1件1つ・在庫品1つ**で、本題だけが引数に現れる
 * 形にする（`docs/testing.md` 6章）。素のリテラルを提案として扱わず、必ずドメインの
 * 生成関数を通す（設計 規則6）。
 */
function suggestion(props: {
  id: SuggestionId;
  householdId: HouseholdId;
  entries?: readonly SuggestionEntry[];
  stockItems?: readonly StockItem[];
  generatedAt?: string;
}): Suggestion {
  return createSuggestion({
    id: props.id,
    householdId: props.householdId,
    entries: props.entries ?? [entry(mealId1)],
    pantrySnapshot: createPantrySnapshot({
      stockItems: props.stockItems ?? [stockItem({ name: 'にんじん' })],
    }),
    generatedAt: dateTimeOf(props.generatedAt ?? middleGeneratedAt),
  });
}

/** 同じ世帯の単位の中で、渡した提案を順に save する。 */
function saveAll(householdId: HouseholdId, suggestions: readonly Suggestion[]): Promise<void> {
  return withHouseholdTransaction(db, householdId, async (tx) => {
    const repository = new SuggestionRepositoryImpl(tx);
    for (const saved of suggestions) {
      await repository.save(householdId, saved);
    }
  });
}

function findRecent(householdId: HouseholdId, limit: number): Promise<Suggestion[]> {
  return withHouseholdTransaction(db, householdId, (tx) =>
    new SuggestionRepositoryImpl(tx).findRecentByHousehold(householdId, limit),
  );
}

function findLatest(householdId: HouseholdId): Promise<Suggestion | null> {
  return withHouseholdTransaction(db, householdId, (tx) =>
    new SuggestionRepositoryImpl(tx).findLatestByHousehold(householdId),
  );
}

function countGenerated(householdId: HouseholdId, since: string): Promise<number> {
  return withHouseholdTransaction(db, householdId, (tx) =>
    new SuggestionRepositoryImpl(tx).countGeneratedByHouseholdSince(householdId, dateTimeOf(since)),
  );
}

/**
 * **クレームを張らない** handle を1つ作る（`withHouseholdTransaction` には無い経路）。
 * `set local role authenticated` だけは張る — 張らないと権限エラーで落ち、確かめたい
 * 「0行」にならない（先行 `mealRepository.test.ts`）。
 */
function transactionWithoutClaims<T>(body: (tx: HouseholdTransaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role authenticated`);
    return body(tx);
  });
}

/** 実行が投げたものを返す（投げなければ `null`）。同じ実行を2度走らせないための形。 */
function failureOf(execution: Promise<unknown>): Promise<unknown> {
  return execution.then(
    () => null,
    (error: unknown) => error,
  );
}

describe('提案リポジトリの実装（保存と読み戻し）', () => {
  it('保存した提案を同じ世帯の findLatestByHousehold で読み戻せる', async () => {
    const householdId = householdOf('01');
    const saved = suggestion({
      id: suggestionIdOfCase('01', 'a1'),
      householdId,
      // 識別子の昇順でも名称の五十音順でもない並びにする — 並べ替えた実装は食い違う。
      entries: [entry(mealId2), entry(mealId1)],
      stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'たまねぎ' })],
    });
    await saveAll(householdId, [saved]);

    const found = await findLatest(householdId);

    // C-14 / 設計 規則5・6・7: 行と集約の往復が成り立つこと。
    expect(found).toEqual(saved);
  });

  it('再利用の由来の提案は再利用の由来のまま読み戻せる', async () => {
    const householdId = householdOf('02');
    await saveAll(householdId, [
      suggestion({
        id: suggestionIdOfCase('02', 'a1'),
        householdId,
        entries: [entry(mealId1, 'reused'), entry(mealId2, 'reused')],
      }),
    ]);

    const found = await findLatest(householdId);

    // C-15 / C-4c: 由来は1日の上限の数え方に効く。読み戻しで生成に化けてはいけない。
    expect(found?.entries.map((foundEntry) => foundEntry.origin)).toEqual(['reused', 'reused']);
  });

  it('生成日時はミリ秒まで同じ瞬間として読み戻せる', async () => {
    const householdId = householdOf('03');
    await saveAll(householdId, [
      suggestion({
        id: suggestionIdOfCase('03', 'a1'),
        householdId,
        generatedAt: '2026-09-22T09:00:00.123Z',
      }),
    ]);

    const found = await findLatest(householdId);

    // 設計 規則7: `timestamptz` と `toISOString()` の往復でミリ秒を落とさない。
    expect(found?.generatedAt).toBe('2026-09-22T09:00:00.123Z');
  });

  it('分量の無い在庫品は分量なしのまま読み戻せる', async () => {
    const householdId = householdOf('04');
    await saveAll(householdId, [
      suggestion({
        id: suggestionIdOfCase('04', 'a1'),
        householdId,
        stockItems: [stockItem({ name: 'にんじん', amount: null })],
      }),
    ]);

    const found = await findLatest(householdId);

    // 設計 規則7 / ADR-010: 分量の `null` は空文字にしない。
    expect(found?.pantrySnapshot.stockItems[0]?.amount).toBeNull();
  });

  it('期限の無い在庫品は期限なしのまま読み戻せる', async () => {
    const householdId = householdOf('05');
    await saveAll(householdId, [
      suggestion({
        id: suggestionIdOfCase('05', 'a1'),
        householdId,
        stockItems: [stockItem({ name: 'にんじん', expiryDate: null })],
      }),
    ]);

    const found = await findLatest(householdId);

    // 設計 規則7 / ADR-036
    expect(found?.pantrySnapshot.stockItems[0]?.expiryDate).toBeNull();
  });

  it('在庫が0件の在庫スナップショットを持つ提案も、在庫品0件のまま読み戻せる', async () => {
    const householdId = householdOf('06');
    await saveAll(householdId, [
      suggestion({ id: suggestionIdOfCase('06', 'a1'), householdId, stockItems: [] }),
    ]);

    const found = await findLatest(householdId);

    // 設計 規則9: 在庫品の行が無いことは、提案が無いことではない。
    expect(found).not.toBeNull();
    expect(found?.pantrySnapshot.stockItems).toEqual([]);
  });

  it('位置の降順に差し込んだ提案の1件の行は、位置の昇順の1件として読み戻る', async () => {
    const householdId = householdOf('07');
    const suggestionId = suggestionIdOfCase('07', 'a1');
    await withTransaction(rowConnection, householdId, async (tx) => {
      await insertSuggestion(tx, { suggestionId, householdId });
      // 差し込む順を位置の降順にする。`order by` の無い実装では、挿入した順が
      // そのまま返って赤くなる。
      await insertSuggestionChildRow(tx, 'suggestion_entries', {
        suggestionId,
        householdId,
        position: 2,
        mealId: mealId3,
      });
      await insertSuggestionChildRow(tx, 'suggestion_entries', {
        suggestionId,
        householdId,
        position: 1,
        mealId: mealId2,
      });
      await insertSuggestionChildRow(tx, 'suggestion_entries', {
        suggestionId,
        householdId,
        position: 0,
        mealId: mealId1,
      });
    });

    const found = await findLatest(householdId);

    // 設計 規則5 / C-12: 呼ぶ側が決めた並びを保つ。
    expect(found?.entries.map((foundEntry) => foundEntry.mealId)).toEqual([
      mealId1,
      mealId2,
      mealId3,
    ]);
  });

  it('位置の降順に差し込んだ在庫品の行は、位置の昇順の在庫品として読み戻る', async () => {
    const householdId = householdOf('08');
    const suggestionId = suggestionIdOfCase('08', 'a1');
    await withTransaction(rowConnection, householdId, async (tx) => {
      await insertSuggestion(tx, { suggestionId, householdId });
      await insertSuggestionChildRow(tx, 'suggestion_entries', { suggestionId, householdId });
      await insertSuggestionChildRow(tx, 'pantry_snapshot_stock_items', {
        suggestionId,
        householdId,
        position: 2,
        name: 'じゃがいも',
      });
      await insertSuggestionChildRow(tx, 'pantry_snapshot_stock_items', {
        suggestionId,
        householdId,
        position: 1,
        name: 'たまねぎ',
      });
      await insertSuggestionChildRow(tx, 'pantry_snapshot_stock_items', {
        suggestionId,
        householdId,
        position: 0,
        name: 'にんじん',
      });
    });

    const found = await findLatest(householdId);

    // 設計 規則5 / ADR-037
    expect(found?.pantrySnapshot.stockItems.map((foundItem) => foundItem.name)).toEqual([
      'にんじん',
      'たまねぎ',
      'じゃがいも',
    ]);
  });

  it('2件の提案を読み戻すと、提案の1件と在庫品はそれぞれの提案に付く', async () => {
    const householdId = householdOf('09');
    const firstId = suggestionIdOfCase('09', 'a1');
    const secondId = suggestionIdOfCase('09', 'a2');
    await saveAll(householdId, [
      suggestion({
        id: firstId,
        householdId,
        entries: [entry(mealId1)],
        stockItems: [stockItem({ name: 'にんじん' })],
        generatedAt: olderGeneratedAt,
      }),
      suggestion({
        id: secondId,
        householdId,
        entries: [entry(mealId2)],
        stockItems: [stockItem({ name: 'たまねぎ' })],
        generatedAt: newerGeneratedAt,
      }),
    ]);

    const found = await findRecent(householdId, 3);

    // 設計 規則5・6: 子の行は自分の提案に付く。世帯だけで引いて配り忘れると取り違える。
    expect(
      Object.fromEntries(
        found.map((foundSuggestion) => [
          foundSuggestion.id,
          {
            mealIds: foundSuggestion.entries.map((foundEntry) => foundEntry.mealId),
            names: foundSuggestion.pantrySnapshot.stockItems.map((foundItem) => foundItem.name),
          },
        ]),
      ),
    ).toEqual({
      [firstId]: { mealIds: [mealId1], names: ['にんじん'] },
      [secondId]: { mealIds: [mealId2], names: ['たまねぎ'] },
    });
  });

  it('提案の1件の行が1件も無い提案を読み戻すと拒む', async () => {
    const householdId = householdOf('10');
    await withTransaction(rowConnection, householdId, (tx) =>
      insertSuggestion(tx, { suggestionId: suggestionIdOfCase('10', 'a1'), householdId }),
    );

    const thrown = await failureOf(findLatest(householdId));

    // 設計 規則6 / C-15: 不変条件に反する行の組は、握りつぶさずそのまま伝わる。
    expect(thrown).toBeInstanceOf(MealRuleViolation);
    expect(thrown).toHaveProperty('rule', 'suggestion.entries.empty');
  });
});

describe('提案リポジトリの実装（並び）', () => {
  it('findRecentByHousehold は生成日時の新しい順に並べて返す', async () => {
    const householdId = householdOf('11');
    // 識別子の大小を時刻と食い違わせる（新 = a2、中 = a3、古 = a1）。識別子で並べた実装も、
    // 保存した順（中・古・新）を返す実装も赤くなる。
    await saveAll(householdId, [
      suggestion({
        id: suggestionIdOfCase('11', 'a3'),
        householdId,
        generatedAt: middleGeneratedAt,
      }),
      suggestion({
        id: suggestionIdOfCase('11', 'a1'),
        householdId,
        generatedAt: olderGeneratedAt,
      }),
      suggestion({
        id: suggestionIdOfCase('11', 'a2'),
        householdId,
        generatedAt: newerGeneratedAt,
      }),
    ]);

    const found = await findRecent(householdId, 3);

    // 設計 規則3 / ADR-038 決定1
    expect(found.map((foundSuggestion) => foundSuggestion.id)).toEqual([
      '6c6c6c6c-0011-4000-8000-0000000000a2',
      '6c6c6c6c-0011-4000-8000-0000000000a3',
      '6c6c6c6c-0011-4000-8000-0000000000a1',
    ]);
  });

  it('findRecentByHousehold は生成日時が同じ提案を識別子の降順に並べて返す', async () => {
    const householdId = householdOf('12');
    await saveAll(householdId, [
      suggestion({ id: suggestionIdOfCase('12', 'a1'), householdId }),
      suggestion({ id: suggestionIdOfCase('12', 'a3'), householdId }),
      suggestion({ id: suggestionIdOfCase('12', 'a2'), householdId }),
    ]);

    const found = await findRecent(householdId, 3);

    // ADR-038 決定2 / C-12: 同じ入力で順序が変わらない（同時刻を閉じる）。
    expect(found.map((foundSuggestion) => foundSuggestion.id)).toEqual([
      '6c6c6c6c-0012-4000-8000-0000000000a3',
      '6c6c6c6c-0012-4000-8000-0000000000a2',
      '6c6c6c6c-0012-4000-8000-0000000000a1',
    ]);
  });

  it('limit を超えて保存されていても、新しいほうから limit 件だけ返す', async () => {
    const householdId = householdOf('13');
    // 最古に最大の識別子を持たせる。識別子で絞った実装なら最古が残る。
    await saveAll(householdId, [
      suggestion({
        id: suggestionIdOfCase('13', 'a4'),
        householdId,
        generatedAt: olderGeneratedAt,
      }),
      suggestion({
        id: suggestionIdOfCase('13', 'a1'),
        householdId,
        generatedAt: middleGeneratedAt,
      }),
      suggestion({
        id: suggestionIdOfCase('13', 'a3'),
        householdId,
        generatedAt: newerGeneratedAt,
      }),
      suggestion({
        id: suggestionIdOfCase('13', 'a2'),
        householdId,
        generatedAt: newestGeneratedAt,
      }),
    ]);

    const found = await findRecent(householdId, 3);

    // ADR-038: 限って取るのは新しいほうから。
    expect(found.map((foundSuggestion) => foundSuggestion.id)).toEqual([
      '6c6c6c6c-0013-4000-8000-0000000000a2',
      '6c6c6c6c-0013-4000-8000-0000000000a3',
      '6c6c6c6c-0013-4000-8000-0000000000a1',
    ]);
  });

  it('limit の境目で生成日時が同じなら、識別子の大きいほうを残す', async () => {
    const householdId = householdOf('14');
    // 古い1件に最大の識別子を持たせる。時刻を見ない実装ならそれが残る。
    await saveAll(householdId, [
      suggestion({
        id: suggestionIdOfCase('14', 'a2'),
        householdId,
        generatedAt: newerGeneratedAt,
      }),
      suggestion({
        id: suggestionIdOfCase('14', 'a1'),
        householdId,
        generatedAt: newerGeneratedAt,
      }),
      suggestion({
        id: suggestionIdOfCase('14', 'a3'),
        householdId,
        generatedAt: olderGeneratedAt,
      }),
    ]);

    const found = await findRecent(householdId, 1);

    // ADR-038 決定2: 境目で同時刻が並んでも、どちらを残すかは決まっている。
    expect(found.map((foundSuggestion) => foundSuggestion.id)).toEqual([
      '6c6c6c6c-0014-4000-8000-0000000000a2',
    ]);
  });

  it('提案が1件も無い世帯には findRecentByHousehold が空の配列を返す', async () => {
    const found = await findRecent(householdOf('15'), 3);

    // 設計 7章: 0件は空の配列。`null` でも例外でもない。
    expect(found).toEqual([]);
  });

  it('findLatestByHousehold は生成日時が最も新しい提案を返す', async () => {
    const householdId = householdOf('16');
    // 新しいほうを先に保存し、識別子も小さくする。保存した順の末尾を取る実装も、
    // 識別子の大きいほうを取る実装も赤くなる。
    await saveAll(householdId, [
      suggestion({
        id: suggestionIdOfCase('16', 'a1'),
        householdId,
        generatedAt: newerGeneratedAt,
      }),
      suggestion({
        id: suggestionIdOfCase('16', 'a2'),
        householdId,
        generatedAt: olderGeneratedAt,
      }),
    ]);

    const found = await findLatest(householdId);

    // 設計 規則4 / C-7: 在庫スナップショットを比べる相手は最新の1件。
    expect(found?.id).toBe('6c6c6c6c-0016-4000-8000-0000000000a1');
  });

  it('findLatestByHousehold は生成日時が同じとき識別子の大きいほうを返す', async () => {
    const householdId = householdOf('17');
    await saveAll(householdId, [
      suggestion({ id: suggestionIdOfCase('17', 'a2'), householdId }),
      suggestion({ id: suggestionIdOfCase('17', 'a1'), householdId }),
    ]);

    const found = await findLatest(householdId);

    // ADR-038 決定2: 「最新」の決め方は findRecentByHousehold と同じ。
    expect(found?.id).toBe('6c6c6c6c-0017-4000-8000-0000000000a2');
  });

  it('提案が1件も無い世帯では findLatestByHousehold が null を返す', async () => {
    const found = await findLatest(householdOf('18'));

    // 設計 7章
    expect(found).toBeNull();
  });
});

describe('提案リポジトリの実装（世帯の分離）', () => {
  it('他世帯が保存した提案は findRecentByHousehold に含まれない', async () => {
    const ownHouseholdId = householdOf('19');
    const otherHouseholdId = householdOf('19', true);
    await saveAll(ownHouseholdId, [
      suggestion({
        id: suggestionIdOfCase('19', 'a1'),
        householdId: ownHouseholdId,
        generatedAt: olderGeneratedAt,
      }),
      suggestion({
        id: suggestionIdOfCase('19', 'a2'),
        householdId: ownHouseholdId,
        generatedAt: middleGeneratedAt,
      }),
    ]);
    await saveAll(otherHouseholdId, [
      suggestion({
        id: suggestionIdOfCase('19', 'a3'),
        householdId: otherHouseholdId,
        generatedAt: newerGeneratedAt,
      }),
    ]);

    const found = await findRecent(ownHouseholdId, 3);

    // C-9 / NFR-09: 世帯をまたぐ取得を許さない。
    expect(found.map((foundSuggestion) => foundSuggestion.id)).toEqual([
      '6c6c6c6c-0019-4000-8000-0000000000a2',
      '6c6c6c6c-0019-4000-8000-0000000000a1',
    ]);
  });

  it('他世帯の提案のほうが新しくても、findLatestByHousehold は自世帯の最新を返す', async () => {
    const ownHouseholdId = householdOf('20');
    const otherHouseholdId = householdOf('20', true);
    await saveAll(ownHouseholdId, [
      suggestion({
        id: suggestionIdOfCase('20', 'a1'),
        householdId: ownHouseholdId,
        generatedAt: olderGeneratedAt,
      }),
      suggestion({
        id: suggestionIdOfCase('20', 'a2'),
        householdId: ownHouseholdId,
        generatedAt: middleGeneratedAt,
      }),
    ]);
    await saveAll(otherHouseholdId, [
      suggestion({
        id: suggestionIdOfCase('20', 'a3'),
        householdId: otherHouseholdId,
        generatedAt: newerGeneratedAt,
      }),
    ]);

    const found = await findLatest(ownHouseholdId);

    // C-9 / C-7: 他世帯の在庫スナップショットと比べてはいけない。
    expect(found?.id).toBe('6c6c6c6c-0020-4000-8000-0000000000a2');
  });

  it('クレームで見えている提案でも、引数の世帯が食い違えば findRecentByHousehold は空になる', async () => {
    const claimedHouseholdId = householdOf('21');
    const passedHouseholdId = householdOf('21', true);

    const found = await withHouseholdTransaction(db, claimedHouseholdId, async (tx) => {
      const repository = new SuggestionRepositoryImpl(tx);
      await repository.save(
        claimedHouseholdId,
        suggestion({ id: suggestionIdOfCase('21', 'a1'), householdId: claimedHouseholdId }),
      );
      // 設計 規則2: RLS で見えていても、引数の世帯で必ず絞る（網は二重）。
      return repository.findRecentByHousehold(passedHouseholdId, 3);
    });

    // C-9
    expect(found).toEqual([]);
  });

  it('クレームで見えている提案でも、引数の世帯が食い違えば findLatestByHousehold は null になる', async () => {
    const claimedHouseholdId = householdOf('22');
    const passedHouseholdId = householdOf('22', true);

    const found = await withHouseholdTransaction(db, claimedHouseholdId, async (tx) => {
      const repository = new SuggestionRepositoryImpl(tx);
      await repository.save(
        claimedHouseholdId,
        suggestion({ id: suggestionIdOfCase('22', 'a1'), householdId: claimedHouseholdId }),
      );
      // 設計 規則2
      return repository.findLatestByHousehold(passedHouseholdId);
    });

    // C-9
    expect(found).toBeNull();
  });

  it('引数の世帯と提案の世帯が食い違う save を拒む', async () => {
    const argumentHouseholdId = householdOf('23');
    const suggestionSideHouseholdId = householdOf('23', true);

    const thrown = await failureOf(
      withHouseholdTransaction(db, argumentHouseholdId, (tx) =>
        new SuggestionRepositoryImpl(tx).save(
          argumentHouseholdId,
          suggestion({
            id: suggestionIdOfCase('23', 'a1'),
            householdId: suggestionSideHouseholdId,
          }),
        ),
      ),
    );

    // C-9 / 設計 7章: RLS の拒否に任せない — 任せると `rule` の付かない別の失敗になる。
    expect(thrown).toBeInstanceOf(MealRuleViolation);
    expect(thrown).toHaveProperty('rule', 'save.householdMismatch');
  });

  it('食い違う save は1行も書かない', async () => {
    const argumentHouseholdId = householdOf('24');
    const suggestionSideHouseholdId = householdOf('24', true);

    const foundByArgumentHousehold = await withHouseholdTransaction(
      db,
      argumentHouseholdId,
      async (tx) => {
        const repository = new SuggestionRepositoryImpl(tx);

        // 拒否は**同じトランザクションの中で**捕まえる。外で捕まえると単位が終わって
        // しまい、「1行も書いていない」ことが見えない（設計 7章）。
        const thrown = await failureOf(
          repository.save(
            argumentHouseholdId,
            suggestion({
              id: suggestionIdOfCase('24', 'a1'),
              householdId: suggestionSideHouseholdId,
            }),
          ),
        );
        expect(thrown).toBeInstanceOf(MealRuleViolation);

        // RLS に任せた実装なら、拒まれた文でトランザクションが中断していて、
        // この問い合わせ自体が落ちる。
        return repository.findLatestByHousehold(argumentHouseholdId);
      },
    );

    const foundBySuggestionSideHousehold = await findLatest(suggestionSideHouseholdId);

    expect(foundByArgumentHousehold).toBeNull();
    // 提案側の世帯にも行は残らない（**書かれていない**ことの裏取り）。
    expect(foundBySuggestionSideHousehold).toBeNull();
  });
});

describe('提案リポジトリの実装（2度目の save と DB の拒否）', () => {
  it('同じ識別子の提案を2度 save すると失敗し、規則違反にはならない', async () => {
    const householdId = householdOf('25');
    const saved = suggestion({ id: suggestionIdOfCase('25', 'a1'), householdId });
    await saveAll(householdId, [saved]);

    const thrown = await failureOf(saveAll(householdId, [saved]));

    // 設計 規則8 / ADR-057 理由(3): 提案は生成後に完全に不変。2度目は親の主キーが拒み、
    // その失敗を**ドメインの例外型に包み直さない**。
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(MealRuleViolation);
  });

  it('同じ識別子で中身の増えた2度目の save の後も、読み戻す提案は最初に保存したままである', async () => {
    const householdId = householdOf('26');
    const suggestionId = suggestionIdOfCase('26', 'a1');
    const first = suggestion({
      id: suggestionId,
      householdId,
      entries: [entry(mealId1)],
      stockItems: [stockItem({ name: 'にんじん' })],
    });
    await saveAll(householdId, [first]);

    await failureOf(
      saveAll(householdId, [
        suggestion({
          id: suggestionId,
          householdId,
          entries: [entry(mealId1), entry(mealId2)],
          stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'たまねぎ' })],
        }),
      ]),
    );

    const found = await findLatest(householdId);

    // 設計 規則8 / C-14: 子表の主キーは `(suggestion_id, position)` なので、`on conflict`
    // で飛ばす実装だと増えた位置だけが入り、1度目にも2度目にも無い提案ができる。
    expect(found).toEqual(first);
  });

  it('他世帯の提案と識別子が衝突する save は失敗し、規則違反にはならない', async () => {
    const ownerHouseholdId = householdOf('27');
    const colliderHouseholdId = householdOf('27', true);
    const suggestionId = suggestionIdOfCase('27', 'a1');
    await saveAll(ownerHouseholdId, [
      suggestion({ id: suggestionId, householdId: ownerHouseholdId }),
    ]);

    const thrown = await failureOf(
      saveAll(colliderHouseholdId, [
        suggestion({ id: suggestionId, householdId: colliderHouseholdId }),
      ]),
    );

    // 設計 7章: DB の一意制約の失敗をそのまま伝える（SQLSTATE は期待値に書かない）。
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(MealRuleViolation);
  });

  it('識別子が衝突した save の後も、相手世帯の提案は元のままである', async () => {
    const ownerHouseholdId = householdOf('28');
    const colliderHouseholdId = householdOf('28', true);
    const suggestionId = suggestionIdOfCase('28', 'a1');
    const original = suggestion({
      id: suggestionId,
      householdId: ownerHouseholdId,
      entries: [entry(mealId1)],
      stockItems: [stockItem({ name: 'にんじん' })],
    });
    await saveAll(ownerHouseholdId, [original]);

    await failureOf(
      saveAll(colliderHouseholdId, [
        suggestion({
          id: suggestionId,
          householdId: colliderHouseholdId,
          entries: [entry(mealId2)],
          stockItems: [stockItem({ name: 'たまねぎ' })],
        }),
      ]),
    );

    const found = await findLatest(ownerHouseholdId);

    // C-9 / NFR-09: 失敗するだけなら、相手世帯の行を書き換えたうえで別の理由で
    // 投げた実装と見分けがつかない。
    expect(found).toEqual(original);
  });

  it('クレームを張らないトランザクションでの save は失敗し、規則違反にはならない', async () => {
    const householdId = householdOf('29');

    const thrown = await failureOf(
      transactionWithoutClaims((tx) =>
        new SuggestionRepositoryImpl(tx).save(
          householdId,
          suggestion({ id: suggestionIdOfCase('29', 'a1'), householdId }),
        ),
      ),
    );

    // ADR-029 / 設計 7章: 書き込みが RLS に拒まれたら、握りつぶさずそのまま伝える。
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(MealRuleViolation);
  });
});

describe('提案リポジトリの実装（トランザクションを持たないこと）', () => {
  it('トランザクションの本体が例外を投げると、その中で保存した提案は残らない', async () => {
    const householdId = householdOf('30');
    const bodyFailure = new Error('本体が投げた');

    // 設計 規則1 / ADR-029 決定3(a): 寿命を持つのは呼ぶ側。本体が投げたら1つの単位ごと巻き戻る。
    await expect(
      withHouseholdTransaction(db, householdId, async (tx) => {
        await new SuggestionRepositoryImpl(tx).save(
          householdId,
          suggestion({ id: suggestionIdOfCase('30', 'a1'), householdId }),
        );
        throw bodyFailure;
      }),
    ).rejects.toBe(bodyFailure);

    const found = await findLatest(householdId);

    expect(found).toBeNull();
  });

  it('保存した提案は、クレームを張らないトランザクションからは読めず、張り直せば読める', async () => {
    const householdId = householdOf('31');
    await saveAll(householdId, [suggestion({ id: suggestionIdOfCase('31', 'a1'), householdId })]);

    const foundWithoutClaims = await transactionWithoutClaims((tx) =>
      new SuggestionRepositoryImpl(tx).findRecentByHousehold(householdId, 3),
    );

    const foundAfterReapplyingClaims = await findRecent(householdId, 3);

    // ADR-029 理由(1): クレームを張り忘れた問い合わせは**0行**になる（例外ではない）。
    expect(foundWithoutClaims).toEqual([]);
    // ADR-029 理由(4): 張り直して見えることで、0行の理由を「見えない」に絞り込む。
    expect(foundAfterReapplyingClaims).toHaveLength(1);
  });
});

describe('提案リポジトリの実装（生成の回数）', () => {
  // 窓の下端（ADR-049: 遡る24時間の窓）。内側は `newerGeneratedAt`。
  const since = middleGeneratedAt;
  const justBeforeSince = '2026-09-22T08:59:59.999Z';

  it('提案が1件も無い世帯では、生成の回数は0になる', async () => {
    const count = await countGenerated(householdOf('32'), since);

    // 設計 規則10: 0件なら 0。
    expect(count).toBe(0);
  });

  it('窓の内側にある生成の由来の提案を数える', async () => {
    const householdId = householdOf('33');
    await saveAll(householdId, [
      suggestion({
        id: suggestionIdOfCase('33', 'a1'),
        householdId,
        generatedAt: newerGeneratedAt,
      }),
      suggestion({
        id: suggestionIdOfCase('33', 'a2'),
        householdId,
        generatedAt: newerGeneratedAt,
      }),
    ]);

    const count = await countGenerated(householdId, since);

    // 設計 規則10 / NFR-C2
    expect(count).toBe(2);
  });

  it('提案の1件が複数ある生成の提案も、1回と数える', async () => {
    const householdId = householdOf('34');
    await saveAll(householdId, [
      suggestion({
        id: suggestionIdOfCase('34', 'a1'),
        householdId,
        entries: [entry(mealId1), entry(mealId2), entry(mealId3)],
        stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'たまねぎ' })],
        generatedAt: newerGeneratedAt,
      }),
    ]);

    const count = await countGenerated(householdId, since);

    // 設計 規則10: 数えるのは提案の件数で、提案の1件や在庫品の件数ではない（ADR-049 決定1）。
    expect(count).toBe(1);
  });

  it('再利用の由来の提案は、生成の回数に入れない', async () => {
    const householdId = householdOf('35');
    await saveAll(householdId, [
      suggestion({
        id: suggestionIdOfCase('35', 'a1'),
        householdId,
        generatedAt: newerGeneratedAt,
      }),
      suggestion({
        id: suggestionIdOfCase('35', 'a2'),
        householdId,
        entries: [entry(mealId1, 'reused'), entry(mealId2, 'reused')],
        generatedAt: newerGeneratedAt,
      }),
    ]);

    const count = await countGenerated(householdId, since);

    // 設計 規則10 / C-15 / C-4c: 由来が生成のものだけを数える。
    expect(count).toBe(1);
  });

  it('窓の下端より前の提案は、生成の回数に入れない', async () => {
    const householdId = householdOf('36');
    await saveAll(householdId, [
      suggestion({
        id: suggestionIdOfCase('36', 'a1'),
        householdId,
        generatedAt: newerGeneratedAt,
      }),
      suggestion({
        id: suggestionIdOfCase('36', 'a2'),
        householdId,
        generatedAt: justBeforeSince,
      }),
    ]);

    const count = await countGenerated(householdId, since);

    // 設計 規則10 / ADR-049 結果4
    expect(count).toBe(1);
  });

  it('窓の下端ちょうどの提案は、生成の回数に入れる', async () => {
    const householdId = householdOf('37');
    await saveAll(householdId, [
      suggestion({
        id: suggestionIdOfCase('37', 'a1'),
        householdId,
        generatedAt: since,
      }),
    ]);

    const count = await countGenerated(householdId, since);

    // 設計 規則10: 下端を含む（`generated_at >= since`）。
    expect(count).toBe(1);
  });

  it('他世帯が保存した生成の提案は、生成の回数に入れない', async () => {
    const ownHouseholdId = householdOf('38');
    const otherHouseholdId = householdOf('38', true);
    await saveAll(ownHouseholdId, [
      suggestion({
        id: suggestionIdOfCase('38', 'a1'),
        householdId: ownHouseholdId,
        generatedAt: newerGeneratedAt,
      }),
    ]);
    await saveAll(otherHouseholdId, [
      suggestion({
        id: suggestionIdOfCase('38', 'a2'),
        householdId: otherHouseholdId,
        generatedAt: newerGeneratedAt,
      }),
    ]);

    const count = await countGenerated(ownHouseholdId, since);

    // C-9 / NFR-09
    expect(count).toBe(1);
  });

  it('クレームで見えている生成の提案でも、引数の世帯が食い違えば数えない', async () => {
    const claimedHouseholdId = householdOf('39');
    const passedHouseholdId = householdOf('39', true);

    const count = await withHouseholdTransaction(db, claimedHouseholdId, async (tx) => {
      const repository = new SuggestionRepositoryImpl(tx);
      await repository.save(
        claimedHouseholdId,
        suggestion({
          id: suggestionIdOfCase('39', 'a1'),
          householdId: claimedHouseholdId,
          generatedAt: newerGeneratedAt,
        }),
      );
      // 設計 規則2: RLS で見えていても、引数の世帯で必ず絞る（網は二重）。
      return repository.countGeneratedByHouseholdSince(passedHouseholdId, dateTimeOf(since));
    });

    // C-9
    expect(count).toBe(0);
  });
});

// B-56a: 世帯のデータを消す。準備の提案は提案の1件と、在庫品1件以上の在庫スナップショットを
// 持つ（子から親の順に消せていないと DB の外部キーが拒む。B-56a 規則5）。
describe('提案リポジトリの実装（世帯のデータを消す）', () => {
  it('提案の1件と在庫品を持つ提案を、世帯のデータを消すと引けなくなる', async () => {
    const householdId = householdOf('40');
    await saveAll(householdId, [
      suggestion({
        id: suggestionIdOfCase('40', 'a1'),
        householdId,
        entries: [entry(mealId1), entry(mealId2)],
        stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'たまねぎ' })],
        generatedAt: olderGeneratedAt,
      }),
      suggestion({
        id: suggestionIdOfCase('40', 'a2'),
        householdId,
        generatedAt: newerGeneratedAt,
      }),
    ]);

    await withHouseholdTransaction(db, householdId, (tx) =>
      new SuggestionRepositoryImpl(tx).deleteByHousehold(householdId),
    );

    // FR-27 / NFR-13 / ADR-072 決定3 / B-56a 規則2: 生成後に不変の提案も世帯ごと消す。
    expect(await findLatest(householdId)).toBeNull();
  });

  it('他世帯が自分の世帯のデータを消しても、こちらの世帯の提案は提案の1件と在庫品ごと残る', async () => {
    const ownerHouseholdId = householdOf('41');
    const strangerHouseholdId = householdOf('41', true);
    await saveAll(ownerHouseholdId, [
      suggestion({
        id: suggestionIdOfCase('41', 'a1'),
        householdId: ownerHouseholdId,
        entries: [entry(mealId1), entry(mealId2)],
        stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'たまねぎ' })],
      }),
    ]);
    await saveAll(strangerHouseholdId, [
      suggestion({ id: suggestionIdOfCase('41', 'a2'), householdId: strangerHouseholdId }),
    ]);

    await withHouseholdTransaction(db, strangerHouseholdId, (tx) =>
      new SuggestionRepositoryImpl(tx).deleteByHousehold(strangerHouseholdId),
    );

    const found = await findLatest(ownerHouseholdId);

    // C-9 / NFR-09 / B-56a 規則4: 他世帯の行は、どの表でも1行も消えない。
    expect({
      mealIds: found?.entries.map((savedEntry) => savedEntry.mealId),
      stockItemNames: found?.pantrySnapshot.stockItems.map((snapshotItem) => snapshotItem.name),
    }).toEqual({ mealIds: [mealId1, mealId2], stockItemNames: ['にんじん', 'たまねぎ'] });
  });

  it('クレームで見えている提案でも、引数の世帯が食い違えば提案の1件と在庫品ごと消えない', async () => {
    const claimedHouseholdId = householdOf('42');
    const passedHouseholdId = householdOf('42', true);

    const found = await withHouseholdTransaction(db, claimedHouseholdId, async (tx) => {
      const repository = new SuggestionRepositoryImpl(tx);
      await repository.save(
        claimedHouseholdId,
        suggestion({
          id: suggestionIdOfCase('42', 'a1'),
          householdId: claimedHouseholdId,
          entries: [entry(mealId1), entry(mealId2)],
          stockItems: [stockItem({ name: 'にんじん' }), stockItem({ name: 'たまねぎ' })],
        }),
      );
      // B-56a 規則3: RLS で見えていても、引数の世帯で必ず絞る（網は二重）。
      // 3表のどれかで `where` から世帯を外した実装なら、ここでその表の行が消える。
      await repository.deleteByHousehold(passedHouseholdId);
      return repository.findLatestByHousehold(claimedHouseholdId);
    });

    // C-9
    expect({
      mealIds: found?.entries.map((savedEntry) => savedEntry.mealId),
      stockItemNames: found?.pantrySnapshot.stockItems.map((snapshotItem) => snapshotItem.name),
    }).toEqual({ mealIds: [mealId1, mealId2], stockItemNames: ['にんじん', 'たまねぎ'] });
  });

  it('提案が1件も無い世帯のデータを消しても、失敗しない', async () => {
    const householdId = householdOf('43');

    const deletion = withHouseholdTransaction(db, householdId, (tx) =>
      new SuggestionRepositoryImpl(tx).deleteByHousehold(householdId),
    );

    // B-56a 規則7: 消す物が無くても同じ結末。
    await expect(deletion).resolves.toBeUndefined();
  });

  it('同じ世帯のデータを2度消しても、2度目も失敗しない', async () => {
    const householdId = householdOf('44');
    await saveAll(householdId, [suggestion({ id: suggestionIdOfCase('44', 'a1'), householdId })]);
    await withHouseholdTransaction(db, householdId, (tx) =>
      new SuggestionRepositoryImpl(tx).deleteByHousehold(householdId),
    );

    const secondDeletion = withHouseholdTransaction(db, householdId, (tx) =>
      new SuggestionRepositoryImpl(tx).deleteByHousehold(householdId),
    );

    // B-56a 規則7: 2度目の呼び出しも同じ結末。
    await expect(secondDeletion).resolves.toBeUndefined();
  });
});
