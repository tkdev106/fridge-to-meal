import { describe, expect, it } from 'vitest';
import { registerStockItem } from '../../../../src/contexts/pantry/usecase/RegisterStockItem.js';
import { PantryRuleViolation } from '../../../../src/contexts/pantry/domain/error/PantryRuleViolation.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemoryStockItemRepository } from '../../../support/pantry/InMemoryStockItemRepository.js';
import { fixedStockItemIdGenerator } from '../../../support/pantry/FixedStockItemIdGenerator.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

const idA = '22222222-2222-4222-8222-222222222222';
const idB = '33333333-3333-4333-8333-333333333333';

/**
 * リポジトリと発行器を記憶上の実装で組み、ユースケースを1つ作る。
 * テストの本題でない結線をここに隠す（`docs/testing.md` 6章）。
 */
function setUp(stockItemIdsToIssue: readonly string[] = [idA]) {
  const stockItemRepository = new InMemoryStockItemRepository();
  const register = registerStockItem({
    stockItemRepository,
    generateStockItemId: fixedStockItemIdGenerator(stockItemIdsToIssue),
  });

  return { stockItemRepository, register };
}

/** 保存だけが必ず失敗する記憶上の実装。取り出しの振る舞いは共有のものをそのまま使う。 */
class SaveFailure extends Error {}

class FailingSaveInMemoryStockItemRepository extends InMemoryStockItemRepository {
  override async save(): Promise<void> {
    throw new SaveFailure('保存できない');
  }
}

