import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createStockItem } from '../../src/contexts/pantry/domain/entity/StockItem.js';
import type { StockItemId } from '../../src/contexts/pantry/domain/value/StockItemId.js';
import { stockItemIdOf } from '../../src/contexts/pantry/domain/value/StockItemId.js';
import { StockItemRepositoryImpl } from '../../src/contexts/pantry/infrastructure/StockItemRepositoryImpl.js';
import type { HouseholdTransaction } from '../../src/contexts/pantry/infrastructure/db/HouseholdTransaction.js';
import { withHouseholdTransaction } from '../../src/contexts/pantry/infrastructure/db/HouseholdTransaction.js';
import type { HouseholdId } from '../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../src/shared/domain/HouseholdId.js';
import { アプリの接続文字列 } from '../support/db/ConnectionStrings.js';

/**
 * ローカル Postgres に対する `StockItemRepositoryImpl` の1周目
 * （B-07 設計 規則1・2・3・4・13 / ADR-029 / ADR-028 / C-9 / NFR-09 / FR-01）。
 * **`pnpm test:db` でだけ走る** — `pnpm test` は `apps/api/test/db/**` を除外する。
 *
 * 繋ぐのは `authenticator` だけ。所有者（`postgres`）の接続を使うと行レベルセキュリティが
 * 素通りし、**RLS が無くても緑になる**（B-07 設計 9章）。
 *
 * **世帯 ID と在庫品 ID はケースごとに固有の固定値を使い、使い回さない。** 表は
 * `globalSetup` で1度だけ作られ、ファイルとケースをまたいで共有されるため。
 * **後片付けはしない。**
 */
const 世帯_往復 = householdIdOf('b7010000-0000-4000-8000-000000000001');
const 在庫品識別子_往復 = stockItemIdOf('b7010000-0000-4000-8000-0000000000f1');

const 世帯_張り直し = householdIdOf('b7020000-0000-4000-8000-000000000002');
const 在庫品識別子_張り直し = stockItemIdOf('b7020000-0000-4000-8000-0000000000f2');

const 世帯_巻き戻し = householdIdOf('b7030000-0000-4000-8000-000000000003');
const 在庫品識別子_巻き戻し = stockItemIdOf('b7030000-0000-4000-8000-0000000000f3');

const 世帯_見つからない = householdIdOf('b7040000-0000-4000-8000-000000000004');
const 在庫品識別子_保存しない = stockItemIdOf('b7040000-0000-4000-8000-0000000000f4');

const 世帯_持ち主 = householdIdOf('b7050000-0000-4000-8000-000000000005');
const 世帯_他人 = householdIdOf('b7050000-0000-4000-8000-000000000015');
const 在庫品識別子_他世帯 = stockItemIdOf('b7050000-0000-4000-8000-0000000000f5');

const 世帯_引数の食い違い = householdIdOf('b7060000-0000-4000-8000-000000000006');
const 世帯_渡す側 = householdIdOf('b7060000-0000-4000-8000-000000000016');
const 在庫品識別子_食い違い = stockItemIdOf('b7060000-0000-4000-8000-0000000000f6');

const 世帯_衝突の持ち主 = householdIdOf('b7070000-0000-4000-8000-000000000007');
const 世帯_衝突させる側 = householdIdOf('b7070000-0000-4000-8000-000000000017');
const 在庫品識別子_衝突 = stockItemIdOf('b7070000-0000-4000-8000-0000000000f7');

// 1本の接続で複数のトランザクションを張る。`local` が次のトランザクションへ漏れて
// いないことは、同じ接続を使い回すことでしか見えない（ADR-029 決定3(a)）。
const 接続 = postgres(アプリの接続文字列, { max: 1 });
const データベース = drizzle(接続);

afterAll(async () => {
  await 接続.end();
});

/**
 * 1周目の在庫品は**最小のもの**（名称のみ）。分量・期限・食材の写像は2周目に確かめる。
 * 素のリテラルを在庫品として扱わず、必ずドメインの生成関数を通す（B-07 設計 規則11）。
 */
