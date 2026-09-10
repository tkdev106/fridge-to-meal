import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createStockItem } from '../../src/contexts/pantry/domain/entity/StockItem.js';
import { PantryRuleViolation } from '../../src/contexts/pantry/domain/error/PantryRuleViolation.js';
import { amountOf } from '../../src/contexts/pantry/domain/value/Amount.js';
import { expiryDateOf } from '../../src/contexts/pantry/domain/value/ExpiryDate.js';
import { ingredientIdOf } from '../../src/contexts/pantry/domain/value/IngredientId.js';
import type { StockItemId } from '../../src/contexts/pantry/domain/value/StockItemId.js';
import { stockItemIdOf } from '../../src/contexts/pantry/domain/value/StockItemId.js';
import { StockItemRepositoryImpl } from '../../src/contexts/pantry/infrastructure/StockItemRepositoryImpl.js';
import type { HouseholdTransaction } from '../../src/contexts/pantry/infrastructure/db/HouseholdTransaction.js';
import { withHouseholdTransaction } from '../../src/contexts/pantry/infrastructure/db/HouseholdTransaction.js';
import type { HouseholdId } from '../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../src/shared/domain/HouseholdId.js';
import { アプリの接続文字列 } from '../support/db/ConnectionStrings.js';

/**
 * ローカル Postgres に対する `StockItemRepositoryImpl` の1周目
 * （B-07 設計 規則1・2・3・4・13 / ADR-029 / ADR-028 / C-9 / NFR-09 / FR-01）。
 * **`pnpm test:db` でだけ走る** — `pnpm test` は `apps/api/test/db/**` を除外する。
 *
 * 繋ぐのは `authenticator` だけ。所有者（`postgres`）の接続を使うと行レベルセキュリティが
 * 素通りし、**RLS が無くても緑になる**（B-07 設計 9章）。
 *
 * **世帯 ID と在庫品 ID はケースごとに固有の固定値を使い、使い回さない。** 表は
 * `globalSetup` で1度だけ作られ、ファイルとケースをまたいで共有されるため。
 * **後片付けはしない。**
 */
const 世帯_往復 = householdIdOf('b7010000-0000-4000-8000-000000000001');
const 在庫品識別子_往復 = stockItemIdOf('b7010000-0000-4000-8000-0000000000f1');

const 世帯_張り直し = householdIdOf('b7020000-0000-4000-8000-000000000002');
const 在庫品識別子_張り直し = stockItemIdOf('b7020000-0000-4000-8000-0000000000f2');

const 世帯_巻き戻し = householdIdOf('b7030000-0000-4000-8000-000000000003');
const 在庫品識別子_巻き戻し = stockItemIdOf('b7030000-0000-4000-8000-0000000000f3');

const 世帯_見つからない = householdIdOf('b7040000-0000-4000-8000-000000000004');
const 在庫品識別子_保存しない = stockItemIdOf('b7040000-0000-4000-8000-0000000000f4');

const 世帯_持ち主 = householdIdOf('b7050000-0000-4000-8000-000000000005');
const 世帯_他人 = householdIdOf('b7050000-0000-4000-8000-000000000015');
const 在庫品識別子_他世帯 = stockItemIdOf('b7050000-0000-4000-8000-0000000000f5');

const 世帯_引数の食い違い = householdIdOf('b7060000-0000-4000-8000-000000000006');
const 世帯_渡す側 = householdIdOf('b7060000-0000-4000-8000-000000000016');
const 在庫品識別子_食い違い = stockItemIdOf('b7060000-0000-4000-8000-0000000000f6');

const 世帯_衝突の持ち主 = householdIdOf('b7070000-0000-4000-8000-000000000007');
const 世帯_衝突させる側 = householdIdOf('b7070000-0000-4000-8000-000000000017');
const 在庫品識別子_衝突 = stockItemIdOf('b7070000-0000-4000-8000-0000000000f7');

// 1本の接続で複数のトランザクションを張る。`local` が次のトランザクションへ漏れて
// いないことは、同じ接続を使い回すことでしか見えない（ADR-029 決定3(a)）。
const 接続 = postgres(アプリの接続文字列, { max: 1 });
const データベース = drizzle(接続);

afterAll(async () => {
  await 接続.end();
});

/**
 * 在庫品を1つ作る。**本題でない値は省ける** — 省いたものは「無し」になる。
 * 素のリテラルを在庫品として扱わず、必ずドメインの生成関数を通す（B-07 設計 規則11）。
 */
