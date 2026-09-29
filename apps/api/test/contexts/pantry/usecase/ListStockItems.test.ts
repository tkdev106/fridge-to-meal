import { describe, expect, it } from 'vitest';
import type { ListStockItemsOutput } from '@fridge-to-meal/contract';
import { listStockItems } from '../../../../src/contexts/pantry/usecase/ListStockItems.js';
import type { StockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { createStockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import type { StockItemRepository } from '../../../../src/contexts/pantry/domain/repository/StockItemRepository.js';
import type { StockItemId } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import { amountOf } from '../../../../src/contexts/pantry/domain/value/Amount.js';
import { expiryDateOf } from '../../../../src/contexts/pantry/domain/value/ExpiryDate.js';
import { ingredientIdOf } from '../../../../src/contexts/pantry/domain/value/IngredientId.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryStockItemRepository } from '../../../support/pantry/InMemoryStockItemRepository.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * 本題が識別子でないときの採番。**同点の解き手として識別子を使う（規則4）ため、
 * 識別子まで同じ在庫品を作らない。** 並びを識別子で確かめるテストは自分で literal を渡す。
 */
let sequence = 0;
function nextId() {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

/** テストの本題でない項目を隠す（`docs/testing.md` 6章）。本題だけが引数に現れる。 */
function stockItem(props: {
  id?: string;
  householdId?: HouseholdId;
  name: string;
  ingredientId?: string;
  amount?: string;
  expiryDate?: string | null;
}): StockItem {
  return createStockItem({
    id: stockItemIdOf(props.id ?? nextId()),
    householdId: props.householdId ?? ourHousehold,
    name: props.name,
    ingredientId: props.ingredientId === undefined ? null : ingredientIdOf(props.ingredientId),
    amount: props.amount === undefined ? null : amountOf(props.amount),
    expiryDate: expiryDateOf(props.expiryDate ?? null),
  });
}

/**
 * リポジトリを記憶上の実装で組み、ユースケースを1つ作る。
 * 前提の在庫品は**登録の経路を通さずリポジトリへ直接置く**（B-05 設計書 8章）。
 */
function setUp() {
  const stockItemRepository = new InMemoryStockItemRepository();
  const list = listStockItems({ stockItemRepository });

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

const namesOf = (output: ListStockItemsOutput) =>
  output.stockItems.map((stockItem) => stockItem.name);
const idsOf = (output: ListStockItemsOutput) => output.stockItems.map((stockItem) => stockItem.id);

/**
 * 世帯ごとの配列を**毎回同じ参照で**返す記憶上の実装。一覧が受け取った配列をその場で
 * 並べ替えていないかを見るためだけのもので、共有の道具ではない（`docs/testing.md` 6章）。
 * 世帯で分けて持つのは、`findByHousehold` の「その世帯の在庫品をすべて返す」という
 * 約束から外れた実装をテストの側に作らないためである。
 */
class SameArrayInMemoryStockItemRepository implements StockItemRepository {
  readonly #storedByHousehold = new Map<HouseholdId, StockItem[]>();

  #arrayOf(householdId: HouseholdId): StockItem[] {
    const existing = this.#storedByHousehold.get(householdId);
    if (existing !== undefined) return existing;

    const created: StockItem[] = [];
    this.#storedByHousehold.set(householdId, created);
    return created;
  }

  async findById(householdId: HouseholdId, id: StockItemId) {
    return this.#arrayOf(householdId).find((stockItem) => stockItem.id === id) ?? null;
  }

  async findByHousehold(householdId: HouseholdId) {
    return this.#arrayOf(householdId);
  }

  async save(householdId: HouseholdId, stockItem: StockItem) {
    if (stockItem.householdId === householdId) this.#arrayOf(householdId).push(stockItem);
  }

  async findSavedNamesByHousehold(): Promise<string[]> {
    // このテストでは使わない。
    throw new Error('未実装');
  }

  async delete() {
    // このテストでは使わない。
  }

  async deleteByHousehold() {
    // このテストでは使わない。
  }
}

/** 取り出しだけが必ず失敗する記憶上の実装。 */
class FetchFailure extends Error {}

class FailingFetchInMemoryStockItemRepository extends InMemoryStockItemRepository {
  override async findByHousehold(): Promise<StockItem[]> {
    throw new FetchFailure('取り出せない');
  }
}

describe('在庫品を一覧する ListStockItems', () => {
  it('世帯の在庫品を、期限の近い順に並べて返す', async () => {
    // FR-04 / 規則2: 既定にして唯一の並びは期限の昇順。
    const { stockItemRepository, list } = setUp();
    await store(
      stockItemRepository,
      stockItem({ name: 'じゃがいも', expiryDate: '2026-02-01' }),
      stockItem({ name: 'たまねぎ', expiryDate: '2026-01-10' }),
      stockItem({ name: 'もち', expiryDate: '2025-12-31' }),
      stockItem({ name: 'にんじん', expiryDate: '2026-01-02' }),
    );

    const output = await list(ourHousehold);

    expect(namesOf(output)).toEqual(['もち', 'にんじん', 'たまねぎ', 'じゃがいも']);
  });

  it('別の世帯の在庫品は1件も返らない', async () => {
    // C-9 / NFR-09: 世帯は第1引数の値だけで決まる。
    const { stockItemRepository, list } = setUp();
    await store(
      stockItemRepository,
      stockItem({ name: 'にんじん', expiryDate: '2026-01-02' }),
      stockItem({ householdId: neighborHousehold, name: 'だいこん', expiryDate: '2025-12-31' }),
      stockItem({ householdId: neighborHousehold, name: 'ねぎ', expiryDate: '2026-01-01' }),
    );

    const output = await list(ourHousehold);

    expect(namesOf(output)).toEqual(['にんじん']);
  });

  it('期限が未設定の在庫品は、期限のあるどの在庫品よりも後ろに置く', async () => {
    // FR-13 / 規則3: 期限のあるものより後、という一点だけで扱う。
    const { stockItemRepository, list } = setUp();
    await store(
      stockItemRepository,
      stockItem({ name: 'みそ', expiryDate: null }),
      stockItem({ name: 'にんじん', expiryDate: '2026-01-02' }),
      stockItem({ name: 'こんぶ', expiryDate: '2029-12-31' }),
    );

    const output = await list(ourHousehold);

    expect(namesOf(output)).toEqual(['にんじん', 'こんぶ', 'みそ']);
  });

  it('期限が同じ在庫品どうしは、名称の昇順で並べる', async () => {
    // 規則4: 同じ入力で順序が変わってはいけない。
    const { stockItemRepository, list } = setUp();
    await store(
      stockItemRepository,
      stockItem({ name: 'もやし', expiryDate: '2026-01-02' }),
      stockItem({ name: 'なす', expiryDate: '2026-01-02' }),
      stockItem({ name: 'きゅうり', expiryDate: '2026-01-02' }),
    );

    const output = await list(ourHousehold);

    expect(namesOf(output)).toEqual(['きゅうり', 'なす', 'もやし']);
  });

  it('期限も名称も同じ在庫品どうしは、識別子の昇順で並べる', async () => {
    // 規則4: 識別子は一意なので、ここで全順序が閉じる。
    const { stockItemRepository, list } = setUp();
    await store(
      stockItemRepository,
      stockItem({ id: idB, name: 'にんじん', expiryDate: '2026-01-02' }),
      stockItem({ id: idA, name: 'にんじん', expiryDate: '2026-01-02' }),
    );

    const output = await list(ourHousehold);

    expect(idsOf(output)).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]);
  });

  it('リポジトリに保存した順序を逆にしても、同じ並びで返る', async () => {
    // 規則8 / 規則4: 結果は findByHousehold が約束していない順序に依らない。
    const cucumberId = '43333333-3333-4333-8333-333333333333';
    const firstCarrotId = '41111111-1111-4111-8111-111111111111';
    const secondCarrotId = '42222222-2222-4222-8222-222222222222';
    const misoId = '44444444-4444-4444-8444-444444444444';
    const fourStockItems = [
      stockItem({ id: cucumberId, name: 'きゅうり', expiryDate: '2026-01-02' }),
      stockItem({ id: firstCarrotId, name: 'にんじん', expiryDate: '2026-01-02' }),
      stockItem({ id: secondCarrotId, name: 'にんじん', expiryDate: '2026-01-02' }),
      stockItem({ id: misoId, name: 'みそ', expiryDate: null }),
    ];

    const storedInOrder = setUp();
    await store(storedInOrder.stockItemRepository, ...fourStockItems);
    const storedInReverse = setUp();
    await store(storedInReverse.stockItemRepository, ...[...fourStockItems].reverse());

    const outputInOrder = await storedInOrder.list(ourHousehold);
    const outputInReverse = await storedInReverse.list(ourHousehold);

    const expectedIds = [
      '43333333-3333-4333-8333-333333333333',
      '41111111-1111-4111-8111-111111111111',
      '42222222-2222-4222-8222-222222222222',
      '44444444-4444-4444-8444-444444444444',
    ];
    expect(idsOf(outputInOrder)).toEqual(expectedIds);
    expect(idsOf(outputInReverse)).toEqual(expectedIds);
  });

  it('期限が未設定の在庫品どうしも、名称の昇順で並べる', async () => {
    // 規則3 / 規則4: 末尾に寄せた中でも順序を決めておく。
    const { stockItemRepository, list } = setUp();
    await store(
      stockItemRepository,
      stockItem({ name: 'みりん', expiryDate: null }),
      stockItem({ name: 'しお', expiryDate: null }),
      stockItem({ name: 'さとう', expiryDate: null }),
    );

    const output = await list(ourHousehold);

    expect(namesOf(output)).toEqual(['さとう', 'しお', 'みりん']);
  });

  it('名称の比較は実行環境の照合順序ではなく、コード単位の大小で行う', async () => {
    // 規則4: localeCompare は ICU に依存し、Workers と Node で同じ並びになる保証がない。
    const { stockItemRepository, list } = setUp();
    await store(
      stockItemRepository,
      stockItem({ name: 'milk', expiryDate: '2026-01-02' }),
      stockItem({ name: 'MILK', expiryDate: '2026-01-02' }),
    );

    const output = await list(ourHousehold);

    expect(namesOf(output)).toEqual(['MILK', 'milk']);
  });

  it('返す在庫品は期限をそのまま持ち、残日数のような期限から算出した値を持たない', async () => {
    // FR-11 / 規則5: 日数の算出は画面（B-11）が持つ。基準時刻を引数に足さない。
    const { stockItemRepository, list } = setUp();
    await store(stockItemRepository, stockItem({ name: 'にんじん', expiryDate: '2026-01-02' }));

    const output = await list(ourHousehold);

    const first = output.stockItems[0];
    expect(first?.expiryDate).toBe('2026-01-02');
    expect(Object.keys(first ?? {}).sort()).toEqual([
      'amount',
      'expiryDate',
      'id',
      'ingredientId',
      'name',
    ]);
  });

  it('保存されている値を加工せずに写す', async () => {
    // 規則10: trim も既定値の補完もドメインで済んでいる。
    const { stockItemRepository, list } = setUp();
    await store(
      stockItemRepository,
      stockItem({
        id: idA,
        name: 'にんじん',
        ingredientId: '44444444-4444-4444-8444-444444444444',
        amount: '2本',
        expiryDate: '2026-01-02',
      }),
    );

    const output = await list(ourHousehold);

    expect(output.stockItems).toEqual([
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'にんじん',
        ingredientId: '44444444-4444-4444-8444-444444444444',
        amount: '2本',
        expiryDate: '2026-01-02',
      },
    ]);
  });

  it('在庫品が1件も無い世帯でも、エラーにせず空の一覧を返す', async () => {
    // FR-04 / 規則6: 「まだ登録が無い」の見せ方は画面が持つ。
    const { stockItemRepository, list } = setUp();
    await store(
      stockItemRepository,
      stockItem({ householdId: neighborHousehold, name: 'だいこん', expiryDate: '2025-12-31' }),
    );

    const output = await list(ourHousehold);

    expect(output.stockItems).toEqual([]);
  });

  it('名称も期限も同じ在庫品を、統合せずどちらも返す', async () => {
    // ADR-007 / 規則9: 買った日が違えば別の在庫品。一意化も統合もしない。
    const { stockItemRepository, list } = setUp();
    await store(
      stockItemRepository,
      stockItem({ id: idA, name: 'にんじん', expiryDate: '2026-01-02' }),
      stockItem({ id: idB, name: 'にんじん', expiryDate: '2026-01-02' }),
    );

    const output = await list(ourHousehold);

    expect(output.stockItems).toHaveLength(2);
    expect(idsOf(output)).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]);
  });

  it('一覧しても、リポジトリが保持している在庫品の並びは変わらない', async () => {
    // ADR-002 / 規則7: 受け取った配列をその場で書き換えない。
    const stockItemRepository: StockItemRepository = new SameArrayInMemoryStockItemRepository();
    const list = listStockItems({ stockItemRepository });
    await store(
      stockItemRepository,
      stockItem({ name: 'こんぶ', expiryDate: '2029-12-31' }),
      stockItem({ name: 'たまねぎ', expiryDate: '2026-01-10' }),
      stockItem({ name: 'もち', expiryDate: '2025-12-31' }),
    );

    await list(ourHousehold);

    const storedStockItems = await stockItemRepository.findByHousehold(ourHousehold);
    expect(storedStockItems.map((stockItem) => stockItem.name)).toEqual([
      'こんぶ',
      'たまねぎ',
      'もち',
    ]);
  });

  it('取り出しに失敗したときは、その例外をそのまま呼び出し側へ伝える', async () => {
    // ADR-002 / 7章: ユースケースは握りつぶさない。HTTP への写像は B-08 の仕事。
    const list = listStockItems({
      stockItemRepository: new FailingFetchInMemoryStockItemRepository(),
    });

    await expect(list(ourHousehold)).rejects.toThrow(FetchFailure);
  });
});