function 在庫品(props: { id: StockItemId; householdId: HouseholdId; name: string }) {
  return createStockItem({
    id: props.id,
    householdId: props.householdId,
    name: props.name,
    ingredientId: null,
    amount: null,
    expiryDate: null,
  });
}

/**
 * **クレームを張らない** handle を1つ作る（`withHouseholdTransaction` には無い経路 —
 * 本体は常にクレームを張る。B-07 設計 規則2）。
 *
 * `set local role authenticated` だけは張る。張らないと `authenticator` に
 * `stock_items` の権限が無く、確かめたい「0行」ではなく権限エラーで落ちる。
 */
function クレームを張らないトランザクション<T>(
  本体: (tx: HouseholdTransaction) => Promise<T>,
): Promise<T> {
  return データベース.transaction(async (tx) => {
    await tx.execute(sql`set local role authenticated`);
    return 本体(tx);
  });
}

describe('在庫品リポジトリの実装', () => {
  it('保存した在庫品を同じ世帯の findById で読み戻せる', async () => {
    const 保存する在庫品 = 在庫品({
      id: 在庫品識別子_往復,
      householdId: 世帯_往復,
      name: 'にんじん',
    });

    const 読み戻した在庫品 = await withHouseholdTransaction(データベース, 世帯_往復, async (tx) => {
      const リポジトリ = new StockItemRepositoryImpl(tx);
      await リポジトリ.save(世帯_往復, 保存する在庫品);
      return リポジトリ.findById(世帯_往復, 在庫品識別子_往復);
    });

    // FR-01: 登録した在庫品が残ること。行と在庫品の往復が成り立っていることを、
    // 保存したものと同じ値が返ることで見る（B-07 設計 規則3・11）。
    expect(読み戻した在庫品).toMatchObject({
      id: 在庫品識別子_往復,
      householdId: 世帯_往復,
      name: 'にんじん',
    });
  });

  it('保存した在庫品は、クレームを張らないトランザクションからは読めず、クレームを張り直したトランザクションではもう一度読める', async () => {
    await withHouseholdTransaction(データベース, 世帯_張り直し, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        世帯_張り直し,
        在庫品({ id: 在庫品識別子_張り直し, householdId: 世帯_張り直し, name: 'にんじん' }),
      ),
    );

    const クレーム無しで読めた在庫品 = await クレームを張らないトランザクション((tx) =>
      new StockItemRepositoryImpl(tx).findById(世帯_張り直し, 在庫品識別子_張り直し),
    );

    const 張り直して読めた在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_張り直し,
      (tx) => new StockItemRepositoryImpl(tx).findById(世帯_張り直し, 在庫品識別子_張り直し),
    );

    // ADR-029 理由(1): クレームを張り忘れた問い合わせは**0行**になる（例外ではない）。
    expect(クレーム無しで読めた在庫品).toBeNull();
    // ADR-029 理由(4): 3つ目が、0行の理由を「見えない」に絞り込む唯一の手である
    // （1つ目が commit されていないだけ、では説明がつかなくなる）。
    expect(張り直して読めた在庫品?.name).toBe('にんじん');
  });

  it('トランザクションの本体が例外を投げると、その中で保存した在庫品は残らない', async () => {
    const 本体の失敗 = new Error('本体が投げた');

    // ADR-029 決定3(a): 寿命を持つのは呼ぶ側。本体が投げたら1つの単位ごと巻き戻る。
    await expect(
      withHouseholdTransaction(データベース, 世帯_巻き戻し, async (tx) => {
        await new StockItemRepositoryImpl(tx).save(
          世帯_巻き戻し,
          在庫品({ id: 在庫品識別子_巻き戻し, householdId: 世帯_巻き戻し, name: 'にんじん' }),
        );
        throw 本体の失敗;
      }),
    ).rejects.toBe(本体の失敗);

    const 張り直して読めた在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_巻き戻し,
      (tx) => new StockItemRepositoryImpl(tx).findById(世帯_巻き戻し, 在庫品識別子_巻き戻し),
    );

    expect(張り直して読めた在庫品).toBeNull();
  });

  it('保存していない在庫品 ID を指すと null を返す', async () => {
    const 読めた在庫品 = await withHouseholdTransaction(データベース, 世帯_見つからない, (tx) =>
      new StockItemRepositoryImpl(tx).findById(世帯_見つからない, 在庫品識別子_保存しない),
    );

    // B-07 設計 規則4: 0行は `null`。**例外にしない。**
    expect(読めた在庫品).toBeNull();
  });

  it('他世帯が保存した在庫品は null になる', async () => {
    await withHouseholdTransaction(データベース, 世帯_持ち主, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        世帯_持ち主,
        在庫品({ id: 在庫品識別子_他世帯, householdId: 世帯_持ち主, name: 'にんじん' }),
      ),
    );

    const 他人に見えた在庫品 = await withHouseholdTransaction(データベース, 世帯_他人, (tx) =>
      new StockItemRepositoryImpl(tx).findById(世帯_他人, 在庫品識別子_他世帯),
    );

    const 持ち主に見えた在庫品 = await withHouseholdTransaction(データベース, 世帯_持ち主, (tx) =>
      new StockItemRepositoryImpl(tx).findById(世帯_持ち主, 在庫品識別子_他世帯),
    );

    // C-9 / NFR-09: 世帯をまたぐ取得は「無い」として扱う（例外にしない）。
    expect(他人に見えた在庫品).toBeNull();
    // 行が実在することの裏取り。無ければ `null` は当たり前に起きる。
    expect(持ち主に見えた在庫品?.name).toBe('にんじん');
  });

  it('クレームで見えている在庫品でも、引数の世帯が食い違えば null になる', async () => {
    const 別の世帯で読めた在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_引数の食い違い,
      async (tx) => {
        const リポジトリ = new StockItemRepositoryImpl(tx);
        await リポジトリ.save(
          世帯_引数の食い違い,
          在庫品({
            id: 在庫品識別子_食い違い,
            householdId: 世帯_引数の食い違い,
            name: 'にんじん',
          }),
        );
        // B-07 設計 規則3: RLS で見えていても、引数の世帯で必ず絞る（網は二重）。
        // `where` を外した実装なら、ここで在庫品が返ってしまう。
        return リポジトリ.findById(世帯_渡す側, 在庫品識別子_食い違い);
      },
    );

    // C-9 / NFR-09
    expect(別の世帯で読めた在庫品).toBeNull();
  });

  it('他世帯の在庫品と同じ ID の保存は成功せず、相手世帯の行も変わらない', async () => {
    await withHouseholdTransaction(データベース, 世帯_衝突の持ち主, (tx) =>
      new StockItemRepositoryImpl(tx).save(
        世帯_衝突の持ち主,
        在庫品({ id: 在庫品識別子_衝突, householdId: 世帯_衝突の持ち主, name: 'にんじん' }),
      ),
    );

    // B-07 設計 規則13: **例外の型・コードは約束しない**（SQLSTATE を期待値に書かない）。
    await expect(
      withHouseholdTransaction(データベース, 世帯_衝突させる側, (tx) =>
        new StockItemRepositoryImpl(tx).save(
          世帯_衝突させる側,
          在庫品({ id: 在庫品識別子_衝突, householdId: 世帯_衝突させる側, name: 'たまねぎ' }),
        ),
      ),
    ).rejects.toBeInstanceOf(Error);

    const 持ち主に見えた在庫品 = await withHouseholdTransaction(
      データベース,
      世帯_衝突の持ち主,
      (tx) => new StockItemRepositoryImpl(tx).findById(世帯_衝突の持ち主, 在庫品識別子_衝突),
    );

    // C-9 / NFR-09: このケースの重心はここ。例外だけでは、他世帯の行を上書きしたうえで
    // 別の理由で投げた実装と見分けがつかない。
    expect(持ち主に見えた在庫品?.name).toBe('にんじん');
  });
});