function 在庫品(props: {
  id: StockItemId;
  householdId: HouseholdId;
  name: string;
  ingredientId?: string | null;
  amount?: string | null;
  expiryDate?: string | null;
}) {
  const 食材の識別子 = props.ingredientId ?? null;

  return createStockItem({
    id: props.id,
    householdId: props.householdId,
    name: props.name,
    ingredientId: 食材の識別子 === null ? null : ingredientIdOf(食材の識別子),
    amount: amountOf(props.amount ?? null),
    expiryDate: expiryDateOf(props.expiryDate ?? null),
  });
}

/**
 * **クレームを張らない** handle を1つ作る（`withHouseholdTransaction` には無い経路 —
 * 本体は常にクレームを張る。B-07 設計 規則2）。
 *
 * `set local role authenticated` だけは張る。張らないと `authenticator` に
 * `stock_items` の権限が無く、確かめたい「0行」ではなく権限エラーで落ちる。
 */
function クレームを張らないトランザクション<T>(
  本体: (tx: HouseholdTransaction) => Promise<T>,
): Promise<T> {
  return データベース.transaction(async (tx) => {
    await tx.execute(sql`set local role authenticated`);
    return 本体(tx);
  });
}

describe('在庫品リポジトリの実装', () => {
  it('保存した在庫品を同じ世帯の findById で読み戻せる', async () => {
    const 保存する在庫品 = 在庫品({
      id: 在庫品識別子_往復,
      householdId: 世帯_往復,
      name: 'にんじん',
    });

    const 読み戻した在庫品 = await withHouseholdTransaction(データベース, 世帯_往復, async (tx) => {
      const リポジトリ = new StockItemRepositoryImpl(tx);
      await リポジトリ.save(世帯_往復, 保存する在庫品);
      return リポジトリ.findById(世帯_往復, 在庫品識別子_往復);
    });

    // FR-01: 登録した在庫品が残ること。行と在庫品の往復が成り立っていることを、
    // 保存したものと同じ値が返ることで見る（B-07 設計 規則3・11）。
    expect(読み戻した在庫品).toMatchObject({
      id: 在庫品識別子_往復,
      householdId: 世帯_往復,
      name: 'にんじん',
    });
  });

  it('保存した在庫品は、クレームを張らないトランザクションからは読めず、クレームを張り直したトランザクションではもう一度読める', async () => {
    await withHouseholdTransaction(データベース, 世帯_張り直し, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        世帯_張り直し,
        在庫品({ id: 在庫品識別子_張り直し, householdId: 世帯_張り直し, name: 'にんじん' }),
      ),
    );

    const クレーム無しで読めた在庫品 = await クレームを張らないトランザクション((tx) =>
      new StockItemRepositoryImpl(tx).findById(世帯_張り直し, 在庫品識別子_張り直し),
    );

    const 張り直して読めた在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_張り直し,
      (tx) => new StockItemRepositoryImpl(tx).findById(世帯_張り直し, 在庫品識別子_張り直し),
    );

    // ADR-029 理由(1): クレームを張り忘れた問い合わせは**0行**になる（例外ではない）。
    expect(クレーム無しで読めた在庫品).toBeNull();
    // ADR-029 理由(4): 3つ目が、0行の理由を「見えない」に絞り込む唯一の手である
    // （1つ目が commit されていないだけ、では説明がつかなくなる）。
    expect(張り直して読めた在庫品?.name).toBe('にんじん');
  });

  it('トランザクションの本体が例外を投げると、その中で保存した在庫品は残らない', async () => {
    const 本体の失敗 = new Error('本体が投げた');

    // ADR-029 決定3(a): 寿命を持つのは呼ぶ側。本体が投げたら1つの単位ごと巻き戻る。
    await expect(
      withHouseholdTransaction(データベース, 世帯_巻き戻し, async (tx) => {
        await new StockItemRepositoryImpl(tx).save(
          世帯_巻き戻し,
          在庫品({ id: 在庫品識別子_巻き戻し, householdId: 世帯_巻き戻し, name: 'にんじん' }),
        );
        throw 本体の失敗;
      }),
    ).rejects.toBe(本体の失敗);

    const 張り直して読めた在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_巻き戻し,
      (tx) => new StockItemRepositoryImpl(tx).findById(世帯_巻き戻し, 在庫品識別子_巻き戻し),
    );

    expect(張り直して読めた在庫品).toBeNull();
  });

  it('保存していない在庫品 ID を指すと null を返す', async () => {
    const 読めた在庫品 = await withHouseholdTransaction(データベース, 世帯_見つからない, (tx) =>
      new StockItemRepositoryImpl(tx).findById(世帯_見つからない, 在庫品識別子_保存しない),
    );

    // B-07 設計 規則4: 0行は `null`。**例外にしない。**
    expect(読めた在庫品).toBeNull();
  });

  it('他世帯が保存した在庫品は null になる', async () => {
    await withHouseholdTransaction(データベース, 世帯_持ち主, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        世帯_持ち主,
        在庫品({ id: 在庫品識別子_他世帯, householdId: 世帯_持ち主, name: 'にんじん' }),
      ),
    );

    const 他人に見えた在庫品 = await withHouseholdTransaction(データベース, 世帯_他人, (tx) =>
      new StockItemRepositoryImpl(tx).findById(世帯_他人, 在庫品識別子_他世帯),
    );

    const 持ち主に見えた在庫品 = await withHouseholdTransaction(データベース, 世帯_持ち主, (tx) =>
      new StockItemRepositoryImpl(tx).findById(世帯_持ち主, 在庫品識別子_他世帯),
    );

    // C-9 / NFR-09: 世帯をまたぐ取得は「無い」として扱う（例外にしない）。
    expect(他人に見えた在庫品).toBeNull();
    // 行が実在することの裏取り。無ければ `null` は当たり前に起きる。
    expect(持ち主に見えた在庫品?.name).toBe('にんじん');
  });

  it('クレームで見えている在庫品でも、引数の世帯が食い違えば null になる', async () => {
    const 別の世帯で読めた在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_引数の食い違い,
      async (tx) => {
        const リポジトリ = new StockItemRepositoryImpl(tx);
        await リポジトリ.save(
          世帯_引数の食い違い,
          在庫品({
            id: 在庫品識別子_食い違い,
            householdId: 世帯_引数の食い違い,
            name: 'にんじん',
          }),
        );
        // B-07 設計 規則3: RLS で見えていても、引数の世帯で必ず絞る（網は二重）。
        // `where` を外した実装なら、ここで在庫品が返ってしまう。
        return リポジトリ.findById(世帯_渡す側, 在庫品識別子_食い違い);
      },
    );

    // C-9 / NFR-09
    expect(別の世帯で読めた在庫品).toBeNull();
  });

  it('他世帯の在庫品と同じ ID の保存は成功せず、相手世帯の行も変わらない', async () => {
    await withHouseholdTransaction(データベース, 世帯_衝突の持ち主, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        世帯_衝突の持ち主,
        在庫品({ id: 在庫品識別子_衝突, householdId: 世帯_衝突の持ち主, name: 'にんじん' }),
      ),
    );

    // B-07 設計 規則13: **例外の型・コードは約束しない**（SQLSTATE を期待値に書かない）。
    await expect(
      withHouseholdTransaction(データベース, 世帯_衝突させる側, (tx) =>
        new StockItemRepositoryImpl(tx).save(
          世帯_衝突させる側,
          在庫品({ id: 在庫品識別子_衝突, householdId: 世帯_衝突させる側, name: 'たまねぎ' }),
        ),
      ),
    ).rejects.toBeInstanceOf(Error);

    const 持ち主に見えた在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_衝突の持ち主,
      (tx) => new StockItemRepositoryImpl(tx).findById(世帯_衝突の持ち主, 在庫品識別子_衝突),
    );

    // C-9 / NFR-09: このケースの重心はここ。例外だけでは、他世帯の行を上書きしたうえで
    // 別の理由で投げた実装と見分けがつかない。
    expect(持ち主に見えた在庫品?.name).toBe('にんじん');
  });
});

