import { describe, expect, it } from 'vitest';
import { deleteStockItem } from '../../../../src/contexts/pantry/usecase/DeleteStockItem.js';
import type { StockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { createStockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { PantryRuleViolation } from '../../../../src/contexts/pantry/domain/error/PantryRuleViolation.js';
import type { StockItemRepository } from '../../../../src/contexts/pantry/domain/repository/StockItemRepository.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import { amountOf } from '../../../../src/contexts/pantry/domain/value/Amount.js';
import { expiryDateOf } from '../../../../src/contexts/pantry/domain/value/ExpiryDate.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryStockItemRepository } from '../../../support/pantry/InMemoryStockItemRepository.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

const idA = '22222222-2222-4222-8222-222222222222';
const idB = '33333333-3333-4333-8333-333333333333';
const unsavedId = '44444444-4444-4444-8444-444444444444';

/** テストの本題でない項目を隠す（`docs/testing.md` 6章）。本題だけが引数に現れる。 */
function stockItem(props: {
  id?: string;
  householdId?: HouseholdId;
  name?: string;
  amount?: string;
  expiryDate?: string;
}): StockItem {
  return createStockItem({
    id: stockItemIdOf(props.id ?? idA),
    householdId: props.householdId ?? ourHousehold,
    name: props.name ?? 'にんじん',
    ingredientId: null,
    amount: props.amount === undefined ? null : amountOf(props.amount),
    expiryDate: expiryDateOf(props.expiryDate ?? null),
    useForMeals: true,
  });
}

/**
 * リポジトリを記憶上の実装で組み、ユースケースを1つ作る。
 * 前提の在庫品は**登録の経路を通さずリポジトリへ直接置く**（B-06 設計書 8章）。
 */
function setUp() {
  const stockItemRepository = new InMemoryStockItemRepository();
  const runDelete = deleteStockItem({ stockItemRepository });

  return { stockItemRepository, runDelete };
}

async function store(
  stockItemRepository: StockItemRepository,
  ...stockItems: readonly StockItem[]
) {
  for (const stockItem of stockItems) {
    await stockItemRepository.save(stockItem.householdId, stockItem);
  }
}

/** 投げられたものをそのまま受け取る。型と `rule` を突き合わせるためのもの。 */
async function thrownBy(execution: Promise<unknown>): Promise<unknown> {
  return execution.then(
    () => null,
    (thrown: unknown) => thrown,
  );
}

/** 削除だけが必ず失敗する記憶上の実装。取り出しと保存は共有のものをそのまま使う。 */
class DeleteFailure extends Error {}

class FailingDeleteInMemoryStockItemRepository extends InMemoryStockItemRepository {
  override async delete(): Promise<void> {
    throw new DeleteFailure('削除できない');
  }
}

/**
 * 削除を受け付けながら何も消さない記憶上の実装。取り出しと保存は共有のものをそのまま使う。
 * `findById` と `delete` の間に他のセッションが戻した状況を、テストの中で作るためのもの。
 */
class NoOpDeleteInMemoryStockItemRepository extends InMemoryStockItemRepository {
  override async delete(): Promise<void> {}
}

describe('在庫品を削除する DeleteStockItem', () => {
  it('自分の世帯の在庫品を削除すると、その世帯から取り出せなくなる', async () => {
    // FR-06 / 規則5: 確認に通ったら削除する。物理削除でよく、献立は材料を
    // 文字列で複製済みで在庫品を参照しない（C-5）。
    const { stockItemRepository, runDelete } = setUp();
    await store(stockItemRepository, stockItem({ name: 'にんじん' }));

    await runDelete(ourHousehold, stockItemIdOf(idA));

    expect(await stockItemRepository.findById(ourHousehold, stockItemIdOf(idA))).toBeNull();
  });

  it('削除が成功したとき、返るものは無い', async () => {
    // 規則9 / ADR-003: 成功は例外が出ないことで表す。「消した件数」を返さない。
    const { stockItemRepository, runDelete } = setUp();
    await store(stockItemRepository, stockItem({ name: 'にんじん' }));

    await expect(runDelete(ourHousehold, stockItemIdOf(idA))).resolves.toBeUndefined();
  });

  it('削除するのは指した1件だけで、同じ世帯の他の在庫品は残る', async () => {
    // FR-06 / 規則7: 指した識別子の1件だけが消え、他のデータに波及しない。
    const { stockItemRepository, runDelete } = setUp();
    await store(
      stockItemRepository,
      stockItem({ id: idA, name: 'にんじん' }),
      stockItem({ id: idB, name: 'たまねぎ' }),
    );

    await runDelete(ourHousehold, stockItemIdOf(idA));

    const remainingStockItems = await stockItemRepository.findByHousehold(ourHousehold);
    expect(remainingStockItems).toHaveLength(1);
    expect(remainingStockItems[0]?.name).toBe('たまねぎ');
  });

  it('削除は、残った在庫品の分量と期限を書き換えない', async () => {
    // 規則10 / C-8: 削除は在庫の増減に触れない。
    const { stockItemRepository, runDelete } = setUp();
    await store(
      stockItemRepository,
      stockItem({ id: idA, name: 'にんじん' }),
      stockItem({ id: idB, name: 'たまねぎ', amount: '2本', expiryDate: '2026-10-01' }),
    );

    await runDelete(ourHousehold, stockItemIdOf(idA));

    const found = await stockItemRepository.findById(ourHousehold, stockItemIdOf(idB));
    expect(found?.amount).toBe('2本');
    expect(found?.expiryDate).toBe('2026-10-01');
  });

  it('存在しない識別子の削除を断る', async () => {
    // 規則2 / FR-06: 削除の前に存在を確かめ、無ければ削除を呼ばずに断る。
    const { runDelete } = setUp();

    const execution = runDelete(ourHousehold, stockItemIdOf(unsavedId));

    await expect(execution).rejects.toThrow(PantryRuleViolation);
    await expect(execution).rejects.toHaveProperty('rule', 'delete.notFound');
  });

  it('他の世帯の在庫品は、識別子を正しく指しても削除できない', async () => {
    // C-9 / 規則1・規則3: 世帯は第1引数の値だけで決まる。
    const { stockItemRepository, runDelete } = setUp();
    await store(
      stockItemRepository,
      stockItem({ householdId: neighborHousehold, name: 'にんじん' }),
    );

    const execution = runDelete(ourHousehold, stockItemIdOf(idA));

    await expect(execution).rejects.toThrow(PantryRuleViolation);
    await expect(execution).rejects.toHaveProperty('rule', 'delete.notFound');
  });

  it('一度削除した識別子の、二度目の削除を断る', async () => {
    // 規則4: 削除は冪等でない。1件も消していない呼び出しを成功と呼ばない。
    const { stockItemRepository, runDelete } = setUp();
    await store(stockItemRepository, stockItem({ name: 'にんじん' }));
    await runDelete(ourHousehold, stockItemIdOf(idA));

    const second = runDelete(ourHousehold, stockItemIdOf(idA));

    await expect(second).rejects.toThrow(PantryRuleViolation);
    await expect(second).rejects.toHaveProperty('rule', 'delete.notFound');
  });

  it('存在しない識別子と他の世帯の識別子は、同じ rule と同じ文言で断る', async () => {
    // C-9 / NFR-09 / 規則3: 区別を呼び出し側に返さない。文言そのものは検証しない
    // （実装詳細。`docs/testing.md` 3章）ので、2つを互いに突き合わせる。
    const { stockItemRepository, runDelete } = setUp();
    await store(
      stockItemRepository,
      stockItem({ householdId: neighborHousehold, name: 'にんじん' }),
    );

    const thrownForMissingId = await thrownBy(runDelete(ourHousehold, stockItemIdOf(unsavedId)));
    const thrownForNeighborHouseholdId = await thrownBy(
      runDelete(ourHousehold, stockItemIdOf(idA)),
    );

    expect(thrownForMissingId).toBeInstanceOf(PantryRuleViolation);
    expect(thrownForNeighborHouseholdId).toBeInstanceOf(PantryRuleViolation);
    expect((thrownForNeighborHouseholdId as PantryRuleViolation).rule).toBe(
      (thrownForMissingId as PantryRuleViolation).rule,
    );
    expect((thrownForNeighborHouseholdId as PantryRuleViolation).message).toBe(
      (thrownForMissingId as PantryRuleViolation).message,
    );
  });

  it('他の世帯の在庫品の削除を断ったあとも、その在庫品は消えていない', async () => {
    // C-9 / NFR-09: 断ることと、隣の世帯のデータに触れないことは別の主張である。
    const { stockItemRepository, runDelete } = setUp();
    await store(
      stockItemRepository,
      stockItem({ householdId: neighborHousehold, name: 'にんじん' }),
    );

    await expect(runDelete(ourHousehold, stockItemIdOf(idA))).rejects.toThrow(PantryRuleViolation);

    const found = await stockItemRepository.findById(neighborHousehold, stockItemIdOf(idA));
    expect(found?.name).toBe('にんじん');
  });

  it('削除に失敗したときは、その例外をそのまま呼び出し側へ伝える', async () => {
    // ADR-002 / 7章: ユースケースは握りつぶさない。HTTP への写像は B-08 の仕事。
    const stockItemRepository = new FailingDeleteInMemoryStockItemRepository();
    await store(stockItemRepository, stockItem({ name: 'にんじん' }));
    const runDelete = deleteStockItem({ stockItemRepository });

    await expect(runDelete(ourHousehold, stockItemIdOf(idA))).rejects.toThrow(DeleteFailure);
  });

  it('削除しても在庫品が残ってしまう実装でも、断らずに成功する', async () => {
    // 規則5・規則6: MVP は競合を検出しない。削除を呼んだあとに読み直して
    // 消えたことを確かめない。確かめても、その直後に戻される可能性は消えない。
    const stockItemRepository = new NoOpDeleteInMemoryStockItemRepository();
    await store(stockItemRepository, stockItem({ name: 'にんじん' }));
    const runDelete = deleteStockItem({ stockItemRepository });

    await expect(runDelete(ourHousehold, stockItemIdOf(idA))).resolves.toBeUndefined();
  });
});
