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
import { 記憶上の在庫品リポジトリ } from '../../../support/pantry/InMemoryStockItemRepository.js';

const 我が家 = householdIdOf('11111111-1111-4111-8111-111111111111');
const 隣の家 = householdIdOf('99999999-9999-4999-8999-999999999999');

const 識別子A = '22222222-2222-4222-8222-222222222222';
const 保存していない識別子 = '33333333-3333-4333-8333-333333333333';
const 食材にんじん = '44444444-4444-4444-8444-444444444444';

/** テストの本題でない項目を隠す（`docs/testing.md` 6章）。本題だけが引数に現れる。 */
function 在庫品(props: {
  id?: string;
  householdId?: HouseholdId;
  name?: string;
  ingredientId?: string;
  amount?: string;
  expiryDate?: string;
}): StockItem {
  return createStockItem({
    id: stockItemIdOf(props.id ?? 識別子A),
    householdId: props.householdId ?? 我が家,
    name: props.name ?? 'にんじん',
    ingredientId: props.ingredientId === undefined ? null : ingredientIdOf(props.ingredientId),
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
  const 更新する = updateStockItem({ stockItemRepository });

  return { stockItemRepository, 更新する };
}

async function 置く(stockItemRepository: StockItemRepository, ...在庫品たち: readonly StockItem[]) {
  for (const 品 of 在庫品たち) {
    await stockItemRepository.save(品.householdId, 品);
  }
}

/** 投げられたものをそのまま受け取る。型と `rule` を突き合わせるためのもの。 */
async function 投げられたもの(実行: Promise<unknown>): Promise<unknown> {
  return 実行.then(
    () => null,
    (投げられた: unknown) => 投げられた,
  );
}

/** 保存だけが必ず失敗する記憶上の実装。前提を置く経路だけ、元の保存を通す。 */
class 保存の失敗 extends Error {}

class 保存に失敗する記憶上の在庫品リポジトリ extends 記憶上の在庫品リポジトリ {
  /** ユースケースが通らない経路。前提の在庫品を置くためだけに使う。 */
  async 前提として置く(stockItem: StockItem): Promise<void> {
    await super.save(stockItem.householdId, stockItem);
  }

  override async save(): Promise<void> {
    throw new 保存の失敗('保存できない');
  }
}

describe('在庫品を更新する UpdateStockItem', () => {
  it('分量と期限を渡すと、その値に置き換えた在庫品が返る', async () => {
    // FR-05: 編集できるのは数量と期限だけ。入力は常に置き換え（規則3）。
    const { stockItemRepository, 更新する } = 準備();
    await 置く(stockItemRepository, 在庫品({ amount: '2本', expiryDate: '2026-10-01' }));

    const 更新結果 = await 更新する(我が家, stockItemIdOf(識別子A), {
      amount: '5本',
      expiryDate: '2026-12-31',
    });

    expect(更新結果.amount).toBe('5本');
    expect(更新結果.expiryDate).toBe('2026-12-31');
  });

  it('更新した在庫品は、同じ世帯からリポジトリで取り出すと置き換わった値になっている', async () => {
    // 規則1・規則6: 保存の確認は取得を通して行う。差分を見て保存を省かない。
    const { stockItemRepository, 更新する } = 準備();
    await 置く(stockItemRepository, 在庫品({ amount: '2本', expiryDate: '2026-10-01' }));

    await 更新する(我が家, stockItemIdOf(識別子A), { amount: '5本', expiryDate: '2026-12-31' });

    const 取得 = await stockItemRepository.findById(我が家, stockItemIdOf(識別子A));
    expect(取得?.amount).toBe('5本');
    expect(取得?.expiryDate).toBe('2026-12-31');
  });

  it('更新しても識別子・名称・食材の指定は変わらない', async () => {
    // 規則2 / 規則11 / FR-05: 引き継ぐ4つは入力に無く、カタログにも問い合わせない。
    const { stockItemRepository, 更新する } = 準備();
    await 置く(
      stockItemRepository,
      在庫品({ name: 'にんじん', ingredientId: 食材にんじん, amount: '2本' }),
    );

    const 更新結果 = await 更新する(我が家, stockItemIdOf(識別子A), {
      amount: '5本',
      expiryDate: null,
    });

    expect(更新結果.id).toBe('22222222-2222-4222-8222-222222222222');
    expect(更新結果.name).toBe('にんじん');
    expect(更新結果.ingredientId).toBe('44444444-4444-4444-8444-444444444444');
  });

  it('amount に null を渡すと、保存済みの分量が消える', async () => {
    // 規則3 / FR-13: null は「触っていない」ではなく「消す」を表す。
    const { stockItemRepository, 更新する } = 準備();
    await 置く(stockItemRepository, 在庫品({ amount: '2本', expiryDate: '2026-10-01' }));

    const 更新結果 = await 更新する(我が家, stockItemIdOf(識別子A), {
      amount: null,
      expiryDate: '2026-10-01',
    });

    expect(更新結果.amount).toBeNull();
    const 取得 = await stockItemRepository.findById(我が家, stockItemIdOf(識別子A));
    expect(取得?.amount).toBeNull();
  });

  it('expiryDate に null を渡すと、保存済みの期限が消える', async () => {
    // 規則3 / FR-13: 期限を消した在庫品は、期限による警告・優先の対象外に戻る。
    const { stockItemRepository, 更新する } = 準備();
    await 置く(stockItemRepository, 在庫品({ amount: '2本', expiryDate: '2026-10-01' }));

    const 更新結果 = await 更新する(我が家, stockItemIdOf(識別子A), {
      amount: '2本',
      expiryDate: null,
    });

    expect(更新結果.expiryDate).toBeNull();
    const 取得 = await stockItemRepository.findById(我が家, stockItemIdOf(識別子A));
    expect(取得?.expiryDate).toBeNull();
  });

  it('空白だけの分量は分量なしとして保存する', async () => {
    // 規則4 / ADR-010: 正規化は amountOf が持つ。ユースケースで書き直さない。
    const { stockItemRepository, 更新する } = 準備();
    await 置く(stockItemRepository, 在庫品({ amount: '2本' }));

    const 更新結果 = await 更新する(我が家, stockItemIdOf(識別子A), {
      amount: '   ',
      expiryDate: null,
    });

    expect(更新結果.amount).toBeNull();
  });

  it('空白だけの期限は期限なしとして保存する', async () => {
    // 規則5 / FR-13: 正規化は expiryDateOf が持つ。
    const { stockItemRepository, 更新する } = 準備();
    await 置く(stockItemRepository, 在庫品({ expiryDate: '2026-10-01' }));

    const 更新結果 = await 更新する(我が家, stockItemIdOf(識別子A), {
      amount: null,
      expiryDate: '   ',
    });

    expect(更新結果.expiryDate).toBeNull();
  });

  it('今と同じ分量・期限で更新しても断らず、同じ値の在庫品を返す', async () => {
    // 規則6: 差分を見て保存を省かない。判定がもう1つの規則になるうえ、外から見える違いが無い。
    const { stockItemRepository, 更新する } = 準備();
    await 置く(stockItemRepository, 在庫品({ amount: '2本', expiryDate: '2026-10-01' }));

    const 更新結果 = await 更新する(我が家, stockItemIdOf(識別子A), {
      amount: '2本',
      expiryDate: '2026-10-01',
    });

    expect(更新結果.amount).toBe('2本');
    expect(更新結果.expiryDate).toBe('2026-10-01');
  });

  it('存在しない識別子の更新を断る', async () => {
    // 規則8 / 7章: 更新は在庫品を返す契約なので、返すものが無い以上は成功にできない。
    const { 更新する } = 準備();

    const 更新 = 更新する(我が家, stockItemIdOf(保存していない識別子), {
      amount: '5本',
      expiryDate: null,
    });

    await expect(更新).rejects.toThrow(PantryRuleViolation);
    await expect(更新).rejects.toHaveProperty('rule', 'update.notFound');
  });

  it('他の世帯の在庫品は、識別子を正しく指しても更新できない', async () => {
    // C-9 / 規則1・規則8: 世帯は第1引数の値だけで決まる。
    const { stockItemRepository, 更新する } = 準備();
    await 置く(stockItemRepository, 在庫品({ householdId: 隣の家, amount: '2本' }));

    const 更新 = 更新する(我が家, stockItemIdOf(識別子A), { amount: '5本', expiryDate: null });

    await expect(更新).rejects.toThrow(PantryRuleViolation);
    await expect(更新).rejects.toHaveProperty('rule', 'update.notFound');
  });

  it('存在しない識別子と他の世帯の識別子は、同じ rule と同じ文言で断る', async () => {
    // C-9 / 規則8 / 7章: 区別を呼び出し側に返さない。文言そのものは検証しない
    // （実装詳細。`docs/testing.md` 3章）ので、2つを互いに突き合わせる。
    const { stockItemRepository, 更新する } = 準備();
    await 置く(stockItemRepository, 在庫品({ householdId: 隣の家, amount: '2本' }));

    const 存在しないほう = await 投げられたもの(
      更新する(我が家, stockItemIdOf(保存していない識別子), { amount: '5本', expiryDate: null }),
    );
    const 他の世帯のほう = await 投げられたもの(
      更新する(我が家, stockItemIdOf(識別子A), { amount: '5本', expiryDate: null }),
    );

    expect(存在しないほう).toBeInstanceOf(PantryRuleViolation);
    expect(他の世帯のほう).toBeInstanceOf(PantryRuleViolation);
    expect((他の世帯のほう as PantryRuleViolation).rule).toBe(
      (存在しないほう as PantryRuleViolation).rule,
    );
    expect((他の世帯のほう as PantryRuleViolation).message).toBe(
      (存在しないほう as PantryRuleViolation).message,
    );
  });

  it('他の世帯の在庫品の更新を試みても、その在庫品は元のまま', async () => {
    // C-9 / 規則12 / NFR-09: 断った更新が隣の世帯のデータに触れていない。
    const { stockItemRepository, 更新する } = 準備();
    await 置く(
      stockItemRepository,
      在庫品({ householdId: 隣の家, amount: '2本', expiryDate: '2026-10-01' }),
    );

    await expect(
      更新する(我が家, stockItemIdOf(識別子A), { amount: '5本', expiryDate: '2026-12-31' }),
    ).rejects.toThrow(PantryRuleViolation);

    const 取得 = await stockItemRepository.findById(隣の家, stockItemIdOf(識別子A));
    expect(取得?.amount).toBe('2本');
    expect(取得?.expiryDate).toBe('2026-10-01');
  });

  it('YYYY-MM-DD でない期限での更新を断る', async () => {
    // 規則5 / FR-13: ドメインが投げた例外をユースケースで捕まえない。
    const { stockItemRepository, 更新する } = 準備();
    await 置く(stockItemRepository, 在庫品({ amount: '2本', expiryDate: '2026-10-01' }));

    const 更新 = 更新する(我が家, stockItemIdOf(識別子A), {
      amount: '5本',
      expiryDate: '2026/10/01',
    });

    await expect(更新).rejects.toThrow(PantryRuleViolation);
    await expect(更新).rejects.toHaveProperty('rule', 'expiryDate.format');
  });

  it('期限の書式が違って更新が終わったとき、保存済みの在庫品は元のまま', async () => {
    // 規則12: 検証をすべて保存の前に済ませる。分量だけが書き換わって残らない。
    const { stockItemRepository, 更新する } = 準備();
    await 置く(stockItemRepository, 在庫品({ amount: '2本', expiryDate: '2026-10-01' }));

    await expect(
      更新する(我が家, stockItemIdOf(識別子A), { amount: '5本', expiryDate: '2026/10/01' }),
    ).rejects.toThrow(PantryRuleViolation);

    const 取得 = await stockItemRepository.findById(我が家, stockItemIdOf(識別子A));
    expect(取得?.amount).toBe('2本');
    expect(取得?.expiryDate).toBe('2026-10-01');
  });

  it('保存に失敗したときは、その例外をそのまま呼び出し側へ伝える', async () => {
    // ADR-002 / 7章: ユースケースは握りつぶさない。HTTP への写像は B-08 の仕事。
    const stockItemRepository = new 保存に失敗する記憶上の在庫品リポジトリ();
    await stockItemRepository.前提として置く(在庫品({ amount: '2本' }));
    const 更新する = updateStockItem({ stockItemRepository });

    await expect(
      更新する(我が家, stockItemIdOf(識別子A), { amount: '5本', expiryDate: null }),
    ).rejects.toThrow(保存の失敗);
  });
});