/**
 * `StockItemRepositoryImpl` の2周目
 * （B-07 設計 規則5・6・7・8・9・10・11・12 と 7章 / FR-03 / FR-05 / FR-06 /
 * ADR-002 / ADR-010 / ADR-027 / C-6 / C-9 / NFR-09）。
 *
 * 前提は1周目と同じ — 繋ぐのは `authenticator` だけ、世帯 ID と在庫品 ID は
 * **ケースごとに固有の固定値**、後片付けはしない。
 */
const 世帯_上書き = householdIdOf('b7080000-0000-4000-8000-000000000008');
const 在庫品識別子_上書き = stockItemIdOf('b7080000-0000-4000-8000-0000000000f8');

const 世帯_分量を消す = householdIdOf('b7090000-0000-4000-8000-000000000009');
const 在庫品識別子_分量を消す = stockItemIdOf('b7090000-0000-4000-8000-0000000000f9');

const 世帯_期限を消す = householdIdOf('b70a0000-0000-4000-8000-00000000000a');
const 在庫品識別子_期限を消す = stockItemIdOf('b70a0000-0000-4000-8000-0000000000fa');

const 世帯_食材を消す = householdIdOf('b70b0000-0000-4000-8000-00000000000b');
const 在庫品識別子_食材を消す = stockItemIdOf('b70b0000-0000-4000-8000-0000000000fb');

