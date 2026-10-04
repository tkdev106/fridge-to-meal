import { describe, expect, it } from 'vitest';
import { updateStockItem } from '../../../../src/contexts/pantry/usecase/UpdateStockItem.js';
import type { StockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { createStockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { PantryRuleViolation } from '../../../../src/contexts/pantry/domain/error/PantryRuleViolation.js';
import type { StockItemRepository } from '../../../../src/contexts/pantry/domain/repository/StockItemRepository.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import { ingredientIdOf } from '../../../../src/contexts/pantry/domain/value/IngredientId.js';
import { amountOf } from '../../../../src/contexts/pantry/domain/value/Amount.js';
import { expiryDateOf } from '../../../../src/contexts/pantry/domain/value/ExpiryDate.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryStockItemRepository } from '../../../support/pantry/InMemoryStockItemRepository.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

const idA = '22222222-2222-4222-8222-222222222222';
const unsavedId = '33333333-3333-4333-8333-333333333333';
const carrotIngredientId = '44444444-4444-4444-8444-444444444444';

/** テストの本題でない項目を隠す（`docs/testing.md` 6章）。本題だけが引数に現れる。 */
function stockItem(props: {
  id?: string;
  householdId?: HouseholdId;
  name?: string;
  ingredientId?: string;
  amount?: string;
  expiryDate?: string;
  useForMeals?: boolean;
}): StockItem {
  return createStockItem({
    id: stockItemIdOf(props.id ?? idA),
    householdId: props.householdId ?? ourHousehold,
    name: props.name ?? 'にんじん',
    ingredientId: props.ingredientId === undefined ? null : ingredientIdOf(props.ingredientId),
    amount: props.amount === undefined ? null : amountOf(props.amount),
    expiryDate: expiryDateOf(props.expiryDate ?? null),
    useForMeals: props.useForMeals ?? true,
  });
}

/**
 * リポジトリを記憶上の実装で組み、ユースケースを1つ作る。
 * 前提の在庫品は**登録の経路を通さずリポジトリへ直接置く**（B-06 設計書 8章）。
 */
function setUp() {
  const stockItemRepository = new InMemoryStockItemRepository();
  const update = updateStockItem({ stockItemRepository });

  return { stockItemRepository, update };
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

/** 保存だけが必ず失敗する記憶上の実装。前提を置く経路だけ、元の保存を通す。 */
class SaveFailure extends Error {}

class FailingSaveInMemoryStockItemRepository extends InMemoryStockItemRepository {
  /** ユースケースが通らない経路。前提の在庫品を置くためだけに使う。 */
  async storeAsPrecondition(stockItem: StockItem): Promise<void> {
    await super.save(stockItem.householdId, stockItem);
  }

  override async save(): Promise<void> {
    throw new SaveFailure('保存できない');
  }
}

describe('在庫品を更新する UpdateStockItem', () => {
  it('分量と期限を渡すと、その値に置き換えた在庫品が返る', async () => {
    // FR-05: 編集できるのは数量と期限だけ。入力は常に置き換え（規則3）。
    const { stockItemRepository, update } = setUp();
    await store(stockItemRepository, stockItem({ amount: '2本', expiryDate: '2026-10-01' }));

    const updatedStockItem = await update(ourHousehold, stockItemIdOf(idA), {
      amount: '5本',
      expiryDate: '2026-12-31',
      useForMeals: true,
    });

    expect(updatedStockItem.amount).toBe('5本');
    expect(updatedStockItem.expiryDate).toBe('2026-12-31');
  });

  it('更新した在庫品は、同じ世帯からリポジトリで取り出すと置き換わった値になっている', async () => {
    // 規則1・規則6: 保存の確認は取得を通して行う。差分を見て保存を省かない。
    const { stockItemRepository, update } = setUp();
    await store(stockItemRepository, stockItem({ amount: '2本', expiryDate: '2026-10-01' }));

    await update(ourHousehold, stockItemIdOf(idA), {
      amount: '5本',
      expiryDate: '2026-12-31',
      useForMeals: true,
    });

    const found = await stockItemRepository.findById(ourHousehold, stockItemIdOf(idA));
    expect(found?.amount).toBe('5本');
    expect(found?.expiryDate).toBe('2026-12-31');
  });

  it('更新しても識別子・名称・食材の指定は変わらない', async () => {
    // 規則2 / 規則11 / FR-05: 引き継ぐ4つは入力に無く、カタログにも問い合わせない。
    const { stockItemRepository, update } = setUp();
    await store(
      stockItemRepository,
      stockItem({ name: 'にんじん', ingredientId: carrotIngredientId, amount: '2本' }),
    );

    const updatedStockItem = await update(ourHousehold, stockItemIdOf(idA), {
      amount: '5本',
      expiryDate: null,
      useForMeals: true,
    });

    expect(updatedStockItem.id).toBe('22222222-2222-4222-8222-222222222222');
    expect(updatedStockItem.name).toBe('にんじん');
    expect(updatedStockItem.ingredientId).toBe('44444444-4444-4444-8444-444444444444');
  });

  it('amount に null を渡すと、保存済みの分量が消える', async () => {
    // 規則3 / FR-13: null は「触っていない」ではなく「消す」を表す。
    const { stockItemRepository, update } = setUp();
    await store(stockItemRepository, stockItem({ amount: '2本', expiryDate: '2026-10-01' }));

    const updatedStockItem = await update(ourHousehold, stockItemIdOf(idA), {
      amount: null,
      expiryDate: '2026-10-01',
      useForMeals: true,
    });

    expect(updatedStockItem.amount).toBeNull();
    const found = await stockItemRepository.findById(ourHousehold, stockItemIdOf(idA));
    expect(found?.amount).toBeNull();
  });

  it('expiryDate に null を渡すと、保存済みの期限が消える', async () => {
    // 規則3 / FR-13: 期限を消した在庫品は、期限による警告・優先の対象外に戻る。
    const { stockItemRepository, update } = setUp();
    await store(stockItemRepository, stockItem({ amount: '2本', expiryDate: '2026-10-01' }));

    const updatedStockItem = await update(ourHousehold, stockItemIdOf(idA), {
      amount: '2本',
      expiryDate: null,
      useForMeals: true,
    });

    expect(updatedStockItem.expiryDate).toBeNull();
    const found = await stockItemRepository.findById(ourHousehold, stockItemIdOf(idA));
    expect(found?.expiryDate).toBeNull();
  });

  it('空白だけの分量は分量なしとして保存する', async () => {
    // 規則4 / ADR-010: 正規化は amountOf が持つ。ユースケースで書き直さない。
    const { stockItemRepository, update } = setUp();
    await store(stockItemRepository, stockItem({ amount: '2本' }));

    const updatedStockItem = await update(ourHousehold, stockItemIdOf(idA), {
      amount: '   ',
      expiryDate: null,
      useForMeals: true,
    });

    expect(updatedStockItem.amount).toBeNull();
  });

  it('空白だけの期限は期限なしとして保存する', async () => {
    // 規則5 / FR-13: 正規化は expiryDateOf が持つ。
    const { stockItemRepository, update } = setUp();
    await store(stockItemRepository, stockItem({ expiryDate: '2026-10-01' }));

    const updatedStockItem = await update(ourHousehold, stockItemIdOf(idA), {
      amount: null,
      expiryDate: '   ',
      useForMeals: true,
    });

    expect(updatedStockItem.expiryDate).toBeNull();
  });

  it.each([
    [true, false],
    [false, true],
  ])(
    '献立に使うかどうかが %s の在庫品に %s を渡すと、その値に置き換えた在庫品が返る',
    async (storedUseForMeals, useForMeals) => {
      // FR-05 / ADR-086 / 設計書 規則3: 献立に使うかどうかも置き換える。
      const { stockItemRepository, update } = setUp();
      await store(stockItemRepository, stockItem({ useForMeals: storedUseForMeals }));

      const updatedStockItem = await update(ourHousehold, stockItemIdOf(idA), {
        amount: null,
        expiryDate: null,
        useForMeals,
      });

      expect(updatedStockItem.useForMeals).toBe(useForMeals);
    },
  );

  it('献立に使わないに切り替えた在庫品は、同じ世帯からリポジトリで取り出しても献立に使わないまま', async () => {
    // FR-43 / 設計書 規則3: 保存の確認は取得を通して行う。
    const { stockItemRepository, update } = setUp();
    await store(stockItemRepository, stockItem({ useForMeals: true }));

    await update(ourHousehold, stockItemIdOf(idA), {
      amount: null,
      expiryDate: null,
      useForMeals: false,
    });

    const found = await stockItemRepository.findById(ourHousehold, stockItemIdOf(idA));
    expect(found?.useForMeals).toBe(false);
  });

  it('今と同じ分量・期限・献立に使うかどうかで更新しても断らず、同じ値の在庫品を返す', async () => {
    // 規則6: 差分を見て保存を省かない。判定がもう1つの規則になるうえ、外から見える違いが無い。
    const { stockItemRepository, update } = setUp();
    await store(stockItemRepository, stockItem({ amount: '2本', expiryDate: '2026-10-01' }));

    const updatedStockItem = await update(ourHousehold, stockItemIdOf(idA), {
      amount: '2本',
      expiryDate: '2026-10-01',
      useForMeals: true,
    });

    expect(updatedStockItem.amount).toBe('2本');
    expect(updatedStockItem.expiryDate).toBe('2026-10-01');
    expect(updatedStockItem.useForMeals).toBe(true);
  });

  it('存在しない識別子の更新を断る', async () => {
    // 規則8 / 7章: 更新は在庫品を返す契約なので、返すものが無い以上は成功にできない。
    const { update } = setUp();

    const execution = update(ourHousehold, stockItemIdOf(unsavedId), {
      amount: '5本',
      expiryDate: null,
      useForMeals: true,
    });

    await expect(execution).rejects.toThrow(PantryRuleViolation);
    await expect(execution).rejects.toHaveProperty('rule', 'update.notFound');
  });

  it('他の世帯の在庫品は、識別子を正しく指しても更新できない', async () => {
    // C-9 / 規則1・規則8: 世帯は第1引数の値だけで決まる。
    const { stockItemRepository, update } = setUp();
    await store(stockItemRepository, stockItem({ householdId: neighborHousehold, amount: '2本' }));

    const execution = update(ourHousehold, stockItemIdOf(idA), {
      amount: '5本',
      expiryDate: null,
      useForMeals: true,
    });

    await expect(execution).rejects.toThrow(PantryRuleViolation);
    await expect(execution).rejects.toHaveProperty('rule', 'update.notFound');
  });

  it('存在しない識別子と他の世帯の識別子は、同じ rule と同じ文言で断る', async () => {
    // C-9 / 規則8 / 7章: 区別を呼び出し側に返さない。文言そのものは検証しない
    // （実装詳細。`docs/testing.md` 3章）ので、2つを互いに突き合わせる。
    const { stockItemRepository, update } = setUp();
    await store(stockItemRepository, stockItem({ householdId: neighborHousehold, amount: '2本' }));

    const thrownForMissingId = await thrownBy(
      update(ourHousehold, stockItemIdOf(unsavedId), {
        amount: '5本',
        expiryDate: null,
        useForMeals: true,
      }),
    );
    const thrownForNeighborHouseholdId = await thrownBy(
      update(ourHousehold, stockItemIdOf(idA), {
        amount: '5本',
        expiryDate: null,
        useForMeals: true,
      }),
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

  it('他の世帯の在庫品の更新を試みても、その在庫品は元のまま', async () => {
    // C-9 / 規則12 / NFR-09: 断った更新が隣の世帯のデータに触れていない。
    const { stockItemRepository, update } = setUp();
    await store(
      stockItemRepository,
      stockItem({ householdId: neighborHousehold, amount: '2本', expiryDate: '2026-10-01' }),
    );

    await expect(
      update(ourHousehold, stockItemIdOf(idA), {
        amount: '5本',
        expiryDate: '2026-12-31',
        useForMeals: true,
      }),
    ).rejects.toThrow(PantryRuleViolation);

    const found = await stockItemRepository.findById(neighborHousehold, stockItemIdOf(idA));
    expect(found?.amount).toBe('2本');
    expect(found?.expiryDate).toBe('2026-10-01');
  });

  it('YYYY-MM-DD でない期限での更新を断る', async () => {
    // 規則5 / FR-13: ドメインが投げた例外をユースケースで捕まえない。
    const { stockItemRepository, update } = setUp();
    await store(stockItemRepository, stockItem({ amount: '2本', expiryDate: '2026-10-01' }));

    const execution = update(ourHousehold, stockItemIdOf(idA), {
      amount: '5本',
      expiryDate: '2026/10/01',
      useForMeals: true,
    });

    await expect(execution).rejects.toThrow(PantryRuleViolation);
    await expect(execution).rejects.toHaveProperty('rule', 'expiryDate.format');
  });

  it('期限の書式が違って更新が終わったとき、保存済みの在庫品は元のまま', async () => {
    // 規則12: 検証をすべて保存の前に済ませる。分量だけが書き換わって残らない。
    const { stockItemRepository, update } = setUp();
    await store(stockItemRepository, stockItem({ amount: '2本', expiryDate: '2026-10-01' }));

    await expect(
      update(ourHousehold, stockItemIdOf(idA), {
        amount: '5本',
        expiryDate: '2026/10/01',
        useForMeals: true,
      }),
    ).rejects.toThrow(PantryRuleViolation);

    const found = await stockItemRepository.findById(ourHousehold, stockItemIdOf(idA));
    expect(found?.amount).toBe('2本');
    expect(found?.expiryDate).toBe('2026-10-01');
  });

  it('保存に失敗したときは、その例外をそのまま呼び出し側へ伝える', async () => {
    // ADR-002 / 7章: ユースケースは握りつぶさない。HTTP への写像は B-08 の仕事。
    const stockItemRepository = new FailingSaveInMemoryStockItemRepository();
    await stockItemRepository.storeAsPrecondition(stockItem({ amount: '2本' }));
    const update = updateStockItem({ stockItemRepository });

    await expect(
      update(ourHousehold, stockItemIdOf(idA), {
        amount: '5本',
        expiryDate: null,
        useForMeals: true,
      }),
    ).rejects.toThrow(SaveFailure);
  });
});
