import { describe, expect, it } from 'vitest';
import { deleteStockItem } from '../../../../src/contexts/pantry/usecase/DeleteStockItem.js';
import type { StockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import { createStockItem } from '../../../../src/contexts/pantry/domain/entity/StockItem.js';
import type { StockItemRepository } from '../../../../src/contexts/pantry/domain/repository/StockItemRepository.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import { amountOf } from '../../../../src/contexts/pantry/domain/value/Amount.js';
import { expiryDateOf } from '../../../../src/contexts/pantry/domain/value/ExpiryDate.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { 記憶上の在庫品リポジトリ } from '../../../support/pantry/InMemoryStockItemRepository.js';

const 我が家 = householdIdOf('11111111-1111-4111-8111-111111111111');
const 隣の家 = householdIdOf('99999999-9999-4999-8999-999999999999');

const 識別子A = '22222222-2222-4222-8222-222222222222';
const 識別子B = '33333333-3333-4333-8333-333333333333';
const 保存していない識別子 = '44444444-4444-4444-8444-444444444444';

/** テストの本題でない項目を隠す（`docs/testing.md` 6章）。本題だけが引数に現れる。 */
function 在庫品(props: {
  id?: string;
  householdId?: HouseholdId;
  name?: string;
  amount?: string;
  expiryDate?: string;
}): StockItem {
  return createStockItem({
    id: stockItemIdOf(props.id ?? 識別子A),
    householdId: props.householdId ?? 我が家,
    name: props.name ?? 'にんじん',
    ingredientId: null,
    amount: props.amount === undefined ? null : amountOf(props.amount),
    expiryDate: expiryDateOf(props.expiryDate ?? null),
  });
}

/**
 * リポジトリを記憶上の実装で組み、ユースケースを1つ作る。
 * 前提の在庫品は**登録の経路を通さずリポジトリへ直接置く**（B-06 設計書 8章）。
 */
function 準備() {
  const stockItemRepository = new 記憶上の在庫品リポジトリ();
  const 削除する = deleteStockItem({ stockItemRepository });

  return { stockItemRepository, 削除する };
}

async function 置く(stockItemRepository: StockItemRepository, ...在庫品たち: readonly StockItem[]) {
  for (const 品 of 在庫品たち) {
    await stockItemRepository.save(品.householdId, 品);
  }
}

/** 削除だけが必ず失敗する記憶上の実装。取り出しと保存は共有のものをそのまま使う。 */
class 削除の失敗 extends Error {}

class 削除に失敗する記憶上の在庫品リポジトリ extends 記憶上の在庫品リポジトリ {
  override async delete(): Promise<void> {
    throw new 削除の失敗('削除できない');
  }
}

describe('在庫品を削除する DeleteStockItem', () => {
  it('自分の世帯の在庫品を削除すると、その世帯から取り出せなくなる', async () => {
    // FR-06 / 規則10: 物理削除でよい。献立は材料を文字列で複製済みで参照を持たない（C-5）。
    const { stockItemRepository, 削除する } = 準備();
    await 置く(stockItemRepository, 在庫品({ name: 'にんじん' }));

    await 削除する(我が家, stockItemIdOf(識別子A));

    expect(await stockItemRepository.findById(我が家, stockItemIdOf(識別子A))).toBeNull();
  });

  it('削除するのは指した1件だけで、同じ世帯の他の在庫品は残る', async () => {
    // FR-06: 指した識別子の1件だけが消える。
    const { stockItemRepository, 削除する } = 準備();
    await 置く(
      stockItemRepository,
      在庫品({ id: 識別子A, name: 'にんじん' }),
      在庫品({ id: 識別子B, name: 'たまねぎ' }),
    );

    await 削除する(我が家, stockItemIdOf(識別子A));

    const 残ったもの = await stockItemRepository.findByHousehold(我が家);
    expect(残ったもの).toHaveLength(1);
    expect(残ったもの[0]?.name).toBe('たまねぎ');
  });

  it('存在しない識別子の削除は、例外にならず成功する', async () => {
    // 規則9: 事前に存在を確かめない。「消えている」という結果は同じ。
    const { 削除する } = 準備();

    await expect(削除する(我が家, stockItemIdOf(保存していない識別子))).resolves.toBeUndefined();
  });

  it('同じ識別子を二度削除しても成功する', async () => {
    // 規則9: 冪等。二度目を規則違反にすると、再送のたびに失敗が返る。
    const { stockItemRepository, 削除する } = 準備();
    await 置く(stockItemRepository, 在庫品({ name: 'にんじん' }));
    await 削除する(我が家, stockItemIdOf(識別子A));

    await expect(削除する(我が家, stockItemIdOf(識別子A))).resolves.toBeUndefined();
  });

  it('他の世帯の在庫品を指した削除は、例外にならず成功する', async () => {
    // 規則9 / C-9: 呼び出し側に他の世帯の在庫品の有無を知らせない。
    const { stockItemRepository, 削除する } = 準備();
    await 置く(stockItemRepository, 在庫品({ householdId: 隣の家, name: 'にんじん' }));

    await expect(削除する(我が家, stockItemIdOf(識別子A))).resolves.toBeUndefined();
  });

  it('他の世帯の在庫品を指して削除しても、その在庫品は消えていない', async () => {
    // C-9 / NFR-09: 成功して見えることと、隣の世帯のデータに触れることは別である。
    const { stockItemRepository, 削除する } = 準備();
    await 置く(stockItemRepository, 在庫品({ householdId: 隣の家, name: 'にんじん' }));

    await 削除する(我が家, stockItemIdOf(識別子A));

    const 取得 = await stockItemRepository.findById(隣の家, stockItemIdOf(識別子A));
    expect(取得?.name).toBe('にんじん');
  });

  it('削除に失敗したときは、その例外をそのまま呼び出し側へ伝える', async () => {
    // ADR-002 / 7章: ユースケースは握りつぶさない。HTTP への写像は B-08 の仕事。
    const 削除する = deleteStockItem({
      stockItemRepository: new 削除に失敗する記憶上の在庫品リポジトリ(),
    });

    await expect(削除する(我が家, stockItemIdOf(識別子A))).rejects.toThrow(削除の失敗);
  });
});