const 世帯_保存の食い違い = householdIdOf('b70c0000-0000-4000-8000-00000000000c');
const 世帯_保存の食い違い_在庫品側 = householdIdOf('b70c0000-0000-4000-8000-00000000001c');
const 在庫品識別子_保存の食い違い = stockItemIdOf('b70c0000-0000-4000-8000-0000000000fc');

const 世帯_触らない = householdIdOf('b70d0000-0000-4000-8000-00000000000d');
const 世帯_触らない_在庫品側 = householdIdOf('b70d0000-0000-4000-8000-00000000001d');
const 在庫品識別子_触らない = stockItemIdOf('b70d0000-0000-4000-8000-0000000000fd');

const 世帯_削除 = householdIdOf('b70e0000-0000-4000-8000-00000000000e');
const 在庫品識別子_削除 = stockItemIdOf('b70e0000-0000-4000-8000-0000000000fe');

const 世帯_保存しない削除 = householdIdOf('b70f0000-0000-4000-8000-00000000000f');
const 在庫品識別子_保存しない削除 = stockItemIdOf('b70f0000-0000-4000-8000-0000000000ff');

const 世帯_削除の持ち主 = householdIdOf('b7100000-0000-4000-8000-000000000010');
const 世帯_削除の他人 = householdIdOf('b7100000-0000-4000-8000-000000000020');
const 在庫品識別子_他世帯の削除 = stockItemIdOf('b7100000-0000-4000-8000-0000000000a1');

const 世帯_削除の食い違い = householdIdOf('b7110000-0000-4000-8000-000000000011');
const 世帯_削除の渡す側 = householdIdOf('b7110000-0000-4000-8000-000000000021');
const 在庫品識別子_削除の食い違い = stockItemIdOf('b7110000-0000-4000-8000-0000000000a2');

const 世帯_一覧 = householdIdOf('b7120000-0000-4000-8000-000000000012');
const 在庫品識別子_一覧1 = stockItemIdOf('b7120000-0000-4000-8000-0000000000a3');
const 在庫品識別子_一覧2 = stockItemIdOf('b7120000-0000-4000-8000-0000000000a4');
const 在庫品識別子_一覧3 = stockItemIdOf('b7120000-0000-4000-8000-0000000000a5');

const 世帯_空の一覧 = householdIdOf('b7130000-0000-4000-8000-000000000013');

const 世帯_一覧の持ち主 = householdIdOf('b7140000-0000-4000-8000-000000000014');
const 世帯_一覧の他人 = householdIdOf('b7140000-0000-4000-8000-000000000024');
const 在庫品識別子_自世帯1 = stockItemIdOf('b7140000-0000-4000-8000-0000000000a6');
const 在庫品識別子_自世帯2 = stockItemIdOf('b7140000-0000-4000-8000-0000000000a7');
const 在庫品識別子_他世帯の一覧 = stockItemIdOf('b7140000-0000-4000-8000-0000000000b7');

const 世帯_一覧の食い違い = householdIdOf('b7150000-0000-4000-8000-000000000015');
const 世帯_一覧の渡す側 = householdIdOf('b7150000-0000-4000-8000-000000000025');
const 在庫品識別子_一覧の食い違い = stockItemIdOf('b7150000-0000-4000-8000-0000000000a8');

const 世帯_値の往復 = householdIdOf('b7160000-0000-4000-8000-000000000016');
const 在庫品識別子_値の往復 = stockItemIdOf('b7160000-0000-4000-8000-0000000000a9');

const 世帯_空白 = householdIdOf('b7170000-0000-4000-8000-000000000017');
const 在庫品識別子_空白 = stockItemIdOf('b7170000-0000-4000-8000-0000000000aa');

const 世帯_uuidでない食材 = householdIdOf('b7180000-0000-4000-8000-000000000018');
const 在庫品識別子_uuidでない食材 = stockItemIdOf('b7180000-0000-4000-8000-0000000000ab');