describe('在庫品を登録する RegisterStockItem', () => {
  it('名称・分量・期限を渡すと、その値のまま在庫品を登録できる', async () => {
    // FR-01 / ADR-010: 分量は自由文字列のまま持つ。
    const { register } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: 'にんじん',
      amount: '2本',
      expiryDate: '2026-10-01',
      useForMeals: true,
    });

    expect(registeredStockItem.name).toBe('にんじん');
    expect(registeredStockItem.amount).toBe('2本');
    expect(registeredStockItem.expiryDate).toBe('2026-10-01');
  });

  it.each([true, false])(
    '献立に使うかどうかに %s を渡すと、その値のまま在庫品が返る',
    async (useForMeals) => {
      // FR-01 / ADR-086 / 設計書 規則2: 入力の値をそのまま写し、返す在庫品にも載せる。
      const { register } = setUp();

      const registeredStockItem = await register(ourHousehold, { name: 'にんじん', useForMeals });

      expect(registeredStockItem.useForMeals).toBe(useForMeals);
    },
  );

  it('献立に使わないとして登録した在庫品は、同じ世帯からリポジトリで取り出しても献立に使わないまま', async () => {
    // FR-43 / 設計書 規則2: 保存の確認は取得を通して行う。
    const { register, stockItemRepository } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: 'にんじん',
      useForMeals: false,
    });

    const found = await stockItemRepository.findById(
      ourHousehold,
      stockItemIdOf(registeredStockItem.id),
    );
    expect(found?.useForMeals).toBe(false);
  });

  it('登録した在庫品は、同じ世帯からリポジトリで取り出せる', async () => {
    // 規則1・規則6: 保存できたものだけを返す。保存の確認は取得を通して行う。
    const { register, stockItemRepository } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: 'にんじん',
      useForMeals: true,
    });

    const found = await stockItemRepository.findById(
      ourHousehold,
      stockItemIdOf(registeredStockItem.id),
    );
    expect(found?.name).toBe('にんじん');
  });

  it('別の世帯からは、登録した在庫品を取り出せない', async () => {
    // C-9 / NFR-09: 世帯は第1引数の値だけで決まり、入力からは読まない。
    const { register, stockItemRepository } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: 'にんじん',
      useForMeals: true,
    });

    expect(
      await stockItemRepository.findById(neighborHousehold, stockItemIdOf(registeredStockItem.id)),
    ).toBeNull();
  });

  it('戻り値の名称は、前後の空白を落としたものになる', async () => {
    // 規則7 / 規則3: 正規化はドメインの仕事で、戻り値は保存した値を写す。
    const { register } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: '  にんじん  ',
      useForMeals: true,
    });

    expect(registeredStockItem.name).toBe('にんじん');
  });

  it('識別子はポートが発行した値になり、入力からは受け取らない', async () => {
    // 規則2 / FR-01: 採番はサーバの責務。
    const { register } = setUp([idA]);

    const registeredStockItem = await register(ourHousehold, {
      name: 'にんじん',
      useForMeals: true,
    });

    expect(registeredStockItem.id).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('同じ名称で2回登録すると、統合せず別々の識別子で2件になる', async () => {
    // ADR-007 / 規則8: 買った日が違えば期限が違う。統合も拒否もしない。
    const { register, stockItemRepository } = setUp([idA, idB]);

    const first = await register(ourHousehold, { name: 'にんじん', useForMeals: true });
    const second = await register(ourHousehold, { name: 'にんじん', useForMeals: true });

    expect(await stockItemRepository.findByHousehold(ourHousehold)).toHaveLength(2);
    expect(first.id).not.toBe(second.id);
  });

  it('ingredientId を渡さない登録は例外にならず、食材の指定なしで保存される', async () => {
    // FR-03 / 規則4: カタログに無い食材名でも登録が止まらない。
    const { register, stockItemRepository } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: '母のぬか床',
      useForMeals: true,
    });

    expect(registeredStockItem.ingredientId).toBeNull();
    const found = await stockItemRepository.findById(
      ourHousehold,
      stockItemIdOf(registeredStockItem.id),
    );
    expect(found?.ingredientId).toBeNull();
  });

  it('ingredientId に null を明示しても、省略したときと同じ結果になる', async () => {
    // 規則4: 省略と null は同義。
    const { register } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: 'にんじん',
      ingredientId: null,
      useForMeals: true,
    });

    expect(registeredStockItem.ingredientId).toBeNull();
  });

  it('空文字の ingredientId は食材の指定なしとして扱う', async () => {
    // 規則4: 空文字も「指定なし」に寄せる。判定を2通りにしない。
    const { register } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: 'にんじん',
      ingredientId: '',
      useForMeals: true,
    });

    expect(registeredStockItem.ingredientId).toBeNull();
  });

  it('空白だけの ingredientId は食材の指定なしとして扱う', async () => {
    // 規則4: 同上。
    const { register } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: 'にんじん',
      ingredientId: '   ',
      useForMeals: true,
    });

    expect(registeredStockItem.ingredientId).toBeNull();
  });

  it('カタログに存在するかを確かめずに、渡された ingredientId をそのまま持つ', async () => {
    // ADR-008 / FR-03: 確認を挟むと、カタログが答えられないときに登録が止まる。
    const { register, stockItemRepository } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: 'にんじん',
      ingredientId: '44444444-4444-4444-8444-444444444444',
      useForMeals: true,
    });

    expect(registeredStockItem.ingredientId).toBe('44444444-4444-4444-8444-444444444444');
    const found = await stockItemRepository.findById(
      ourHousehold,
      stockItemIdOf(registeredStockItem.id),
    );
    expect(found?.ingredientId).toBe('44444444-4444-4444-8444-444444444444');
  });

  it('分量を省略しても登録でき、分量なしになる', async () => {
    // 規則5 / FR-13: 分量は任意入力。
    const { register } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: 'にんじん',
      useForMeals: true,
    });

    expect(registeredStockItem.amount).toBeNull();
  });

  it('期限を省略しても登録でき、期限なしになる', async () => {
    // FR-13 / 規則5: 期限が未設定の在庫品は、期限による警告・優先の対象外。
    const { register } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: 'にんじん',
      useForMeals: true,
    });

    expect(registeredStockItem.expiryDate).toBeNull();
  });

  it('分量と期限に null を明示しても、省略したときと同じ結果になる', async () => {
    // 規則5: 省略と null は同義。
    const { register } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: 'にんじん',
      amount: null,
      expiryDate: null,
      useForMeals: true,
    });

    expect(registeredStockItem.amount).toBeNull();
    expect(registeredStockItem.expiryDate).toBeNull();
  });

  it('空白だけの分量は分量なしとして保存する', async () => {
    // 規則3 / ADR-010: 正規化は amountOf が持つ。ユースケースは書き直さない。
    const { register } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: 'にんじん',
      amount: '   ',
      useForMeals: true,
    });

    expect(registeredStockItem.amount).toBeNull();
  });

  it('空白だけの期限は期限なしとして保存する', async () => {
    // 規則3 / FR-13: 正規化は expiryDateOf が持つ。
    const { register } = setUp();

    const registeredStockItem = await register(ourHousehold, {
      name: 'にんじん',
      expiryDate: '   ',
      useForMeals: true,
    });

    expect(registeredStockItem.expiryDate).toBeNull();
  });

  it('空白だけの名称の登録を拒む', async () => {
    // domain-model 4章: 名前だけが在庫品を在庫品たらしめている。規則10 によりそのまま伝わる。
    const { register } = setUp();

    const execution = register(ourHousehold, { name: '   ', useForMeals: true });

    await expect(execution).rejects.toThrow(PantryRuleViolation);
    await expect(execution).rejects.toHaveProperty('rule', 'name.empty');
  });

  it('YYYY-MM-DD でない期限の登録を拒む', async () => {
    // FR-13: 期限は日付として並べ替えられる形でだけ受け取る。
    const { register } = setUp();

    const execution = register(ourHousehold, {
      name: 'にんじん',
      expiryDate: '2026/10/01',
      useForMeals: true,
    });

    await expect(execution).rejects.toThrow(PantryRuleViolation);
    await expect(execution).rejects.toHaveProperty('rule', 'expiryDate.format');
  });

  it('暦に存在しない日付の期限の登録を拒む', async () => {
    // FR-13: 書式だけでは 2026-02-30 が通ってしまう。
    const { register } = setUp();

    const execution = register(ourHousehold, {
      name: 'にんじん',
      expiryDate: '2026-02-30',
      useForMeals: true,
    });

    await expect(execution).rejects.toThrow(PantryRuleViolation);
    await expect(execution).rejects.toHaveProperty('rule', 'expiryDate.notACalendarDate');
  });

  it('期限の書式が違って登録が終わったとき、在庫品は1件も残らない', async () => {
    // 規則9: 検証はすべて save の前に済ませる。
    const { register, stockItemRepository } = setUp();

    await expect(
      register(ourHousehold, { name: 'にんじん', expiryDate: '2026/10/01', useForMeals: true }),
    ).rejects.toThrow(PantryRuleViolation);

    expect(await stockItemRepository.findByHousehold(ourHousehold)).toHaveLength(0);
  });

  it('保存に失敗したときは、その例外をそのまま呼び出し側へ伝える', async () => {
    // ADR-002 / 規則10: ユースケースは握りつぶさない。HTTP への写像は B-08 の仕事。
    const register = registerStockItem({
      stockItemRepository: new FailingSaveInMemoryStockItemRepository(),
      generateStockItemId: fixedStockItemIdGenerator([idA]),
    });

    await expect(register(ourHousehold, { name: 'にんじん', useForMeals: true })).rejects.toThrow(
      SaveFailure,
    );
  });
});
