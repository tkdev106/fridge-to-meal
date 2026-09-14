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
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';

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
const roundTripHouseholdId = householdIdOf('b7010000-0000-4000-8000-000000000001');
const roundTripStockItemId = stockItemIdOf('b7010000-0000-4000-8000-0000000000f1');

const reapplyClaimsHouseholdId = householdIdOf('b7020000-0000-4000-8000-000000000002');
const reapplyClaimsStockItemId = stockItemIdOf('b7020000-0000-4000-8000-0000000000f2');

const rollbackHouseholdId = householdIdOf('b7030000-0000-4000-8000-000000000003');
const rollbackStockItemId = stockItemIdOf('b7030000-0000-4000-8000-0000000000f3');

const notFoundHouseholdId = householdIdOf('b7040000-0000-4000-8000-000000000004');
const unsavedStockItemId = stockItemIdOf('b7040000-0000-4000-8000-0000000000f4');

const ownerHouseholdId = householdIdOf('b7050000-0000-4000-8000-000000000005');
const strangerHouseholdId = householdIdOf('b7050000-0000-4000-8000-000000000015');
const otherHouseholdStockItemId = stockItemIdOf('b7050000-0000-4000-8000-0000000000f5');

const argumentMismatchHouseholdId = householdIdOf('b7060000-0000-4000-8000-000000000006');
const passedHouseholdId = householdIdOf('b7060000-0000-4000-8000-000000000016');
const mismatchStockItemId = stockItemIdOf('b7060000-0000-4000-8000-0000000000f6');

const collisionOwnerHouseholdId = householdIdOf('b7070000-0000-4000-8000-000000000007');
const colliderHouseholdId = householdIdOf('b7070000-0000-4000-8000-000000000017');
const collisionStockItemId = stockItemIdOf('b7070000-0000-4000-8000-0000000000f7');

// 1本の接続で複数のトランザクションを張る。`local` が次のトランザクションへ漏れて
// いないことは、同じ接続を使い回すことでしか見えない（ADR-029 決定3(a)）。
const connection = postgres(APP_CONNECTION_STRING, { max: 1 });
const db = drizzle(connection);

afterAll(async () => {
  await connection.end();
});

/**
 * 在庫品を1つ作る。**本題でない値は省ける** — 省いたものは「無し」になる。
 * 素のリテラルを在庫品として扱わず、必ずドメインの生成関数を通す（B-07 設計 規則11）。
 */