// カタログの食材を指す識別子。**外部キーは張られていない**（ADR-008 / FR-03）ため、
// カタログに行が無くても保存できる。列の型は uuid なので書式だけは合わせる。
const 食材識別子_にんじん = '11110000-0000-4000-8000-000000000001';
const 食材識別子_たまねぎ = '11110000-0000-4000-8000-000000000002';
const 食材識別子_消す前 = '11110000-0000-4000-8000-000000000003';
const 食材識別子_値の往復 = '11110000-0000-4000-8000-000000000004';

describe('在庫品リポジトリの実装（上書き・削除・一覧・値の写像）', () => {
  it('同じ ID で2度 save すると、名称・食材 ID・分量・期限が2回目の値になる', async () => {
    const 読み戻した在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_上書き,
      async (tx) => {
        const リポジトリ = new StockItemRepositoryImpl(tx);
        await リポジトリ.save(
          世帯_上書き,
          在庫品({
            id: 在庫品識別子_上書き,
            householdId: 世帯_上書き,
            name: 'にんじん',
            ingredientId: 食材識別子_にんじん,
            amount: '1本',
            expiryDate: '2026-01-31',
          }),
        );
        await リポジトリ.save(
          世帯_上書き,
          在庫品({
            id: 在庫品識別子_上書き,
            householdId: 世帯_上書き,
            name: 'たまねぎ',
            ingredientId: 食材識別子_たまねぎ,
            amount: '2個',
            expiryDate: '2026-02-28',
          }),
        );
        return リポジトリ.findById(世帯_上書き, 在庫品識別子_上書き);
      },
    );

    // FR-05 / B-07 設計 規則7・8: 上書きの対象は4列すべて。`household_id` は上書きしない。
    expect(読み戻した在庫品).toMatchObject({
      householdId: 世帯_上書き,
      name: 'たまねぎ',
      ingredientId: '11110000-0000-4000-8000-000000000002',
      amount: '2個',
      expiryDate: '2026-02-28',
    });
  });

  it('分量を null にした save は、保存済みの分量を消す', async () => {
    const 読み戻した在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_分量を消す,
      async (tx) => {
        const リポジトリ = new StockItemRepositoryImpl(tx);
        await リポジトリ.save(
          世帯_分量を消す,
          在庫品({
            id: 在庫品識別子_分量を消す,
            householdId: 世帯_分量を消す,
            name: 'にんじん',
            amount: '1本',
          }),
        );
        await リポジトリ.save(
          世帯_分量を消す,
          在庫品({
            id: 在庫品識別子_分量を消す,
            householdId: 世帯_分量を消す,
            name: 'にんじん',
            amount: null,
          }),
        );
        return リポジトリ.findById(世帯_分量を消す, 在庫品識別子_分量を消す);
      },
    );

    // FR-05 / B-07 設計 規則8・9: 分量を**消す**更新が主役。`null` もそのまま書く。
    expect(読み戻した在庫品?.amount).toBeNull();
  });

  it('期限を null にした save は、保存済みの期限を消す', async () => {
    const 読み戻した在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_期限を消す,
      async (tx) => {
        const リポジトリ = new StockItemRepositoryImpl(tx);
        await リポジトリ.save(
          世帯_期限を消す,
          在庫品({
            id: 在庫品識別子_期限を消す,
            householdId: 世帯_期限を消す,
            name: 'にんじん',
            expiryDate: '2026-03-01',
          }),
        );
        await リポジトリ.save(
          世帯_期限を消す,
          在庫品({
            id: 在庫品識別子_期限を消す,
            householdId: 世帯_期限を消す,
            name: 'にんじん',
            expiryDate: null,
          }),
        );
        return リポジトリ.findById(世帯_期限を消す, 在庫品識別子_期限を消す);
      },
    );

    // FR-05 / B-07 設計 規則8・10
    expect(読み戻した在庫品?.expiryDate).toBeNull();
  });

  it('食材 ID を null にした save は、保存済みの食材 ID を消す', async () => {
    const 読み戻した在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_食材を消す,
      async (tx) => {
        const リポジトリ = new StockItemRepositoryImpl(tx);
        await リポジトリ.save(
          世帯_食材を消す,
          在庫品({
            id: 在庫品識別子_食材を消す,
            householdId: 世帯_食材を消す,
            name: 'にんじん',
            ingredientId: 食材識別子_消す前,
          }),
        );
        await リポジトリ.save(
          世帯_食材を消す,
          在庫品({
            id: 在庫品識別子_食材を消す,
            householdId: 世帯_食材を消す,
            name: 'にんじん',
            ingredientId: null,
          }),
        );
        return リポジトリ.findById(世帯_食材を消す, 在庫品識別子_食材を消す);
      },
    );

    // FR-03 / B-07 設計 規則8: カタログを指さない在庫品に戻せる。
    expect(読み戻した在庫品?.ingredientId).toBeNull();
  });

  it('引数の世帯と在庫品の世帯が食い違う save を拒む', async () => {
    const 保存 = withHouseholdTransaction(データベース, 世帯_保存の食い違い, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        世帯_保存の食い違い,
        在庫品({
          id: 在庫品識別子_保存の食い違い,
          householdId: 世帯_保存の食い違い_在庫品側,
          name: 'にんじん',
        }),
      ),
    );

    // C-9 / B-07 設計 規則6・7章: RLS の拒否に任せない — 任せると `rule` の付かない
    // 別の失敗になり、呼ぶ側が理由で分岐できない。
    await expect(保存).rejects.toThrow(PantryRuleViolation);
    await expect(保存).rejects.toHaveProperty('rule', 'save.householdMismatch');
  });

  it('食い違う save は DB に触らない', async () => {
    const 同じ単位で読めた在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_触らない,
      async (tx) => {
        const リポジトリ = new StockItemRepositoryImpl(tx);

        // 拒否は**同じトランザクションの中で**捕まえる。外で捕まえると単位が終わって
        // しまい、「DB に触っていない」ことが見えない（B-07 設計 規則6）。
        await expect(
          リポジトリ.save(
            世帯_触らない,
            在庫品({
              id: 在庫品識別子_触らない,
              householdId: 世帯_触らない_在庫品側,
              name: 'にんじん',
            }),
          ),
        ).rejects.toThrow(PantryRuleViolation);

        // RLS に任せた実装なら、拒まれた文でトランザクションが中断していて、
        // この問い合わせ自体が落ちる。
        return リポジトリ.findById(世帯_触らない, 在庫品識別子_触らない);
      },
    );

    const 在庫品側の世帯で読めた在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_触らない_在庫品側,
      (tx) =>
        new StockItemRepositoryImpl(tx).findById(世帯_触らない_在庫品側, 在庫品識別子_触らない),
    );

    expect(同じ単位で読めた在庫品).toBeNull();
    // 在庫品側の世帯にも行は残らない（**書かれていない**ことの裏取り）。
    expect(在庫品側の世帯で読めた在庫品).toBeNull();
  });

  it('保存した在庫品を delete すると findById が null になる', async () => {
    const 削除後に読めた在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_削除,
      async (tx) => {
        const リポジトリ = new StockItemRepositoryImpl(tx);
        await リポジトリ.save(
          世帯_削除,
          在庫品({ id: 在庫品識別子_削除, householdId: 世帯_削除, name: 'にんじん' }),
        );
        await リポジトリ.delete(世帯_削除, 在庫品識別子_削除);
        return リポジトリ.findById(世帯_削除, 在庫品識別子_削除);
      },
    );

    // FR-06 / B-07 設計 規則12: 削除は物理削除でよい（C-5 により献立は参照を持たない）。
    expect(削除後に読めた在庫品).toBeNull();
  });

  it('保存していない ID の delete は何もせずに成功する', async () => {
    const 削除 = withHouseholdTransaction(データベース, 世帯_保存しない削除, (tx) =>
      new StockItemRepositoryImpl(tx).delete(世帯_保存しない削除, 在庫品識別子_保存しない削除),
    );

    // ADR-027 / B-07 設計 規則12: 影響行数を見ず、例外にしない。「無い」の判定は
    // ユースケース層が `findById` で行う。
    await expect(削除).resolves.toBeUndefined();
  });

  it('他世帯の在庫品を指す delete は成功し、相手世帯の行も消えない', async () => {
    await withHouseholdTransaction(データベース, 世帯_削除の持ち主, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        世帯_削除の持ち主,
        在庫品({
          id: 在庫品識別子_他世帯の削除,
          householdId: 世帯_削除の持ち主,
          name: 'にんじん',
        }),
      ),
    );

    const 他人の削除 = withHouseholdTransaction(データベース, 世帯_削除の他人, (tx) =>
      new StockItemRepositoryImpl(tx).delete(世帯_削除の他人, 在庫品識別子_他世帯の削除),
    );

    await expect(他人の削除).resolves.toBeUndefined();

    const 持ち主に見えた在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_削除の持ち主,
      (tx) =>
        new StockItemRepositoryImpl(tx).findById(世帯_削除の持ち主, 在庫品識別子_他世帯の削除),
    );

    // C-9 / NFR-09: このケースの重心はここ。成功するだけなら、行を消したうえで
    // 成功した実装と見分けがつかない。
    expect(持ち主に見えた在庫品?.name).toBe('にんじん');
  });

  it('クレームで見えている在庫品でも、引数の世帯が食い違う delete では消えない', async () => {
    const 削除後に読めた在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_削除の食い違い,
      async (tx) => {
        const リポジトリ = new StockItemRepositoryImpl(tx);
        await リポジトリ.save(
          世帯_削除の食い違い,
          在庫品({
            id: 在庫品識別子_削除の食い違い,
            householdId: 世帯_削除の食い違い,
            name: 'にんじん',
          }),
        );
        // B-07 設計 規則3: RLS で見えていても、引数の世帯で必ず絞る（網は二重）。
        // `where` から世帯を外した実装なら、ここで消えてしまう。
        await リポジトリ.delete(世帯_削除の渡す側, 在庫品識別子_削除の食い違い);
        return リポジトリ.findById(世帯_削除の食い違い, 在庫品識別子_削除の食い違い);
      },
    );

    // C-9
    expect(削除後に読めた在庫品?.name).toBe('にんじん');
  });

  it('その世帯の在庫品をすべて返す', async () => {
    const 取得した在庫品たち = await withHouseholdTransaction(
      データベース,
      世帯_一覧,
      async (tx) => {
        const リポジトリ = new StockItemRepositoryImpl(tx);
        await リポジトリ.save(
          世帯_一覧,
          在庫品({ id: 在庫品識別子_一覧1, householdId: 世帯_一覧, name: 'にんじん' }),
        );
        await リポジトリ.save(
          世帯_一覧,
          在庫品({ id: 在庫品識別子_一覧2, householdId: 世帯_一覧, name: 'たまねぎ' }),
        );
        await リポジトリ.save(
          世帯_一覧,
          在庫品({ id: 在庫品識別子_一覧3, householdId: 世帯_一覧, name: 'じゃがいも' }),
        );
        return リポジトリ.findByHousehold(世帯_一覧);
      },
    );

    // B-07 設計 規則5: **並び順を約束しない**（並べるのは呼ぶ側）。だから期待値も
    // 集合で書く — 順序を書くと、約束していないものを守らせることになる。
    expect(取得した在庫品たち).toHaveLength(3);
    expect(new Set(取得した在庫品たち.map((品) => 品.id))).toEqual(
      new Set([在庫品識別子_一覧1, 在庫品識別子_一覧2, 在庫品識別子_一覧3]),
    );
  });

  it('在庫品が1件も無い世帯には空の配列を返す', async () => {
    const 取得した在庫品たち = await withHouseholdTransaction(データベース, 世帯_空の一覧, (tx) =>
      new StockItemRepositoryImpl(tx).findByHousehold(世帯_空の一覧),
    );

    // B-07 設計 規則5・7章: 0行は空の配列。`null` でも例外でもない。
    expect(取得した在庫品たち).toEqual([]);
  });

  it('他世帯の在庫品は findByHousehold に含まれない', async () => {
    await withHouseholdTransaction(データベース, 世帯_一覧の持ち主, async (tx) => {
      const リポジトリ = new StockItemRepositoryImpl(tx);
      await リポジトリ.save(
        世帯_一覧の持ち主,
        在庫品({ id: 在庫品識別子_自世帯1, householdId: 世帯_一覧の持ち主, name: 'にんじん' }),
      );
      await リポジトリ.save(
        世帯_一覧の持ち主,
        在庫品({ id: 在庫品識別子_自世帯2, householdId: 世帯_一覧の持ち主, name: 'たまねぎ' }),
      );
    });

    await withHouseholdTransaction(データベース, 世帯_一覧の他人, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        世帯_一覧の他人,
        在庫品({
          id: 在庫品識別子_他世帯の一覧,
          householdId: 世帯_一覧の他人,
          name: 'じゃがいも',
        }),
      ),
    );

    const 取得した在庫品たち = await withHouseholdTransaction(
      データベース,
      世帯_一覧の持ち主,
      (tx) => new StockItemRepositoryImpl(tx).findByHousehold(世帯_一覧の持ち主),
    );

    const 取得した識別子 = 取得した在庫品たち.map((品) => 品.id);

    // C-9 / NFR-09: 世帯をまたぐ取得を許さない。順序は約束しないので集合で比べる。
    expect(new Set(取得した識別子)).toEqual(new Set([在庫品識別子_自世帯1, 在庫品識別子_自世帯2]));
    expect(取得した識別子).not.toContain(在庫品識別子_他世帯の一覧);
  });

  it('クレームで見えている在庫品でも、引数の世帯が食い違えば findByHousehold は空になる', async () => {
    const 取得した在庫品たち = await withHouseholdTransaction(
      データベース,
      世帯_一覧の食い違い,
      async (tx) => {
        const リポジトリ = new StockItemRepositoryImpl(tx);
        await リポジトリ.save(
          世帯_一覧の食い違い,
          在庫品({
            id: 在庫品識別子_一覧の食い違い,
            householdId: 世帯_一覧の食い違い,
            name: 'にんじん',
          }),
        );
        // B-07 設計 規則3: `where` を外した実装なら、ここで在庫品が返ってしまう。
        return リポジトリ.findByHousehold(世帯_一覧の渡す側);
      },
    );

    // C-9
    expect(取得した在庫品たち).toEqual([]);
  });

  it('分量・期限・食材 ID を持つ在庫品を保存すると、3つとも同じ値で読み戻せる', async () => {
    const 読み戻した在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_値の往復,
      async (tx) => {
        const リポジトリ = new StockItemRepositoryImpl(tx);
        await リポジトリ.save(
          世帯_値の往復,
          在庫品({
            id: 在庫品識別子_値の往復,
            householdId: 世帯_値の往復,
            name: 'こむぎこ',
            ingredientId: 食材識別子_値の往復,
            amount: '大さじ 1と1/2',
            expiryDate: '2026-12-31',
          }),
        );
        return リポジトリ.findById(世帯_値の往復, 在庫品識別子_値の往復);
      },
    );

    // ADR-010: 分量は自由文字列。数値と単位に分解しない。
    expect(読み戻した在庫品?.amount).toBe('大さじ 1と1/2');
    // B-07 設計 規則10: 期限は `YYYY-MM-DD` の**文字列**。時刻もタイムゾーンも付かない。
    expect(読み戻した在庫品?.expiryDate).toBe('2026-12-31');
    expect(読み戻した在庫品?.ingredientId).toBe('11110000-0000-4000-8000-000000000004');
  });

  it('名称の前後に空白のある行を読み戻すと、空白の落ちた在庫品になる', async () => {
    const 読み戻した在庫品 = await withHouseholdTransaction(データベース, 世帯_空白, async (tx) => {
      // 行を直接差し込むのは、リポジトリの `save` を通すと空白がどこで落ちたか
      // 見分けられないため。**クレームを張った単位の中で、`authenticator` のまま**行う
      // （所有者の接続を使うと RLS が素通りする）。
      await tx.execute(sql`
        insert into stock_items (id, household_id, name)
        values (${在庫品識別子_空白}, ${世帯_空白}, '  にんじん  ')
      `);

      return new StockItemRepositoryImpl(tx).findById(世帯_空白, 在庫品識別子_空白);
    });

    // C-6: 充足判定は名称の完全一致。前後の空白が残ると、同じ食材が別物になる
    // （B-07 設計 規則11: 行から組むときも `createStockItem` を通す）。
    expect(読み戻した在庫品?.name).toBe('にんじん');
  });

  it('uuid でない食材 ID の保存は、DB の拒否がそのまま伝わる', async () => {
    const 投げられたもの = await withHouseholdTransaction(データベース, 世帯_uuidでない食材, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        世帯_uuidでない食材,
        在庫品({
          id: 在庫品識別子_uuidでない食材,
          householdId: 世帯_uuidでない食材,
          name: 'にんじん',
          ingredientId: 'にんじん',
        }),
      ),
    ).then(
      () => null,
      (失敗: unknown) => 失敗,
    );

    expect(投げられたもの).toBeInstanceOf(Error);
    // ADR-002 / B-07 設計 7章: DB が拒んだ書き込みを**ドメインの例外型に包み直さない**。
    // interface が約束していない規則を実装で増やさない。
    expect(投げられたもの).not.toBeInstanceOf(PantryRuleViolation);
  });
});
