import { describe, expect, it } from 'vitest';
import { listSavedStockItemNames } from '../../../../src/contexts/pantry/usecase/ListSavedStockItemNames.js';
import { registerStockItem } from '../../../../src/contexts/pantry/usecase/RegisterStockItem.js';
import { deleteStockItem } from '../../../../src/contexts/pantry/usecase/DeleteStockItem.js';
import type { StockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { createStockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import type { StockItemRepository } from '../../../../src/contexts/pantry/domain/repository/StockItemRepository.js';
import type { StockItemId } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryStockItemRepository } from '../../../support/pantry/InMemoryStockItemRepository.js';
import { fixedStockItemIdGenerator } from '../../../support/pantry/FixedStockItemIdGenerator.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** 本題が識別子でないときの採番。 */
let sequence = 0;
function nextId() {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

/** テストの本題でない項目を隠す（`docs/testing.md` 6章）。本題だけが引数に現れる。 */
function stockItem(props: { id?: string; householdId?: HouseholdId; name: string }): StockItem {
  return createStockItem({
    id: stockItemIdOf(props.id ?? nextId()),
    householdId: props.householdId ?? ourHousehold,
    name: props.name,
    ingredientId: null,
    amount: null,
    expiryDate: null,
    useForMeals: true,
  });
}

/**
 * リポジトリを記憶上の実装で組み、ユースケースを1つ作る。
 * 前提の在庫品は、本題が登録と削除でない限り**リポジトリへ直接置く**。
 */
function setUp() {
  const stockItemRepository = new InMemoryStockItemRepository();
  const list = listSavedStockItemNames({ stockItemRepository });

  return { stockItemRepository, list };
}

async function store(
  stockItemRepository: StockItemRepository,
  ...stockItems: readonly StockItem[]
) {
  for (const stockItem of stockItems) {
    await stockItemRepository.save(stockItem.householdId, stockItem);
  }
}

/**
 * 世帯ごとの名称の配列を**毎回同じ参照で**返す記憶上の実装。名称の列を返すユースケースが
 * 受け取った配列をその場で並べ替えていないかを見るためだけのもので、共有の道具ではない
 * （`docs/testing.md` 6章。先行 `ListStockItems.test.ts` の `SameArrayInMemoryStockItemRepository`）。
 */
class SameArrayInMemoryStockItemRepository implements StockItemRepository {
  readonly #namesByHousehold = new Map<HouseholdId, string[]>();

  #namesOf(householdId: HouseholdId): string[] {
    const existing = this.#namesByHousehold.get(householdId);
    if (existing !== undefined) return existing;

    const created: string[] = [];
    this.#namesByHousehold.set(householdId, created);
    return created;
  }

  async findById(): Promise<StockItem | null> {
    // このテストでは使わない。
    return null;
  }

  async findByHousehold(): Promise<StockItem[]> {
    // このテストでは使わない。
    return [];
  }

  async findSavedNamesByHousehold(householdId: HouseholdId) {
    return this.#namesOf(householdId);
  }

  async save(householdId: HouseholdId, stockItem: StockItem) {
    const names = this.#namesOf(householdId);
    if (stockItem.householdId === householdId && !names.includes(stockItem.name)) {
      names.push(stockItem.name);
    }
  }

  async delete(_householdId: HouseholdId, _id: StockItemId) {
    // このテストでは使わない。
  }

  async deleteByHousehold(_householdId: HouseholdId) {
    // このテストでは使わない。
  }
}

/** 名称の取り出しだけが必ず失敗する記憶上の実装。 */
class FetchFailure extends Error {}

class FailingFetchInMemoryStockItemRepository extends InMemoryStockItemRepository {
  override async findSavedNamesByHousehold(): Promise<string[]> {
    throw new FetchFailure('取り出せない');
  }
}

describe('保存したことのある在庫品の名称を返す ListSavedStockItemNames', () => {
  it('その世帯で保存したことのある在庫品の名称を返す', async () => {
    // FR-02 / B-50d 規則1: 保存した在庫品の名称が履歴に残る。
    const { stockItemRepository, list } = setUp();
    await store(
      stockItemRepository,
      stockItem({ name: 'たまねぎ' }),
      stockItem({ name: 'にんじん' }),
    );

    expect(await list(ourHousehold)).toEqual(['たまねぎ', 'にんじん']);
  });

  it('登録した在庫品を削除しても、その名称を返す', async () => {
    // FR-02 / ADR-063 結果1 / B-50d 規則3: delete は名称を消さない。
    const { stockItemRepository, list } = setUp();
    const register = registerStockItem({
      stockItemRepository,
      generateStockItemId: fixedStockItemIdGenerator([idA]),
    });
    const runDelete = deleteStockItem({ stockItemRepository });
    await register(ourHousehold, { name: 'にんじん', useForMeals: true });

    await runDelete(ourHousehold, stockItemIdOf(idA));

    expect(await list(ourHousehold)).toEqual(['にんじん']);
  });

  it('在庫品を削除しても、同じ世帯の他の名称も消えない', async () => {
    // B-50d 規則3: 1件消しても履歴の他の名称に影響しない。
    const { stockItemRepository, list } = setUp();
    const register = registerStockItem({
      stockItemRepository,
      generateStockItemId: fixedStockItemIdGenerator([idA, idB]),
    });
    const runDelete = deleteStockItem({ stockItemRepository });
    await register(ourHousehold, { name: 'にんじん', useForMeals: true });
    await register(ourHousehold, { name: 'たまねぎ', useForMeals: true });

    await runDelete(ourHousehold, stockItemIdOf(idA));

    expect(await list(ourHousehold)).toEqual(['たまねぎ', 'にんじん']);
  });

  it('他の世帯で保存した名称は返さない（C-9）', async () => {
    // C-9 / NFR-09: 世帯は第1引数の値だけで決まる。
    const { stockItemRepository, list } = setUp();
    await store(
      stockItemRepository,
      stockItem({ name: 'にんじん' }),
      stockItem({ householdId: neighborHousehold, name: 'だいこん' }),
    );

    expect(await list(ourHousehold)).toEqual(['にんじん']);
  });

  it('名称を1つも保存していない世帯には、エラーにせず空の列を返す', async () => {
    // B-50d 規則5・6: 0件は空の列。
    const { stockItemRepository, list } = setUp();
    await store(
      stockItemRepository,
      stockItem({ householdId: neighborHousehold, name: 'だいこん' }),
    );

    expect(await list(ourHousehold)).toEqual([]);
  });

  it('名称をコード単位の昇順に並べる', async () => {
    // ADR-063 決定4 / B-50d 規則6: リポジトリは並びを約束しないので、ここで並べる。
    const { stockItemRepository, list } = setUp();
    await store(
      stockItemRepository,
      stockItem({ name: 'もやし' }),
      stockItem({ name: 'きゅうり' }),
      stockItem({ name: 'なす' }),
    );

    expect(await list(ourHousehold)).toEqual(['きゅうり', 'なす', 'もやし']);
  });

  it('比較は照合順序ではなくコード単位で行う', async () => {
    // B-50d 規則6: localeCompare は ICU に依存し、Workers と Node で同じ並びになる保証がない。
    const { stockItemRepository, list } = setUp();
    await store(stockItemRepository, stockItem({ name: 'milk' }), stockItem({ name: 'MILK' }));

    expect(await list(ourHousehold)).toEqual(['MILK', 'milk']);
  });

  it('保存した順序を逆にしても、同じ列を返す', async () => {
    // B-50d 規則5・6: 結果は findSavedNamesByHousehold が約束していない順序に依らない。
    const threeStockItems = [
      stockItem({ name: 'なす' }),
      stockItem({ name: 'きゅうり' }),
      stockItem({ name: 'もやし' }),
    ];
    const storedInOrder = setUp();
    await store(storedInOrder.stockItemRepository, ...threeStockItems);
    const storedInReverse = setUp();
    await store(storedInReverse.stockItemRepository, ...[...threeStockItems].reverse());

    const outputInOrder = await storedInOrder.list(ourHousehold);
    const outputInReverse = await storedInReverse.list(ourHousehold);

    expect(outputInOrder).toEqual(['きゅうり', 'なす', 'もやし']);
    expect(outputInReverse).toEqual(['きゅうり', 'なす', 'もやし']);
  });

  it('名称を返しても、リポジトリが返した配列の並びは変わらない', async () => {
    // B-50d 規則6 / 先行 ListStockItems 規則7: 受け取った配列をその場で書き換えない。
    const stockItemRepository: StockItemRepository = new SameArrayInMemoryStockItemRepository();
    const list = listSavedStockItemNames({ stockItemRepository });
    await store(
      stockItemRepository,
      stockItem({ name: 'こんぶ' }),
      stockItem({ name: 'たまねぎ' }),
      stockItem({ name: 'あじ' }),
    );

    await list(ourHousehold);

    expect(await stockItemRepository.findSavedNamesByHousehold(ourHousehold)).toEqual([
      'こんぶ',
      'たまねぎ',
      'あじ',
    ]);
  });

  it('名称の取り出しに失敗したときは、その例外をそのまま伝える', async () => {
    // B-50d 7章: ユースケースは握りつぶさない。
    const list = listSavedStockItemNames({
      stockItemRepository: new FailingFetchInMemoryStockItemRepository(),
    });

    await expect(list(ourHousehold)).rejects.toThrow(FetchFailure);
  });
});