function stockItem(props: {
  id: StockItemId;
  householdId: HouseholdId;
  name: string;
  ingredientId?: string | null;
  amount?: string | null;
  expiryDate?: string | null;
}) {
  const ingredientId = props.ingredientId ?? null;

  return createStockItem({
    id: props.id,
    householdId: props.householdId,
    name: props.name,
    ingredientId: ingredientId === null ? null : ingredientIdOf(ingredientId),
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
function transactionWithoutClaims<T>(body: (tx: HouseholdTransaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role authenticated`);
    return body(tx);
  });
}

describe('在庫品リポジトリの実装', () => {
  it('保存した在庫品を同じ世帯の findById で読み戻せる', async () => {
    const stockItemToSave = stockItem({
      id: roundTripStockItemId,
      householdId: roundTripHouseholdId,
      name: 'にんじん',
    });

    const readBackStockItem = await withHouseholdTransaction(
      db,
      roundTripHouseholdId,
      async (tx) => {
        const repository = new StockItemRepositoryImpl(tx);
        await repository.save(roundTripHouseholdId, stockItemToSave);
        return repository.findById(roundTripHouseholdId, roundTripStockItemId);
      },
    );

    // FR-01: 登録した在庫品が残ること。行と在庫品の往復が成り立っていることを、
    // 保存したものと同じ値が返ることで見る（B-07 設計 規則3・11）。
    expect(readBackStockItem).toMatchObject({
      id: roundTripStockItemId,
      householdId: roundTripHouseholdId,
      name: 'にんじん',
    });
  });

  it('保存した在庫品は、クレームを張らないトランザクションからは読めず、クレームを張り直したトランザクションではもう一度読める', async () => {
    await withHouseholdTransaction(db, reapplyClaimsHouseholdId, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        reapplyClaimsHouseholdId,
        stockItem({
          id: reapplyClaimsStockItemId,
          householdId: reapplyClaimsHouseholdId,
          name: 'にんじん',
        }),
      ),
    );

    const stockItemReadWithoutClaims = await transactionWithoutClaims((tx) =>
      new StockItemRepositoryImpl(tx).findById(reapplyClaimsHouseholdId, reapplyClaimsStockItemId),
    );

    const stockItemReadAfterReapplyingClaims = await withHouseholdTransaction(
      db,
      reapplyClaimsHouseholdId,
      (tx) =>
        new StockItemRepositoryImpl(tx).findById(
          reapplyClaimsHouseholdId,
          reapplyClaimsStockItemId,
        ),
    );

    // ADR-029 理由(1): クレームを張り忘れた問い合わせは**0行**になる（例外ではない）。
    expect(stockItemReadWithoutClaims).toBeNull();
    // ADR-029 理由(4): 3つ目が、0行の理由を「見えない」に絞り込む唯一の手である
    // （1つ目が commit されていないだけ、では説明がつかなくなる）。
    expect(stockItemReadAfterReapplyingClaims?.name).toBe('にんじん');
  });

  it('トランザクションの本体が例外を投げると、その中で保存した在庫品は残らない', async () => {
    const bodyFailure = new Error('本体が投げた');

    // ADR-029 決定3(a): 寿命を持つのは呼ぶ側。本体が投げたら1つの単位ごと巻き戻る。
    await expect(
      withHouseholdTransaction(db, rollbackHouseholdId, async (tx) => {
        await new StockItemRepositoryImpl(tx).save(
          rollbackHouseholdId,
          stockItem({
            id: rollbackStockItemId,
            householdId: rollbackHouseholdId,
            name: 'にんじん',
          }),
        );
        throw bodyFailure;
      }),
    ).rejects.toBe(bodyFailure);

    const stockItemReadAfterReapplyingClaims = await withHouseholdTransaction(
      db,
      rollbackHouseholdId,
      (tx) => new StockItemRepositoryImpl(tx).findById(rollbackHouseholdId, rollbackStockItemId),
    );

    expect(stockItemReadAfterReapplyingClaims).toBeNull();
  });

  it('保存していない在庫品 ID を指すと null を返す', async () => {
    const readStockItem = await withHouseholdTransaction(db, notFoundHouseholdId, (tx) =>
      new StockItemRepositoryImpl(tx).findById(notFoundHouseholdId, unsavedStockItemId),
    );

    // B-07 設計 規則4: 0行は `null`。**例外にしない。**
    expect(readStockItem).toBeNull();
  });

  it('他世帯が保存した在庫品は null になる', async () => {
    await withHouseholdTransaction(db, ownerHouseholdId, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        ownerHouseholdId,
        stockItem({
          id: otherHouseholdStockItemId,
          householdId: ownerHouseholdId,
          name: 'にんじん',
        }),
      ),
    );

    const stockItemVisibleToStranger = await withHouseholdTransaction(
      db,
      strangerHouseholdId,
      (tx) =>
        new StockItemRepositoryImpl(tx).findById(strangerHouseholdId, otherHouseholdStockItemId),
    );

    const stockItemVisibleToOwner = await withHouseholdTransaction(db, ownerHouseholdId, (tx) =>
      new StockItemRepositoryImpl(tx).findById(ownerHouseholdId, otherHouseholdStockItemId),
    );

    // C-9 / NFR-09: 世帯をまたぐ取得は「無い」として扱う（例外にしない）。
    expect(stockItemVisibleToStranger).toBeNull();
    // 行が実在することの裏取り。無ければ `null` は当たり前に起きる。
    expect(stockItemVisibleToOwner?.name).toBe('にんじん');
  });

  it('クレームで見えている在庫品でも、引数の世帯が食い違えば null になる', async () => {
    const stockItemReadAsOtherHousehold = await withHouseholdTransaction(
      db,
      argumentMismatchHouseholdId,
      async (tx) => {
        const repository = new StockItemRepositoryImpl(tx);
        await repository.save(
          argumentMismatchHouseholdId,
          stockItem({
            id: mismatchStockItemId,
            householdId: argumentMismatchHouseholdId,
            name: 'にんじん',
          }),
        );
        // B-07 設計 規則3: RLS で見えていても、引数の世帯で必ず絞る（網は二重）。
        // `where` を外した実装なら、ここで在庫品が返ってしまう。
        return repository.findById(passedHouseholdId, mismatchStockItemId);
      },
    );

    // C-9 / NFR-09
    expect(stockItemReadAsOtherHousehold).toBeNull();
  });

  it('他世帯の在庫品と同じ ID の保存は成功せず、相手世帯の行も変わらない', async () => {
    await withHouseholdTransaction(db, collisionOwnerHouseholdId, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        collisionOwnerHouseholdId,
        stockItem({
          id: collisionStockItemId,
          householdId: collisionOwnerHouseholdId,
          name: 'にんじん',
        }),
      ),
    );

    // B-07 設計 規則13: **例外の型・コードは約束しない**（SQLSTATE を期待値に書かない）。
    await expect(
      withHouseholdTransaction(db, colliderHouseholdId, (tx) =>
        new StockItemRepositoryImpl(tx).save(
          colliderHouseholdId,
          stockItem({
            id: collisionStockItemId,
            householdId: colliderHouseholdId,
            name: 'たまねぎ',
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(Error);

    const stockItemVisibleToOwner = await withHouseholdTransaction(
      db,
      collisionOwnerHouseholdId,
      (tx) =>
        new StockItemRepositoryImpl(tx).findById(collisionOwnerHouseholdId, collisionStockItemId),
    );

    // C-9 / NFR-09: このケースの重心はここ。例外だけでは、他世帯の行を上書きしたうえで
    // 別の理由で投げた実装と見分けがつかない。
    expect(stockItemVisibleToOwner?.name).toBe('にんじん');
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
const overwriteHouseholdId = householdIdOf('b7080000-0000-4000-8000-000000000008');
const overwriteStockItemId = stockItemIdOf('b7080000-0000-4000-8000-0000000000f8');

const clearAmountHouseholdId = householdIdOf('b7090000-0000-4000-8000-000000000009');
const clearAmountStockItemId = stockItemIdOf('b7090000-0000-4000-8000-0000000000f9');

const clearExpiryDateHouseholdId = householdIdOf('b70a0000-0000-4000-8000-00000000000a');
const clearExpiryDateStockItemId = stockItemIdOf('b70a0000-0000-4000-8000-0000000000fa');

const clearIngredientHouseholdId = householdIdOf('b70b0000-0000-4000-8000-00000000000b');
const clearIngredientStockItemId = stockItemIdOf('b70b0000-0000-4000-8000-0000000000fb');

const saveMismatchHouseholdId = householdIdOf('b70c0000-0000-4000-8000-00000000000c');
const saveMismatchStockItemSideHouseholdId = householdIdOf('b70c0000-0000-4000-8000-00000000001c');
const saveMismatchStockItemId = stockItemIdOf('b70c0000-0000-4000-8000-0000000000fc');

const untouchedHouseholdId = householdIdOf('b70d0000-0000-4000-8000-00000000000d');
const untouchedStockItemSideHouseholdId = householdIdOf('b70d0000-0000-4000-8000-00000000001d');
const untouchedStockItemId = stockItemIdOf('b70d0000-0000-4000-8000-0000000000fd');

const deletionHouseholdId = householdIdOf('b70e0000-0000-4000-8000-00000000000e');
const deletionStockItemId = stockItemIdOf('b70e0000-0000-4000-8000-0000000000fe');

const unsavedDeletionHouseholdId = householdIdOf('b70f0000-0000-4000-8000-00000000000f');
const unsavedDeletionStockItemId = stockItemIdOf('b70f0000-0000-4000-8000-0000000000ff');

const deletionOwnerHouseholdId = householdIdOf('b7100000-0000-4000-8000-000000000010');
const deletionStrangerHouseholdId = householdIdOf('b7100000-0000-4000-8000-000000000020');
const otherHouseholdDeletionStockItemId = stockItemIdOf('b7100000-0000-4000-8000-0000000000a1');

const deletionMismatchHouseholdId = householdIdOf('b7110000-0000-4000-8000-000000000011');
const deletionPassedHouseholdId = householdIdOf('b7110000-0000-4000-8000-000000000021');
const deletionMismatchStockItemId = stockItemIdOf('b7110000-0000-4000-8000-0000000000a2');

const listingHouseholdId = householdIdOf('b7120000-0000-4000-8000-000000000012');
const listingStockItemId1 = stockItemIdOf('b7120000-0000-4000-8000-0000000000a3');
const listingStockItemId2 = stockItemIdOf('b7120000-0000-4000-8000-0000000000a4');
const listingStockItemId3 = stockItemIdOf('b7120000-0000-4000-8000-0000000000a5');

const emptyListingHouseholdId = householdIdOf('b7130000-0000-4000-8000-000000000013');

const listingOwnerHouseholdId = householdIdOf('b7140000-0000-4000-8000-000000000014');
const listingStrangerHouseholdId = householdIdOf('b7140000-0000-4000-8000-000000000024');
const ownHouseholdStockItemId1 = stockItemIdOf('b7140000-0000-4000-8000-0000000000a6');
const ownHouseholdStockItemId2 = stockItemIdOf('b7140000-0000-4000-8000-0000000000a7');
const otherHouseholdListingStockItemId = stockItemIdOf('b7140000-0000-4000-8000-0000000000b7');

const listingMismatchHouseholdId = householdIdOf('b7150000-0000-4000-8000-000000000015');
const listingPassedHouseholdId = householdIdOf('b7150000-0000-4000-8000-000000000025');
const listingMismatchStockItemId = stockItemIdOf('b7150000-0000-4000-8000-0000000000a8');

const valueRoundTripHouseholdId = householdIdOf('b7160000-0000-4000-8000-000000000016');
const valueRoundTripStockItemId = stockItemIdOf('b7160000-0000-4000-8000-0000000000a9');

const whitespaceHouseholdId = householdIdOf('b7170000-0000-4000-8000-000000000017');
const whitespaceStockItemId = stockItemIdOf('b7170000-0000-4000-8000-0000000000aa');

const nonUuidIngredientHouseholdId = householdIdOf('b7180000-0000-4000-8000-000000000018');
const nonUuidIngredientStockItemId = stockItemIdOf('b7180000-0000-4000-8000-0000000000ab');

// カタログの食材を指す識別子。**外部キーは張られていない**（ADR-008 / FR-03）ため、
// カタログに行が無くても保存できる。列の型は uuid なので書式だけは合わせる。
const carrotIngredientId = '11110000-0000-4000-8000-000000000001';
const onionIngredientId = '11110000-0000-4000-8000-000000000002';
const ingredientIdBeforeClearing = '11110000-0000-4000-8000-000000000003';
const valueRoundTripIngredientId = '11110000-0000-4000-8000-000000000004';

describe('在庫品リポジトリの実装（上書き・削除・一覧・値の写像）', () => {
  it('同じ ID で2度 save すると、名称・食材 ID・分量・期限が2回目の値になる', async () => {
    const readBackStockItem = await withHouseholdTransaction(
      db,
      overwriteHouseholdId,
      async (tx) => {
        const repository = new StockItemRepositoryImpl(tx);
        await repository.save(
          overwriteHouseholdId,
          stockItem({
            id: overwriteStockItemId,
            householdId: overwriteHouseholdId,
            name: 'にんじん',
            ingredientId: carrotIngredientId,
            amount: '1本',
            expiryDate: '2026-01-31',
          }),
        );
        await repository.save(
          overwriteHouseholdId,
          stockItem({
            id: overwriteStockItemId,
            householdId: overwriteHouseholdId,
            name: 'たまねぎ',
            ingredientId: onionIngredientId,
            amount: '2個',
            expiryDate: '2026-02-28',
          }),
        );
        return repository.findById(overwriteHouseholdId, overwriteStockItemId);
      },
    );

    // FR-05 / B-07 設計 規則7・8: 上書きの対象は4列すべて。`household_id` は上書きしない。
    expect(readBackStockItem).toMatchObject({
      householdId: overwriteHouseholdId,
      name: 'たまねぎ',
      ingredientId: '11110000-0000-4000-8000-000000000002',
      amount: '2個',
      expiryDate: '2026-02-28',
    });
  });

  it('分量を null にした save は、保存済みの分量を消す', async () => {
    const readBackStockItem = await withHouseholdTransaction(
      db,
      clearAmountHouseholdId,
      async (tx) => {
        const repository = new StockItemRepositoryImpl(tx);
        await repository.save(
          clearAmountHouseholdId,
          stockItem({
            id: clearAmountStockItemId,
            householdId: clearAmountHouseholdId,
            name: 'にんじん',
            amount: '1本',
          }),
        );
        await repository.save(
          clearAmountHouseholdId,
          stockItem({
            id: clearAmountStockItemId,
            householdId: clearAmountHouseholdId,
            name: 'にんじん',
            amount: null,
          }),
        );
        return repository.findById(clearAmountHouseholdId, clearAmountStockItemId);
      },
    );

    // FR-05 / B-07 設計 規則8・9: 分量を**消す**更新が主役。`null` もそのまま書く。
    expect(readBackStockItem?.amount).toBeNull();
  });

  it('期限を null にした save は、保存済みの期限を消す', async () => {
    const readBackStockItem = await withHouseholdTransaction(
      db,
      clearExpiryDateHouseholdId,
      async (tx) => {
        const repository = new StockItemRepositoryImpl(tx);
        await repository.save(
          clearExpiryDateHouseholdId,
          stockItem({
            id: clearExpiryDateStockItemId,
            householdId: clearExpiryDateHouseholdId,
            name: 'にんじん',
            expiryDate: '2026-03-01',
          }),
        );
        await repository.save(
          clearExpiryDateHouseholdId,
          stockItem({
            id: clearExpiryDateStockItemId,
            householdId: clearExpiryDateHouseholdId,
            name: 'にんじん',
            expiryDate: null,
          }),
        );
        return repository.findById(clearExpiryDateHouseholdId, clearExpiryDateStockItemId);
      },
    );

    // FR-05 / B-07 設計 規則8・10
    expect(readBackStockItem?.expiryDate).toBeNull();
  });

  it('食材 ID を null にした save は、保存済みの食材 ID を消す', async () => {
    const readBackStockItem = await withHouseholdTransaction(
      db,
      clearIngredientHouseholdId,
      async (tx) => {
        const repository = new StockItemRepositoryImpl(tx);
        await repository.save(
          clearIngredientHouseholdId,
          stockItem({
            id: clearIngredientStockItemId,
            householdId: clearIngredientHouseholdId,
            name: 'にんじん',
            ingredientId: ingredientIdBeforeClearing,
          }),
        );
        await repository.save(
          clearIngredientHouseholdId,
          stockItem({
            id: clearIngredientStockItemId,
            householdId: clearIngredientHouseholdId,
            name: 'にんじん',
            ingredientId: null,
          }),
        );
        return repository.findById(clearIngredientHouseholdId, clearIngredientStockItemId);
      },
    );

    // FR-03 / B-07 設計 規則8: カタログを指さない在庫品に戻せる。
    expect(readBackStockItem?.ingredientId).toBeNull();
  });

  it('引数の世帯と在庫品の世帯が食い違う save を拒む', async () => {
    const saveExecution = withHouseholdTransaction(db, saveMismatchHouseholdId, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        saveMismatchHouseholdId,
        stockItem({
          id: saveMismatchStockItemId,
          householdId: saveMismatchStockItemSideHouseholdId,
          name: 'にんじん',
        }),
      ),
    );

    // C-9 / B-07 設計 規則6・7章: RLS の拒否に任せない — 任せると `rule` の付かない
    // 別の失敗になり、呼ぶ側が理由で分岐できない。
    await expect(saveExecution).rejects.toThrow(PantryRuleViolation);
    await expect(saveExecution).rejects.toHaveProperty('rule', 'save.householdMismatch');
  });

  it('食い違う save は DB に触らない', async () => {
    const stockItemReadInSameTransaction = await withHouseholdTransaction(
      db,
      untouchedHouseholdId,
      async (tx) => {
        const repository = new StockItemRepositoryImpl(tx);

        // 拒否は**同じトランザクションの中で**捕まえる。外で捕まえると単位が終わって
        // しまい、「DB に触っていない」ことが見えない（B-07 設計 規則6）。
        await expect(
          repository.save(
            untouchedHouseholdId,
            stockItem({
              id: untouchedStockItemId,
              householdId: untouchedStockItemSideHouseholdId,
              name: 'にんじん',
            }),
          ),
        ).rejects.toThrow(PantryRuleViolation);

        // RLS に任せた実装なら、拒まれた文でトランザクションが中断していて、
        // この問い合わせ自体が落ちる。
        return repository.findById(untouchedHouseholdId, untouchedStockItemId);
      },
    );

    const stockItemReadAsStockItemSideHousehold = await withHouseholdTransaction(
      db,
      untouchedStockItemSideHouseholdId,
      (tx) =>
        new StockItemRepositoryImpl(tx).findById(
          untouchedStockItemSideHouseholdId,
          untouchedStockItemId,
        ),
    );

    expect(stockItemReadInSameTransaction).toBeNull();
    // 在庫品側の世帯にも行は残らない（**書かれていない**ことの裏取り）。
    expect(stockItemReadAsStockItemSideHousehold).toBeNull();
  });

  it('保存した在庫品を delete すると findById が null になる', async () => {
    const stockItemReadAfterDelete = await withHouseholdTransaction(
      db,
      deletionHouseholdId,
      async (tx) => {
        const repository = new StockItemRepositoryImpl(tx);
        await repository.save(
          deletionHouseholdId,
          stockItem({
            id: deletionStockItemId,
            householdId: deletionHouseholdId,
            name: 'にんじん',
          }),
        );
        await repository.delete(deletionHouseholdId, deletionStockItemId);
        return repository.findById(deletionHouseholdId, deletionStockItemId);
      },
    );

    // FR-06 / B-07 設計 規則12: 削除は物理削除でよい（C-5 により献立は参照を持たない）。
    expect(stockItemReadAfterDelete).toBeNull();
  });

  it('保存していない ID の delete は何もせずに成功する', async () => {
    const deleteExecution = withHouseholdTransaction(db, unsavedDeletionHouseholdId, (tx) =>
      new StockItemRepositoryImpl(tx).delete(
        unsavedDeletionHouseholdId,
        unsavedDeletionStockItemId,
      ),
    );

    // ADR-027 / B-07 設計 規則12: 影響行数を見ず、例外にしない。「無い」の判定は
    // ユースケース層が `findById` で行う。
    await expect(deleteExecution).resolves.toBeUndefined();
  });

  it('他世帯の在庫品を指す delete は成功し、相手世帯の行も消えない', async () => {
    await withHouseholdTransaction(db, deletionOwnerHouseholdId, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        deletionOwnerHouseholdId,
        stockItem({
          id: otherHouseholdDeletionStockItemId,
          householdId: deletionOwnerHouseholdId,
          name: 'にんじん',
        }),
      ),
    );

    const strangerDeleteExecution = withHouseholdTransaction(
      db,
      deletionStrangerHouseholdId,
      (tx) =>
        new StockItemRepositoryImpl(tx).delete(
          deletionStrangerHouseholdId,
          otherHouseholdDeletionStockItemId,
        ),
    );

    await expect(strangerDeleteExecution).resolves.toBeUndefined();

    const stockItemVisibleToOwner = await withHouseholdTransaction(
      db,
      deletionOwnerHouseholdId,
      (tx) =>
        new StockItemRepositoryImpl(tx).findById(
          deletionOwnerHouseholdId,
          otherHouseholdDeletionStockItemId,
        ),
    );

    // C-9 / NFR-09: このケースの重心はここ。成功するだけなら、行を消したうえで
    // 成功した実装と見分けがつかない。
    expect(stockItemVisibleToOwner?.name).toBe('にんじん');
  });

  it('クレームで見えている在庫品でも、引数の世帯が食い違う delete では消えない', async () => {
    const stockItemReadAfterDelete = await withHouseholdTransaction(
      db,
      deletionMismatchHouseholdId,
      async (tx) => {
        const repository = new StockItemRepositoryImpl(tx);
        await repository.save(
          deletionMismatchHouseholdId,
          stockItem({
            id: deletionMismatchStockItemId,
            householdId: deletionMismatchHouseholdId,
            name: 'にんじん',
          }),
        );
        // B-07 設計 規則3: RLS で見えていても、引数の世帯で必ず絞る（網は二重）。
        // `where` から世帯を外した実装なら、ここで消えてしまう。
        await repository.delete(deletionPassedHouseholdId, deletionMismatchStockItemId);
        return repository.findById(deletionMismatchHouseholdId, deletionMismatchStockItemId);
      },
    );

    // C-9
    expect(stockItemReadAfterDelete?.name).toBe('にんじん');
  });

  it('その世帯の在庫品をすべて返す', async () => {
    const foundStockItems = await withHouseholdTransaction(db, listingHouseholdId, async (tx) => {
      const repository = new StockItemRepositoryImpl(tx);
      await repository.save(
        listingHouseholdId,
        stockItem({ id: listingStockItemId1, householdId: listingHouseholdId, name: 'にんじん' }),
      );
      await repository.save(
        listingHouseholdId,
        stockItem({ id: listingStockItemId2, householdId: listingHouseholdId, name: 'たまねぎ' }),
      );
      await repository.save(
        listingHouseholdId,
        stockItem({ id: listingStockItemId3, householdId: listingHouseholdId, name: 'じゃがいも' }),
      );
      return repository.findByHousehold(listingHouseholdId);
    });

    // B-07 設計 規則5: **並び順を約束しない**（並べるのは呼ぶ側）。だから期待値も
    // 集合で書く — 順序を書くと、約束していないものを守らせることになる。
    expect(foundStockItems).toHaveLength(3);
    expect(new Set(foundStockItems.map((stockItem) => stockItem.id))).toEqual(
      new Set([listingStockItemId1, listingStockItemId2, listingStockItemId3]),
    );
  });

  it('在庫品が1件も無い世帯には空の配列を返す', async () => {
    const foundStockItems = await withHouseholdTransaction(db, emptyListingHouseholdId, (tx) =>
      new StockItemRepositoryImpl(tx).findByHousehold(emptyListingHouseholdId),
    );

    // B-07 設計 規則5・7章: 0行は空の配列。`null` でも例外でもない。
    expect(foundStockItems).toEqual([]);
  });

  it('他世帯の在庫品は findByHousehold に含まれない', async () => {
    await withHouseholdTransaction(db, listingOwnerHouseholdId, async (tx) => {
      const repository = new StockItemRepositoryImpl(tx);
      await repository.save(
        listingOwnerHouseholdId,
        stockItem({
          id: ownHouseholdStockItemId1,
          householdId: listingOwnerHouseholdId,
          name: 'にんじん',
        }),
      );
      await repository.save(
        listingOwnerHouseholdId,
        stockItem({
          id: ownHouseholdStockItemId2,
          householdId: listingOwnerHouseholdId,
          name: 'たまねぎ',
        }),
      );
    });

    await withHouseholdTransaction(db, listingStrangerHouseholdId, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        listingStrangerHouseholdId,
        stockItem({
          id: otherHouseholdListingStockItemId,
          householdId: listingStrangerHouseholdId,
          name: 'じゃがいも',
        }),
      ),
    );

    const foundStockItems = await withHouseholdTransaction(db, listingOwnerHouseholdId, (tx) =>
      new StockItemRepositoryImpl(tx).findByHousehold(listingOwnerHouseholdId),
    );

    const foundIds = foundStockItems.map((stockItem) => stockItem.id);

    // C-9 / NFR-09: 世帯をまたぐ取得を許さない。順序は約束しないので集合で比べる。
    expect(new Set(foundIds)).toEqual(
      new Set([ownHouseholdStockItemId1, ownHouseholdStockItemId2]),
    );
    expect(foundIds).not.toContain(otherHouseholdListingStockItemId);
  });

  it('クレームで見えている在庫品でも、引数の世帯が食い違えば findByHousehold は空になる', async () => {
    const foundStockItems = await withHouseholdTransaction(
      db,
      listingMismatchHouseholdId,
      async (tx) => {
        const repository = new StockItemRepositoryImpl(tx);
        await repository.save(
          listingMismatchHouseholdId,
          stockItem({
            id: listingMismatchStockItemId,
            householdId: listingMismatchHouseholdId,
            name: 'にんじん',
          }),
        );
        // B-07 設計 規則3: `where` を外した実装なら、ここで在庫品が返ってしまう。
        return repository.findByHousehold(listingPassedHouseholdId);
      },
    );

    // C-9
    expect(foundStockItems).toEqual([]);
  });

  it('分量・期限・食材 ID を持つ在庫品を保存すると、3つとも同じ値で読み戻せる', async () => {
    const readBackStockItem = await withHouseholdTransaction(
      db,
      valueRoundTripHouseholdId,
      async (tx) => {
        const repository = new StockItemRepositoryImpl(tx);
        await repository.save(
          valueRoundTripHouseholdId,
          stockItem({
            id: valueRoundTripStockItemId,
            householdId: valueRoundTripHouseholdId,
            name: 'こむぎこ',
            ingredientId: valueRoundTripIngredientId,
            amount: '大さじ 1と1/2',
            expiryDate: '2026-12-31',
          }),
        );
        return repository.findById(valueRoundTripHouseholdId, valueRoundTripStockItemId);
      },
    );

    // ADR-010: 分量は自由文字列。数値と単位に分解しない。
    expect(readBackStockItem?.amount).toBe('大さじ 1と1/2');
    // B-07 設計 規則10: 期限は `YYYY-MM-DD` の**文字列**。時刻もタイムゾーンも付かない。
    expect(readBackStockItem?.expiryDate).toBe('2026-12-31');
    expect(readBackStockItem?.ingredientId).toBe('11110000-0000-4000-8000-000000000004');
  });

  it('名称の前後に空白のある行を読み戻すと、空白の落ちた在庫品になる', async () => {
    const readBackStockItem = await withHouseholdTransaction(
      db,
      whitespaceHouseholdId,
      async (tx) => {
        // 行を直接差し込むのは、リポジトリの `save` を通すと空白がどこで落ちたか
        // 見分けられないため。**クレームを張った単位の中で、`authenticator` のまま**行う
        // （所有者の接続を使うと RLS が素通りする）。
        await tx.execute(sql`
        insert into stock_items (id, household_id, name)
        values (${whitespaceStockItemId}, ${whitespaceHouseholdId}, '  にんじん  ')
      `);

        return new StockItemRepositoryImpl(tx).findById(
          whitespaceHouseholdId,
          whitespaceStockItemId,
        );
      },
    );

    // C-6: 充足判定は名称の完全一致。前後の空白が残ると、同じ食材が別物になる
    // （B-07 設計 規則11: 行から組むときも `createStockItem` を通す）。
    expect(readBackStockItem?.name).toBe('にんじん');
  });

  it('uuid でない食材 ID の保存は、DB の拒否がそのまま伝わる', async () => {
    const thrown = await withHouseholdTransaction(db, nonUuidIngredientHouseholdId, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        nonUuidIngredientHouseholdId,
        stockItem({
          id: nonUuidIngredientStockItemId,
          householdId: nonUuidIngredientHouseholdId,
          name: 'にんじん',
          ingredientId: 'にんじん',
        }),
      ),
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(Error);
    // ADR-002 / B-07 設計 7章: DB が拒んだ書き込みを**ドメインの例外型に包み直さない**。
    // interface が約束していない規則を実装で増やさない。
    expect(thrown).not.toBeInstanceOf(PantryRuleViolation);
  });
});
