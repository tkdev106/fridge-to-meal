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

/** 名称だけが本題の在庫品。名称の履歴（B-50d）のテストで使う。 */
function namedStockItem(
  householdId: HouseholdId,
  name: string,
  id = '22222222-2222-4222-8222-222222222222',
) {
  return createStockItem({
    id: stockItemIdOf(id),
    householdId,
    name,
    ingredientId: null,
    amount: null,
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

  it('保存した在庫品の名称を、保存したことのある名称として返す', async () => {
    // FR-02 / B-50d 規則1: save のたびに名称を残す。
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await repository.save(ourHousehold, carrot(ourHousehold));

    expect(await repository.findSavedNamesByHousehold(ourHousehold)).toEqual(['にんじん']);
  });

  it('残す名称は、前後の空白を落とした後の値である', async () => {
    // B-50d 規則1: 残すのはドメインで正規化した後の名称。
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await repository.save(ourHousehold, namedStockItem(ourHousehold, '  にんじん  '));

    expect(await repository.findSavedNamesByHousehold(ourHousehold)).toEqual(['にんじん']);
  });

  it('同じ名称の在庫品を2件保存しても断らず、名称は1つだけ返す', async () => {
    // ADR-063 決定4 / B-50d 規則2: 同じ世帯・同じ名称は1つとして残す。
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await repository.save(
      ourHousehold,
      namedStockItem(ourHousehold, 'にんじん', '22222222-2222-4222-8222-222222222222'),
    );

    await expect(
      repository.save(
        ourHousehold,
        namedStockItem(ourHousehold, 'にんじん', '33333333-3333-4333-8333-333333333333'),
      ),
    ).resolves.toBeUndefined();
    expect(await repository.findSavedNamesByHousehold(ourHousehold)).toEqual(['にんじん']);
  });

  it('同じ在庫品を2度保存しても断らず、名称は1つだけ返す', async () => {
    // B-50d 規則1・2: 登録と更新を区別せず、2度目の save もエラーにしない。
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await repository.save(ourHousehold, carrot(ourHousehold));

    await expect(repository.save(ourHousehold, carrot(ourHousehold))).resolves.toBeUndefined();
    expect(await repository.findSavedNamesByHousehold(ourHousehold)).toEqual(['にんじん']);
  });

  it('表記の違う名称は畳まず、別々に残す', async () => {
    // C-6 / B-50d 規則2: 完全一致だけを同じ名称とみなす。並びは約束しない（規則5）ので並べて比べる。
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await repository.save(
      ourHousehold,
      namedStockItem(ourHousehold, 'にんじん', '22222222-2222-4222-8222-222222222222'),
    );
    await repository.save(
      ourHousehold,
      namedStockItem(ourHousehold, '人参', '33333333-3333-4333-8333-333333333333'),
    );
    await repository.save(
      ourHousehold,
      namedStockItem(ourHousehold, 'ニンジン', '44444444-4444-4444-8444-444444444444'),
    );

    const names = await repository.findSavedNamesByHousehold(ourHousehold);

    expect([...names].sort()).toEqual(['にんじん', 'ニンジン', '人参']);
  });

  it('他の世帯で保存した名称は返さない（C-9）', async () => {
    // C-9 / B-50d 規則5: 引数の世帯の名称だけを返す。
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await repository.save(
      neighborHousehold,
      namedStockItem(neighborHousehold, 'だいこん', '33333333-3333-4333-8333-333333333333'),
    );
    await repository.save(ourHousehold, carrot(ourHousehold));

    expect(await repository.findSavedNamesByHousehold(ourHousehold)).toEqual(['にんじん']);
  });

  it('何も保存していない世帯には空の列を返す', async () => {
    // B-50d 規則5: 0件は空の配列で、null にも例外にもしない。
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await repository.save(neighborHousehold, carrot(neighborHousehold));

    expect(await repository.findSavedNamesByHousehold(ourHousehold)).toEqual([]);
  });

  it('他の世帯の在庫品として保存しようとして断られたとき、どちらの世帯にも名称を残さない', async () => {
    // B-50d 規則4: save.householdMismatch で断る回は在庫品も名称も書かない。
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await expect(repository.save(neighborHousehold, carrot(ourHousehold))).rejects.toThrow(
      PantryRuleViolation,
    );

    expect(await repository.findSavedNamesByHousehold(ourHousehold)).toEqual([]);
    expect(await repository.findSavedNamesByHousehold(neighborHousehold)).toEqual([]);
  });
});

describe('在庫品リポジトリ StockItemRepository（世帯のデータを消す）', () => {
  it('世帯のデータを消すと、その世帯の在庫品は一覧に出なくなる', async () => {
    // FR-27 / NFR-13 / B-56a 規則2: 世帯の在庫品をすべて消す。
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await repository.save(
      ourHousehold,
      namedStockItem(ourHousehold, 'にんじん', '22222222-2222-4222-8222-222222222222'),
    );
    await repository.save(
      ourHousehold,
      namedStockItem(ourHousehold, 'たまねぎ', '33333333-3333-4333-8333-333333333333'),
    );

    await repository.deleteByHousehold(ourHousehold);

    expect(await repository.findByHousehold(ourHousehold)).toEqual([]);
  });

  it('世帯のデータを消すと、削除済みの在庫品の名称も含め、保存したことのある名称が残らない', async () => {
    // NFR-13 / ADR-072 結果1: `delete` は名称を残すが（ADR-069 決定1）、世帯のデータを消す回は名称も消す。
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await repository.save(
      ourHousehold,
      namedStockItem(ourHousehold, 'にんじん', '22222222-2222-4222-8222-222222222222'),
    );
    await repository.save(
      ourHousehold,
      namedStockItem(ourHousehold, 'たまねぎ', '33333333-3333-4333-8333-333333333333'),
    );
    await repository.delete(ourHousehold, stockItemIdOf('22222222-2222-4222-8222-222222222222'));

    await repository.deleteByHousehold(ourHousehold);

    expect(await repository.findSavedNamesByHousehold(ourHousehold)).toEqual([]);
  });

  it('他の世帯のデータを消しても、こちらの世帯の在庫品と名称は残る', async () => {
    // C-9 / B-56a 規則3・4: 引数の世帯の行だけを消す。
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await repository.save(ourHousehold, carrot(ourHousehold));
    await repository.save(
      neighborHousehold,
      namedStockItem(neighborHousehold, 'だいこん', '33333333-3333-4333-8333-333333333333'),
    );

    await repository.deleteByHousehold(neighborHousehold);

    expect({
      stockItemNames: (await repository.findByHousehold(ourHousehold)).map((item) => item.name),
      savedNames: await repository.findSavedNamesByHousehold(ourHousehold),
    }).toEqual({ stockItemNames: ['にんじん'], savedNames: ['にんじん'] });
  });

  it('何も保存していない世帯のデータを消しても、失敗しない', async () => {
    // B-56a 規則7: 消す物が無くても同じ結末。存在を確かめない。
    const repository: StockItemRepository = new InMemoryStockItemRepository();

    await expect(repository.deleteByHousehold(ourHousehold)).resolves.toBeUndefined();
  });

  it('同じ世帯のデータを2度消しても、2度目も失敗しない', async () => {
    // B-56a 規則7: 2度目の呼び出しも同じ結末。
    const repository: StockItemRepository = new InMemoryStockItemRepository();
    await repository.save(ourHousehold, carrot(ourHousehold));
    await repository.deleteByHousehold(ourHousehold);

    await expect(repository.deleteByHousehold(ourHousehold)).resolves.toBeUndefined();
  });
});
