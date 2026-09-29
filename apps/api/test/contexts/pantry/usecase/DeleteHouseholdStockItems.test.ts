import { describe, expect, it } from 'vitest';
import { deleteHouseholdStockItems } from '../../../../src/contexts/pantry/usecase/DeleteHouseholdStockItems.js';
import type { StockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { createStockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import type { StockItemRepository } from '../../../../src/contexts/pantry/domain/repository/StockItemRepository.js';
import { expiryDateOf } from '../../../../src/contexts/pantry/domain/value/ExpiryDate.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryStockItemRepository } from '../../../support/pantry/InMemoryStockItemRepository.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

const idA = '22222222-2222-4222-8222-222222222222';
const idB = '33333333-3333-4333-8333-333333333333';
const idC = '44444444-4444-4444-8444-444444444444';

/** テストの本題でない項目を隠す（`docs/testing.md` 6章）。本題だけが引数に現れる。 */
function stockItem(props: { id: string; householdId?: HouseholdId; name?: string }): StockItem {
  return createStockItem({
    id: stockItemIdOf(props.id),
    householdId: props.householdId ?? ourHousehold,
    name: props.name ?? 'にんじん',
    ingredientId: null,
    amount: null,
    expiryDate: expiryDateOf(null),
  });
}

/**
 * リポジトリを記憶上の実装で組み、ユースケースを1つ作る。前提の在庫品は
 * **登録の経路を通さずリポジトリへ直接置く**（先行 `DeleteStockItem.test.ts`）。
 */
async function setUp(...stockItems: readonly StockItem[]) {
  const stockItemRepository = new InMemoryStockItemRepository();
  for (const stored of stockItems) {
    await stockItemRepository.save(stored.householdId, stored);
  }
  const runDelete = deleteHouseholdStockItems({ stockItemRepository });

  return { stockItemRepository, runDelete };
}

describe('deleteHouseholdStockItems', () => {
  describe('消えるもの（FR-27 / NFR-13）', () => {
    it('世帯の在庫品を消すと、その世帯の在庫品は1件も取り出せなくなる', async () => {
      // B-56a 規則2: 消す対象はその世帯の在庫品すべて。
      const { stockItemRepository, runDelete } = await setUp(
        stockItem({ id: idA, name: 'にんじん' }),
        stockItem({ id: idB, name: 'たまねぎ' }),
      );

      await runDelete(ourHousehold);

      await expect(stockItemRepository.findByHousehold(ourHousehold)).resolves.toEqual([]);
    });

    it('世帯の在庫品を消すと、削除済みの在庫品の名称も含めて、保存したことのある名称が残らない', async () => {
      // B-56a 規則2 / ADR-069 結果4 / ADR-072 結果1: 1件ずつの delete は名称を残すが、世帯ごと消すときは残さない。
      const { stockItemRepository, runDelete } = await setUp(
        stockItem({ id: idA, name: 'にんじん' }),
        stockItem({ id: idB, name: 'ごぼう' }),
      );
      await stockItemRepository.delete(ourHousehold, stockItemIdOf(idB));

      await runDelete(ourHousehold);

      await expect(stockItemRepository.findSavedNamesByHousehold(ourHousehold)).resolves.toEqual(
        [],
      );
    });
  });

  describe('世帯の分離（C-9 / NFR-09）', () => {
    it('他の世帯の在庫品は消えずに残る', async () => {
      // B-56a 規則3・4: 引数の世帯の行だけを消す。
      const { stockItemRepository, runDelete } = await setUp(
        stockItem({ id: idA }),
        stockItem({ id: idC, householdId: neighborHousehold, name: 'れんこん' }),
      );

      await runDelete(ourHousehold);

      const neighborStockItems = await stockItemRepository.findByHousehold(neighborHousehold);
      expect(neighborStockItems.map((stored) => stored.id)).toEqual([idC]);
    });

    it('他の世帯の保存したことのある名称は消えずに残る', async () => {
      // B-56a 規則3・4 / ADR-069: 名称の履歴も世帯ごとに持つ。
      const { stockItemRepository, runDelete } = await setUp(
        stockItem({ id: idA }),
        stockItem({ id: idC, householdId: neighborHousehold, name: 'れんこん' }),
      );

      await runDelete(ourHousehold);

      await expect(
        stockItemRepository.findSavedNamesByHousehold(neighborHousehold),
      ).resolves.toEqual(['れんこん']);
    });
  });

  describe('消す物が無いとき（B-56a 規則7）', () => {
    it('在庫品が1件も無い世帯でも、断らずに何も返さずに終わる', async () => {
      // 規則7: 存在を確かめない。「消えている」状態を求める操作である（`delete.notFound` とは逆）。
      const { runDelete } = await setUp();

      await expect(runDelete(ourHousehold)).resolves.toBeUndefined();
    });

    it('同じ世帯を続けて2度消しても、2度目も断らずに終わる', async () => {
      // 規則7: 2度目の呼び出しも同じ結末。
      const { runDelete } = await setUp(stockItem({ id: idA }));
      await runDelete(ourHousehold);

      await expect(runDelete(ourHousehold)).resolves.toBeUndefined();
    });
  });

  describe('失敗の伝え方（B-56a 規則8）', () => {
    it('リポジトリが投げた例外を包まずにそのまま伝える', async () => {
      // 規則8 / ADR-029 決定3(a): 包むと巻き戻しと写像の側が原因を読めなくなる。
      const failure = new Error('在庫を消せなかった');
      const failingStockItemRepository: StockItemRepository = {
        async findById() {
          return null;
        },
        async findByHousehold() {
          return [];
        },
        async findSavedNamesByHousehold() {
          return [];
        },
        async save() {},
        async delete() {},
        async deleteByHousehold() {
          throw failure;
        },
      };
      const runDelete = deleteHouseholdStockItems({
        stockItemRepository: failingStockItemRepository,
      });

      await expect(runDelete(ourHousehold)).rejects.toBe(failure);
    });
  });
});
