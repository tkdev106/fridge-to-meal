import { describe, expect, it } from 'vitest';
import type { StockItemRepository } from '../../../../src/contexts/pantry/domain/repository/StockItemRepository.js';
import { createStockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import { amountOf } from '../../../../src/contexts/pantry/domain/value/Amount.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { PantryRuleViolation } from '../../../../src/contexts/pantry/domain/error/PantryRuleViolation.js';
import { InMemoryStockItemRepository } from '../../../support/pantry/InMemoryStockItemRepository.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

function carrot(householdId: HouseholdId, id = '22222222-2222-4222-8222-222222222222') {
  return createStockItem({
    id: stockItemIdOf(id),
    householdId,
    name: 'にんじん',
    ingredientId: null,
    amount: amountOf('2本'),
    expiryDate: null,
  });
}

/** 先頭の引数の型を並べる。C-9 が全メソッドに世帯識別子を要求していることの検査に使う。 */
type FirstParameter<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => unknown ? A[0] : never;
};

/**
 * 全メソッドの先頭が `HouseholdId` なら `true`、1つでも違えば `never`。
 * `never` になると下の代入が型検査で落ちる。
 */
type AllMethodsTakeHouseholdIdFirst =
  FirstParameter<StockItemRepository>[keyof StockItemRepository] extends HouseholdId ? true : never;

describe('在庫品リポジトリ StockItemRepository', () => {
  it('全メソッドが世帯識別子を先頭の引数に取る（C-9）', () => {
    // 型の主張。世帯識別子を取らないメソッドを足した時点で、この行が typecheck で落ちる。
    // 実行時には何も確かめていない — 確かめているのは型検査のほうである。
    const assertion: AllMethodsTakeHouseholdIdFirst = true;

    expect(assertion).toBe(true);
  });

  it('保存した在庫品を取り出せる', async () => {
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await repository.save(ourHousehold, carrot(ourHousehold));

    const found = await repository.findById(
      ourHousehold,
      stockItemIdOf('22222222-2222-4222-8222-222222222222'),
    );

    expect(found?.name).toBe('にんじん');
  });

  it('他の世帯の在庫品は取り出せない', async () => {
    // C-9 の核心。世帯をまたぐ取得が起きないことを、実装ごとにここで確かめられる。
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await repository.save(ourHousehold, carrot(ourHousehold));

    const found = await repository.findById(
      neighborHousehold,
      stockItemIdOf('22222222-2222-4222-8222-222222222222'),
    );

    expect(found).toBeNull();
  });

  it('一覧は自分の世帯のものだけを返す', async () => {
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await repository.save(ourHousehold, carrot(ourHousehold));
    await repository.save(
      neighborHousehold,
      carrot(neighborHousehold, '33333333-3333-4333-8333-333333333333'),
    );

    expect(await repository.findByHousehold(ourHousehold)).toHaveLength(1);
    expect(await repository.findByHousehold(neighborHousehold)).toHaveLength(1);
  });

  it('他の世帯の在庫品として保存しようとすると拒む', async () => {
    // interface では強制できない約束なので、実装ごとにここで確かめる。
    const repository: StockItemRepository = new InMemoryStockItemRepository();

    await expect(repository.save(neighborHousehold, carrot(ourHousehold))).rejects.toThrow(
      PantryRuleViolation,
    );
  });

  it('削除できる', async () => {
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    const id = stockItemIdOf('22222222-2222-4222-8222-222222222222');
    await repository.save(ourHousehold, carrot(ourHousehold));

    await repository.delete(ourHousehold, id);

    expect(await repository.findById(ourHousehold, id)).toBeNull();
  });

  it('他の世帯の在庫品は削除できない', async () => {
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    const id = stockItemIdOf('22222222-2222-4222-8222-222222222222');
    await repository.save(ourHousehold, carrot(ourHousehold));

    await repository.delete(neighborHousehold, id);

    expect(await repository.findById(ourHousehold, id)).not.toBeNull();
  });
});
