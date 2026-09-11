import type { ListStockItemsOutput, StockItemDto } from '@fridge-to-meal/contract';
import { describe, expect, it } from 'vitest';
import { createStockItemRoutes } from '../../../../src/contexts/pantry/api/StockItemRoutes.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { 記憶上の世帯の特定 } from '../../../support/identity/FixedIdentifyHousehold.js';
import {
  記憶上の在庫品の一覧,
  記憶上の在庫品の削除,
  記憶上の在庫品の更新,
  記憶上の在庫品の登録,
} from '../../../support/pantry/FixedStockItemUsecases.js';

const 我が家 = householdIdOf('11111111-1111-4111-8111-111111111111');
const 隣の家 = householdIdOf('99999999-9999-4999-8999-999999999999');

/**
 * アクセストークンは ASCII で置く。**ヘッダの値に非 ASCII を入れられない**
 * （`Headers` は値を ByteString に変換するため、日本語の文字で TypeError になる）。
 * api が見るのは方式名と最初の空白だけなので、値の中身はこのテストの本題ではない。
 */
const アクセストークンA = 'access-token-a';

/** 在庫品1件の DTO。本題でない項目をここに隠す（`docs/testing.md` 6章）。 */
function 在庫品のDTO(overrides: Partial<StockItemDto> = {}): StockItemDto {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'にんじん',
    ingredientId: null,
    amount: null,
    expiryDate: null,
    ...overrides,
  };
}

/**
 * 4つのユースケースと世帯の特定を代役で組み、経路を1つ作る。
 * テストの本題でない結線をここに隠す（`docs/testing.md` 6章）。
 */
function 準備(
  overrides: {
    登録の結果?: StockItemDto;
    一覧の出力?: ListStockItemsOutput;
    更新の結果?: StockItemDto;
  } = {},
) {
  const 世帯の特定 = new 記憶上の世帯の特定(我が家);
  const 登録 = new 記憶上の在庫品の登録(overrides.登録の結果 ?? 在庫品のDTO());
  const 一覧 = new 記憶上の在庫品の一覧(overrides.一覧の出力 ?? { stockItems: [在庫品のDTO()] });
  const 更新 = new 記憶上の在庫品の更新(overrides.更新の結果 ?? 在庫品のDTO());
  const 削除 = new 記憶上の在庫品の削除();

  const 経路 = createStockItemRoutes({
    identifyHousehold: 世帯の特定.世帯を定める,
    registerStockItem: 登録.登録する,
    listStockItems: 一覧.一覧する,
    updateStockItem: 更新.更新する,
    deleteStockItem: 削除.削除する,
  });

  return { 経路, 世帯の特定, 登録, 一覧, 更新, 削除 };
}

/** 認証ヘッダ1つ。方式名と値の組み立てが本題のときだけ引数で上書きする。 */
function 認証ヘッダ(値: string = `Bearer ${アクセストークンA}`): Record<string, string> {
  return { Authorization: 値 };
}

/** 本体を JSON で送る要求。 */
function JSONの要求(method: string, 本体: unknown, ヘッダ = 認証ヘッダ()) {
  return {
    method,
    headers: { ...ヘッダ, 'content-type': 'application/json' },
    body: JSON.stringify(本体),
  };
}

