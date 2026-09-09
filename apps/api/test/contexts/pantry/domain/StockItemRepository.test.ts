import { describe, expect, it } from 'vitest';
import type { StockItemRepository } from '../../../../src/contexts/pantry/domain/repository/StockItemRepository.js';
import { createStockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import type { StockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import type { StockItemId } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import { amountOf } from '../../../../src/contexts/pantry/domain/value/Amount.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { PantryRuleViolation } from '../../../../src/contexts/pantry/domain/error/PantryRuleViolation.js';

const 我が家 = householdIdOf('11111111-1111-4111-8111-111111111111');
const 隣の家 = householdIdOf('99999999-9999-4999-8999-999999999999');

/**
 * 記憶の上だけで動く実装。ユースケース層のテスト（B-04 以降）でも同じものが要るが、
 * 置き場所が決まるまではここに持つ。**interface が実装できる形をしていること**の
 * 確認を兼ねている。
 */
class 記憶上の在庫品リポジトリ implements StockItemRepository {
  readonly #保存済み = new Map<string, StockItem>();

  async findById(householdId: HouseholdId, id: StockItemId) {
    const 在庫品 = this.#保存済み.get(id);
    // 世帯が違えば「無い」と答える。ここを緩めると世帯分離が破れる。
    return 在庫品 !== undefined && 在庫品.householdId === householdId ? 在庫品 : null;
  }

  async findByHousehold(householdId: HouseholdId) {
    return [...this.#保存済み.values()].filter((在庫品) => 在庫品.householdId === householdId);
  }

  async save(householdId: HouseholdId, stockItem: StockItem) {
    if (stockItem.householdId !== householdId) {
      throw new PantryRuleViolation(
        'save.householdMismatch',
        '引数の世帯と在庫品の世帯が食い違っている',
      );
    }
    this.#保存済み.set(stockItem.id, stockItem);
  }

  async delete(householdId: HouseholdId, id: StockItemId) {
    const 在庫品 = await this.findById(householdId, id);
    if (在庫品 !== null) this.#保存済み.delete(id);
  }
}

function にんじん(householdId: HouseholdId, id = '22222222-2222-4222-8222-222222222222') {
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
type 先頭の引数<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => unknown ? A[0] : never;
};

/**
 * 全メソッドの先頭が `HouseholdId` なら `true`、1つでも違えば `never`。
 * `never` になると下の代入が型検査で落ちる。
 */
type 全メソッドが世帯識別子を先頭に取るか =
  先頭の引数<StockItemRepository>[keyof StockItemRepository] extends HouseholdId ? true : never;

describe('在庫品リポジトリ StockItemRepository', () => {
  it('全メソッドが世帯識別子を先頭の引数に取る（C-9）', () => {
    // 型の主張。世帯識別子を取らないメソッドを足した時点で、この行が typecheck で落ちる。
    // 実行時には何も確かめていない — 確かめているのは型検査のほうである。
    const 主張: 全メソッドが世帯識別子を先頭に取るか = true;

    expect(主張).toBe(true);
  });

  it('保存した在庫品を取り出せる', async () => {
    const repository: StockItemRepository = new 記憶上の在庫品リポジトリ();
    await repository.save(我が家, にんじん(我が家));

    const 取得 = await repository.findById(
      我が家,
      stockItemIdOf('22222222-2222-4222-8222-222222222222'),
    );

    expect(取得?.name).toBe('にんじん');
  });

  it('他の世帯の在庫品は取り出せない', async () => {
    // C-9 の核心。世帯をまたぐ取得が起きないことを、実装ごとにここで確かめられる。
    const repository: StockItemRepository = new 記憶上の在庫品リポジトリ();
    await repository.save(我が家, にんじん(我が家));

    const 取得 = await repository.findById(
      隣の家,
      stockItemIdOf('22222222-2222-4222-8222-222222222222'),
    );

    expect(取得).toBeNull();
  });

  it('一覧は自分の世帯のものだけを返す', async () => {
    const repository: StockItemRepository = new 記憶上の在庫品リポジトリ();
    await repository.save(我が家, にんじん(我が家));
    await repository.save(隣の家, にんじん(隣の家, '33333333-3333-4333-8333-333333333333'));

    expect(await repository.findByHousehold(我が家)).toHaveLength(1);
    expect(await repository.findByHousehold(隣の家)).toHaveLength(1);
  });

  it('他の世帯の在庫品として保存しようとすると拒む', async () => {
    // interface では強制できない約束なので、実装ごとにここで確かめる。
    const repository: StockItemRepository = new 記憶上の在庫品リポジトリ();

    await expect(repository.save(隣の家, にんじん(我が家))).rejects.toThrow(PantryRuleViolation);
  });

  it('削除できる', async () => {
    const repository: StockItemRepository = new 記憶上の在庫品リポジトリ();
    const id = stockItemIdOf('22222222-2222-4222-8222-222222222222');
    await repository.save(我が家, にんじん(我が家));

    await repository.delete(我が家, id);

    expect(await repository.findById(我が家, id)).toBeNull();
  });

  it('他の世帯の在庫品は削除できない', async () => {
    const repository: StockItemRepository = new 記憶上の在庫品リポジトリ();
    const id = stockItemIdOf('22222222-2222-4222-8222-222222222222');
    await repository.save(我が家, にんじん(我が家));

    await repository.delete(隣の家, id);

    expect(await repository.findById(我が家, id)).not.toBeNull();
  });
});
