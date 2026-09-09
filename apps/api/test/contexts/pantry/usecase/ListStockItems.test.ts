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
import { 記憶上の在庫品リポジトリ } from '../../../support/pantry/InMemoryStockItemRepository.js';

const 我が家 = householdIdOf('11111111-1111-4111-8111-111111111111');
const 隣の家 = householdIdOf('99999999-9999-4999-8999-999999999999');

const 識別子A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const 識別子B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * 本題が識別子でないときの採番。**同点の解き手として識別子を使う（規則4）ため、
 * 識別子まで同じ在庫品を作らない。** 並びを識別子で確かめるテストは自分で literal を渡す。
 */
let 連番 = 0;
function 次の識別子() {
  連番 += 1;
  return `00000000-0000-4000-8000-${String(連番).padStart(12, '0')}`;
}

/** テストの本題でない項目を隠す（`docs/testing.md` 6章）。本題だけが引数に現れる。 */
function 在庫品(props: {
  id?: string;
  householdId?: HouseholdId;
  name: string;
  ingredientId?: string;
  amount?: string;
  expiryDate?: string | null;
}): StockItem {
  return createStockItem({
    id: stockItemIdOf(props.id ?? 次の識別子()),
    householdId: props.householdId ?? 我が家,
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
function 準備() {
  const stockItemRepository = new 記憶上の在庫品リポジトリ();
  const 一覧する = listStockItems({ stockItemRepository });

  return { stockItemRepository, 一覧する };
}

async function 置く(stockItemRepository: StockItemRepository, ...在庫品たち: readonly StockItem[]) {
  for (const 品 of 在庫品たち) {
    await stockItemRepository.save(品.householdId, 品);
  }
}

const 名称の並び = (出力: ListStockItemsOutput) => 出力.stockItems.map((品) => 品.name);
const 識別子の並び = (出力: ListStockItemsOutput) => 出力.stockItems.map((品) => 品.id);

/**
 * 世帯ごとの配列を**毎回同じ参照で**返す記憶上の実装。一覧が受け取った配列をその場で
 * 並べ替えていないかを見るためだけのもので、共有の道具ではない（`docs/testing.md` 6章）。
 * 世帯で分けて持つのは、`findByHousehold` の「その世帯の在庫品をすべて返す」という
 * 約束から外れた実装をテストの側に作らないためである。
 */
class 同じ配列を返す記憶上の在庫品リポジトリ implements StockItemRepository {
  readonly #世帯ごとの保存済み = new Map<HouseholdId, StockItem[]>();

  #その世帯の配列(householdId: HouseholdId): StockItem[] {
    const 既存 = this.#世帯ごとの保存済み.get(householdId);
    if (既存 !== undefined) return 既存;

    const 新しい配列: StockItem[] = [];
    this.#世帯ごとの保存済み.set(householdId, 新しい配列);
    return 新しい配列;
  }

  async findById(householdId: HouseholdId, id: StockItemId) {
    return this.#その世帯の配列(householdId).find((品) => 品.id === id) ?? null;
  }

  async findByHousehold(householdId: HouseholdId) {
    return this.#その世帯の配列(householdId);
  }

  async save(householdId: HouseholdId, stockItem: StockItem) {
    if (stockItem.householdId === householdId) this.#その世帯の配列(householdId).push(stockItem);
  }

  async delete() {
    // このテストでは使わない。
  }
}

/** 取り出しだけが必ず失敗する記憶上の実装。 */
class 取り出しの失敗 extends Error {}

class 取り出しに失敗する記憶上の在庫品リポジトリ extends 記憶上の在庫品リポジトリ {
  override async findByHousehold(): Promise<StockItem[]> {
    throw new 取り出しの失敗('取り出せない');
  }
}

describe('在庫品を一覧する ListStockItems', () => {
  it('世帯の在庫品を、期限の近い順に並べて返す', async () => {
    // FR-04 / 規則2: 既定にして唯一の並びは期限の昇順。
    const { stockItemRepository, 一覧する } = 準備();
    await 置く(
      stockItemRepository,
      在庫品({ name: 'じゃがいも', expiryDate: '2026-02-01' }),
      在庫品({ name: 'たまねぎ', expiryDate: '2026-01-10' }),
      在庫品({ name: 'もち', expiryDate: '2025-12-31' }),
      在庫品({ name: 'にんじん', expiryDate: '2026-01-02' }),
    );

    const 出力 = await 一覧する(我が家);

    expect(名称の並び(出力)).toEqual(['もち', 'にんじん', 'たまねぎ', 'じゃがいも']);
  });

  it('別の世帯の在庫品は1件も返らない', async () => {
    // C-9 / NFR-09: 世帯は第1引数の値だけで決まる。
    const { stockItemRepository, 一覧する } = 準備();
    await 置く(
      stockItemRepository,
      在庫品({ name: 'にんじん', expiryDate: '2026-01-02' }),
      在庫品({ householdId: 隣の家, name: 'だいこん', expiryDate: '2025-12-31' }),
      在庫品({ householdId: 隣の家, name: 'ねぎ', expiryDate: '2026-01-01' }),
    );

    const 出力 = await 一覧する(我が家);

    expect(名称の並び(出力)).toEqual(['にんじん']);
  });

  it('期限が未設定の在庫品は、期限のあるどの在庫品よりも後ろに置く', async () => {
    // FR-13 / 規則3: 期限のあるものより後、という一点だけで扱う。
    const { stockItemRepository, 一覧する } = 準備();
    await 置く(
      stockItemRepository,
      在庫品({ name: 'みそ', expiryDate: null }),
      在庫品({ name: 'にんじん', expiryDate: '2026-01-02' }),
      在庫品({ name: 'こんぶ', expiryDate: '2029-12-31' }),
    );

    const 出力 = await 一覧する(我が家);

    expect(名称の並び(出力)).toEqual(['にんじん', 'こんぶ', 'みそ']);
  });

  it('期限が同じ在庫品どうしは、名称の昇順で並べる', async () => {
    // 規則4: 同じ入力で順序が変わってはいけない。
    const { stockItemRepository, 一覧する } = 準備();
    await 置く(
      stockItemRepository,
      在庫品({ name: 'もやし', expiryDate: '2026-01-02' }),
      在庫品({ name: 'なす', expiryDate: '2026-01-02' }),
      在庫品({ name: 'きゅうり', expiryDate: '2026-01-02' }),
    );

    const 出力 = await 一覧する(我が家);

    expect(名称の並び(出力)).toEqual(['きゅうり', 'なす', 'もやし']);
  });

  it('期限も名称も同じ在庫品どうしは、識別子の昇順で並べる', async () => {
    // 規則4: 識別子は一意なので、ここで全順序が閉じる。
    const { stockItemRepository, 一覧する } = 準備();
    await 置く(
      stockItemRepository,
      在庫品({ id: 識別子B, name: 'にんじん', expiryDate: '2026-01-02' }),
      在庫品({ id: 識別子A, name: 'にんじん', expiryDate: '2026-01-02' }),
    );

    const 出力 = await 一覧する(我が家);

    expect(識別子の並び(出力)).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]);
  });

  it('リポジトリに保存した順序を逆にしても、同じ並びで返る', async () => {
    // 規則8 / 規則4: 結果は findByHousehold が約束していない順序に依らない。
    const 識別子きゅうり = '43333333-3333-4333-8333-333333333333';
    const 識別子にんじん先 = '41111111-1111-4111-8111-111111111111';
    const 識別子にんじん後 = '42222222-2222-4222-8222-222222222222';
    const 識別子みそ = '44444444-4444-4444-8444-444444444444';
    const 四件 = [
      在庫品({ id: 識別子きゅうり, name: 'きゅうり', expiryDate: '2026-01-02' }),
      在庫品({ id: 識別子にんじん先, name: 'にんじん', expiryDate: '2026-01-02' }),
      在庫品({ id: 識別子にんじん後, name: 'にんじん', expiryDate: '2026-01-02' }),
      在庫品({ id: 識別子みそ, name: 'みそ', expiryDate: null }),
    ];

    const 順に置いた = 準備();
    await 置く(順に置いた.stockItemRepository, ...四件);
    const 逆に置いた = 準備();
    await 置く(逆に置いた.stockItemRepository, ...[...四件].reverse());

    const 順の出力 = await 順に置いた.一覧する(我が家);
    const 逆の出力 = await 逆に置いた.一覧する(我が家);

    const 期待する並び = [
      '43333333-3333-4333-8333-333333333333',
      '41111111-1111-4111-8111-111111111111',
      '42222222-2222-4222-8222-222222222222',
      '44444444-4444-4444-8444-444444444444',
    ];
    expect(識別子の並び(順の出力)).toEqual(期待する並び);
    expect(識別子の並び(逆の出力)).toEqual(期待する並び);
  });

  it('期限が未設定の在庫品どうしも、名称の昇順で並べる', async () => {
    // 規則3 / 規則4: 末尾に寄せた中でも順序を決めておく。
    const { stockItemRepository, 一覧する } = 準備();
    await 置く(
      stockItemRepository,
      在庫品({ name: 'みりん', expiryDate: null }),
      在庫品({ name: 'しお', expiryDate: null }),
      在庫品({ name: 'さとう', expiryDate: null }),
    );

    const 出力 = await 一覧する(我が家);

    expect(名称の並び(出力)).toEqual(['さとう', 'しお', 'みりん']);
  });

  it('名称の比較は実行環境の照合順序ではなく、コード単位の大小で行う', async () => {
    // 規則4: localeCompare は ICU に依存し、Workers と Node で同じ並びになる保証がない。
    const { stockItemRepository, 一覧する } = 準備();
    await 置く(
      stockItemRepository,
      在庫品({ name: 'milk', expiryDate: '2026-01-02' }),
      在庫品({ name: 'MILK', expiryDate: '2026-01-02' }),
    );

    const 出力 = await 一覧する(我が家);

    expect(名称の並び(出力)).toEqual(['MILK', 'milk']);
  });

  it('返す在庫品は期限をそのまま持ち、残日数のような期限から算出した値を持たない', async () => {
    // FR-11 / 規則5: 日数の算出は画面（B-11）が持つ。基準時刻を引数に足さない。
    const { stockItemRepository, 一覧する } = 準備();
    await 置く(stockItemRepository, 在庫品({ name: 'にんじん', expiryDate: '2026-01-02' }));

    const 出力 = await 一覧する(我が家);

    const 一件目 = 出力.stockItems[0];
    expect(一件目?.expiryDate).toBe('2026-01-02');
    expect(Object.keys(一件目 ?? {}).sort()).toEqual([
      'amount',
      'expiryDate',
      'id',
      'ingredientId',
      'name',
    ]);
  });

  it('保存されている値を加工せずに写す', async () => {
    // 規則10: trim も既定値の補完もドメインで済んでいる。
    const { stockItemRepository, 一覧する } = 準備();
    await 置く(
      stockItemRepository,
      在庫品({
        id: 識別子A,
        name: 'にんじん',
        ingredientId: '44444444-4444-4444-8444-444444444444',
        amount: '2本',
        expiryDate: '2026-01-02',
      }),
    );

    const 出力 = await 一覧する(我が家);

    expect(出力.stockItems).toEqual([
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
    const { stockItemRepository, 一覧する } = 準備();
    await 置く(
      stockItemRepository,
      在庫品({ householdId: 隣の家, name: 'だいこん', expiryDate: '2025-12-31' }),
    );

    const 出力 = await 一覧する(我が家);

    expect(出力.stockItems).toEqual([]);
  });

  it('名称も期限も同じ在庫品を、統合せずどちらも返す', async () => {
    // ADR-007 / 規則9: 買った日が違えば別の在庫品。一意化も統合もしない。
    const { stockItemRepository, 一覧する } = 準備();
    await 置く(
      stockItemRepository,
      在庫品({ id: 識別子A, name: 'にんじん', expiryDate: '2026-01-02' }),
      在庫品({ id: 識別子B, name: 'にんじん', expiryDate: '2026-01-02' }),
    );

    const 出力 = await 一覧する(我が家);

    expect(出力.stockItems).toHaveLength(2);
    expect(識別子の並び(出力)).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]);
  });

  it('一覧しても、リポジトリが保持している在庫品の並びは変わらない', async () => {
    // ADR-002 / 規則7: 受け取った配列をその場で書き換えない。
    const stockItemRepository: StockItemRepository = new 同じ配列を返す記憶上の在庫品リポジトリ();
    const 一覧する = listStockItems({ stockItemRepository });
    await 置く(
      stockItemRepository,
      在庫品({ name: 'こんぶ', expiryDate: '2029-12-31' }),
      在庫品({ name: 'たまねぎ', expiryDate: '2026-01-10' }),
      在庫品({ name: 'もち', expiryDate: '2025-12-31' }),
    );

    await 一覧する(我が家);

    const 保持されているもの = await stockItemRepository.findByHousehold(我が家);
    expect(保持されているもの.map((品) => 品.name)).toEqual(['こんぶ', 'たまねぎ', 'もち']);
  });

  it('取り出しに失敗したときは、その例外をそのまま呼び出し側へ伝える', async () => {
    // ADR-002 / 7章: ユースケースは握りつぶさない。HTTP への写像は B-08 の仕事。
    const 一覧する = listStockItems({
      stockItemRepository: new 取り出しに失敗する記憶上の在庫品リポジトリ(),
    });

    await expect(一覧する(我が家)).rejects.toThrow(取り出しの失敗);
  });
});