describe('在庫品の経路 StockItemRoutes', () => {
  describe('世帯の受け渡し', () => {
    it('Authorization の Bearer の後ろの値をアクセストークンとして渡す', async () => {
      // 規則2 / C-9 / NFR-09: 世帯は提示されたアクセストークンからだけ定まる。
      const { 経路, 世帯の特定 } = 準備();

      await 経路.request('/stock-items', { headers: 認証ヘッダ() });

      expect(世帯の特定.受け取ったアクセストークン).toBe('access-token-a');
    });

    it('方式名が小文字の bearer でも世帯を定めて一覧を返す', async () => {
      // 規則3: 方式名の照合は大小を区別しない。
      const { 経路, 世帯の特定 } = 準備();

      const 応答 = await 経路.request('/stock-items', {
        headers: 認証ヘッダ(`bearer ${アクセストークンA}`),
      });

      expect(応答.status).toBe(200);
      expect(世帯の特定.受け取ったアクセストークン).toBe('access-token-a');
    });

    it('アクセストークンの中の空白を落とさずにそのまま渡す', async () => {
      // 規則4: 正規化は腐敗防止層の仕事であり、api は加工しない。
      // **末尾の空白では確かめられない** — ヘッダの値の前後にある空白は `Headers` の
      // 正規化で api に届く前に落ちるためである（api の外の事情）。落とさないことは
      // ここと次の「最初の1空白」の2件で押さえる。
      const { 経路, 世帯の特定 } = 準備();

      await 経路.request('/stock-items', {
        headers: 認証ヘッダ('Bearer access token a'),
      });

      expect(世帯の特定.受け取ったアクセストークン).toBe('access token a');
    });

    it('Bearer と値の区切りは最初の1空白とする', async () => {
      // 規則4b: 区切りを「連続する空白」と読むと、api が正規化を1つ持つことになる。
      const { 経路, 世帯の特定 } = 準備();

      await 経路.request('/stock-items', {
        headers: 認証ヘッダ(`Bearer  ${アクセストークンA}`),
      });

      expect(世帯の特定.受け取ったアクセストークン).toBe(' access-token-a');
    });

    it('一覧はクエリの householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      // C-9 / 規則2: 要求から世帯を読める道を作らない。
      const { 経路, 一覧 } = 準備();

      await 経路.request(`/stock-items?householdId=${隣の家}`, { headers: 認証ヘッダ() });

      expect(一覧.受け取った世帯).toBe(我が家);
    });

    it('登録は要求本体の householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      // C-9 / 規則2: 同じことを登録でも守る。
      const { 経路, 登録 } = 準備();

      await 経路.request(
        '/stock-items',
        JSONの要求('POST', { name: 'にんじん', householdId: 隣の家 }),
      );

      expect(登録.受け取った世帯).toBe(我が家);
    });
  });

  describe('登録 POST /stock-items', () => {
    it('登録に成功したら 201 を返す', async () => {
      // FR-01 / 規則6。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items', JSONの要求('POST', { name: 'にんじん' }));

      expect(応答.status).toBe(201);
    });

    it('応答本体はユースケースが返した在庫品の DTO そのままである', async () => {
      // 規則1 / ADR-003: api で詰め替えも整形もしない。
      const { 経路 } = 準備({
        登録の結果: 在庫品のDTO({
          id: 's-1',
          name: 'にんじん',
          ingredientId: 'i-1',
          amount: '2本',
          expiryDate: '2026-10-01',
        }),
      });

      const 応答 = await 経路.request('/stock-items', JSONの要求('POST', { name: 'にんじん' }));

      await expect(応答.json()).resolves.toEqual({
        id: 's-1',
        name: 'にんじん',
        ingredientId: 'i-1',
        amount: '2本',
        expiryDate: '2026-10-01',
      });
    });

    it('応答本体に世帯を載せない', async () => {
      // 規則14 / C-9: 世帯は応答に出さない。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items', JSONの要求('POST', { name: 'にんじん' }));

      const 本体 = (await 応答.json()) as Record<string, unknown>;
      expect(Object.keys(本体)).not.toContain('householdId');
    });

    it('世帯をユースケースの第1引数に渡す', async () => {
      // C-9: `householdId` は必ず第1引数。
      const { 経路, 登録 } = 準備();

      await 経路.request('/stock-items', JSONの要求('POST', { name: 'にんじん' }));

      expect(登録.受け取った世帯).toBe(我が家);
    });

    it('要求本体をそのまま第2引数に渡す', async () => {
      // 規則7: 空白の落としも既定値の補完もドメインに委ね、api で二重に持たない。
      const { 経路, 登録 } = 準備();

      await 経路.request(
        '/stock-items',
        JSONの要求('POST', {
          name: '  にんじん  ',
          ingredientId: 'i-1',
          amount: '2本',
          expiryDate: '2026-10-01',
        }),
      );

      expect(登録.受け取った入力).toEqual({
        name: '  にんじん  ',
        ingredientId: 'i-1',
        amount: '2本',
        expiryDate: '2026-10-01',
      });
    });

    it('ingredientId と amount と expiryDate を省略しても登録できる', async () => {
      // 規則8 / `RegisterStockItemInput`: 省略を許す。
      const { 経路, 登録 } = 準備();

      const 応答 = await 経路.request('/stock-items', JSONの要求('POST', { name: 'にんじん' }));

      expect(応答.status).toBe(201);
      expect(登録.受け取った入力).toEqual({ name: 'にんじん' });
    });

    it('ingredientId と amount と expiryDate が null でも登録できる', async () => {
      // 規則8: 省略と `null` は同義（`RegisterStockItemInput`）。
      const { 経路, 登録 } = 準備();

      const 応答 = await 経路.request(
        '/stock-items',
        JSONの要求('POST', {
          name: 'にんじん',
          ingredientId: null,
          amount: null,
          expiryDate: null,
        }),
      );

      expect(応答.status).toBe(201);
      expect(登録.受け取った入力).toEqual({
        name: 'にんじん',
        ingredientId: null,
        amount: null,
        expiryDate: null,
      });
    });

    it('知らない項目が本体にあっても断らずに登録する', async () => {
      // 規則10: 断ると版の前後で登録が止まる。
      const { 経路 } = 準備();

      const 応答 = await 経路.request(
        '/stock-items',
        JSONの要求('POST', { name: 'にんじん', memo: '半分使った' }),
      );

      expect(応答.status).toBe(201);
    });
  });

  describe('一覧 GET /stock-items', () => {
    it('一覧に成功したら 200 を返す', async () => {
      // FR-04 / 規則6。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items', { headers: 認証ヘッダ() });

      expect(応答.status).toBe(200);
    });

    it('応答本体はユースケースが返した一覧の出力そのままである', async () => {
      // 規則1 / ADR-003: 包み方も項目も変えない。
      const { 経路 } = 準備({
        一覧の出力: {
          stockItems: [
            在庫品のDTO({ id: 's-1', name: 'にんじん', amount: '2本', expiryDate: '2026-10-01' }),
          ],
        },
      });

      const 応答 = await 経路.request('/stock-items', { headers: 認証ヘッダ() });

      await expect(応答.json()).resolves.toEqual({
        stockItems: [
          {
            id: 's-1',
            name: 'にんじん',
            ingredientId: null,
            amount: '2本',
            expiryDate: '2026-10-01',
          },
        ],
      });
    });

    it('ユースケースが返した並びを保ったまま返す', async () => {
      // 規則12 / FR-04: 並べ替えるのはユースケースであり、api は並びを触らない。
      const { 経路 } = 準備({
        一覧の出力: {
          stockItems: [
            在庫品のDTO({ id: 's-3' }),
            在庫品のDTO({ id: 's-1' }),
            在庫品のDTO({ id: 's-2' }),
          ],
        },
      });

      const 応答 = await 経路.request('/stock-items', { headers: 認証ヘッダ() });

      const 本体 = (await 応答.json()) as ListStockItemsOutput;
      expect(本体.stockItems.map((在庫品) => 在庫品.id)).toEqual(['s-3', 's-1', 's-2']);
    });

    it('在庫品が0件のときも 200 で空の一覧を返す', async () => {
      // FR-04: 0件は失敗ではない。
      const { 経路 } = 準備({ 一覧の出力: { stockItems: [] } });

      const 応答 = await 経路.request('/stock-items', { headers: 認証ヘッダ() });

      expect(応答.status).toBe(200);
      await expect(応答.json()).resolves.toEqual({ stockItems: [] });
    });

    it('世帯をユースケースの第1引数に渡す', async () => {
      // C-9。
      const { 経路, 一覧 } = 準備();

      await 経路.request('/stock-items', { headers: 認証ヘッダ() });

      expect(一覧.受け取った世帯).toBe(我が家);
    });
  });

  describe('更新 PUT /stock-items/:id', () => {
    it('更新に成功したら 200 を返す', async () => {
      // FR-05 / 規則6。
      const { 経路 } = 準備();

      const 応答 = await 経路.request(
        '/stock-items/s-1',
        JSONの要求('PUT', { amount: '1本', expiryDate: '2026-10-02' }),
      );

      expect(応答.status).toBe(200);
    });

    it('応答本体はユースケースが返した更新後の DTO そのままである', async () => {
      // 規則1 / ADR-003。
      const { 経路 } = 準備({
        更新の結果: 在庫品のDTO({
          id: 's-1',
          name: 'にんじん',
          ingredientId: 'i-1',
          amount: '1本',
          expiryDate: '2026-10-02',
        }),
      });

      const 応答 = await 経路.request(
        '/stock-items/s-1',
        JSONの要求('PUT', { amount: '1本', expiryDate: '2026-10-02' }),
      );

      await expect(応答.json()).resolves.toEqual({
        id: 's-1',
        name: 'にんじん',
        ingredientId: 'i-1',
        amount: '1本',
        expiryDate: '2026-10-02',
      });
    });

    it('世帯をユースケースの第1引数に渡す', async () => {
      // C-9。
      const { 経路, 更新 } = 準備();

      await 経路.request(
        '/stock-items/s-1',
        JSONの要求('PUT', { amount: '1本', expiryDate: '2026-10-02' }),
      );

      expect(更新.受け取った世帯).toBe(我が家);
    });

    it('経路の識別子を加工せずに第2引数に渡す', async () => {
      // 規則11: 書式も長さも見ない。形を決めるのは識別子を発行する側（ADR-026）。
      const { 経路, 更新 } = 準備();

      await 経路.request(
        '/stock-items/s-1',
        JSONの要求('PUT', { amount: '1本', expiryDate: '2026-10-02' }),
      );

      expect(更新.受け取った識別子).toBe(stockItemIdOf('s-1'));
    });

    it('要求本体をそのまま第3引数に渡す', async () => {
      // 規則1 / 規則7: 分量は自由文字列のまま渡す（ADR-010）。
      const { 経路, 更新 } = 準備();

      await 経路.request(
        '/stock-items/s-1',
        JSONの要求('PUT', { amount: '  1本  ', expiryDate: '2026-10-02' }),
      );

      expect(更新.受け取った入力).toEqual({ amount: '  1本  ', expiryDate: '2026-10-02' });
    });

    it('amount と expiryDate が null でも更新できる', async () => {
      // 規則9 / FR-13: `null` が「消す」を表す。
      const { 経路, 更新 } = 準備();

      const 応答 = await 経路.request(
        '/stock-items/s-1',
        JSONの要求('PUT', { amount: null, expiryDate: null }),
      );

      expect(応答.status).toBe(200);
      expect(更新.受け取った入力).toEqual({ amount: null, expiryDate: null });
    });
  });

  describe('削除 DELETE /stock-items/:id', () => {
    it('削除に成功したら 204 を返す', async () => {
      // FR-06 / 規則6。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items/s-1', {
        method: 'DELETE',
        headers: 認証ヘッダ(),
      });

      expect(応答.status).toBe(204);
    });

    it('削除の応答に本体を載せない', async () => {
      // 規則6: 204 は本体なし。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items/s-1', {
        method: 'DELETE',
        headers: 認証ヘッダ(),
      });

      await expect(応答.text()).resolves.toBe('');
    });

    it('世帯をユースケースの第1引数に渡す', async () => {
      // C-9。
      const { 経路, 削除 } = 準備();

      await 経路.request('/stock-items/s-1', { method: 'DELETE', headers: 認証ヘッダ() });

      expect(削除.受け取った世帯).toBe(我が家);
    });

    it('経路の識別子を加工せずに第2引数に渡す', async () => {
      // 規則11。
      const { 経路, 削除 } = 準備();

      await 経路.request('/stock-items/s-1', { method: 'DELETE', headers: 認証ヘッダ() });

      expect(削除.受け取った識別子).toBe(stockItemIdOf('s-1'));
    });
  });
});
