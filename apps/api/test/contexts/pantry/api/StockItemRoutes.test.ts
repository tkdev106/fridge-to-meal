import type { ListStockItemsOutput, StockItemDto } from '@fridge-to-meal/contract';
import { describe, expect, it } from 'vitest';
import { createStockItemRoutes } from '../../../../src/contexts/pantry/api/StockItemRoutes.js';
import { IdentityRuleViolation } from '../../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';
import { PantryRuleViolation } from '../../../../src/contexts/pantry/domain/error/PantryRuleViolation.js';
import { stockItemIdOf } from '../../../../src/contexts/pantry/domain/value/StockItemId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { 記憶上の世帯の特定 } from '../../../support/identity/FixedIdentifyHousehold.js';
import type { 削除の応答 } from '../../../support/pantry/FixedStockItemUsecases.js';
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
 *
 * 失敗の写像（B-08 7章）を見るときは `〜が投げる例外` を渡す。**投げる例外と返す値は
 * 同時に渡せない** — 代役の応答がどちらか一方であるため。削除だけは応答を順に持てる
 * （冪等でないこと＝規則13 を、2度目の違いとして見るため）。
 */
function 準備(
  overrides: {
    登録の結果?: StockItemDto;
    一覧の出力?: ListStockItemsOutput;
    更新の結果?: StockItemDto;
    世帯の特定が投げる例外?: Error;
    登録が投げる例外?: Error;
    一覧が投げる例外?: Error;
    更新が投げる例外?: Error;
    削除の応答たち?: readonly 削除の応答[];
  } = {},
) {
  const 削除の応答たち: readonly 削除の応答[] = overrides.削除の応答たち ?? [{ 成功: true }];

  const 世帯の特定 = new 記憶上の世帯の特定(
    overrides.世帯の特定が投げる例外 === undefined
      ? { 返す世帯: 我が家 }
      : { 投げる例外: overrides.世帯の特定が投げる例外 },
  );
  const 登録 = new 記憶上の在庫品の登録(
    overrides.登録が投げる例外 === undefined
      ? { 返す在庫品: overrides.登録の結果 ?? 在庫品のDTO() }
      : { 投げる例外: overrides.登録が投げる例外 },
  );
  const 一覧 = new 記憶上の在庫品の一覧(
    overrides.一覧が投げる例外 === undefined
      ? { 返す出力: overrides.一覧の出力 ?? { stockItems: [在庫品のDTO()] } }
      : { 投げる例外: overrides.一覧が投げる例外 },
  );
  const 更新 = new 記憶上の在庫品の更新(
    overrides.更新が投げる例外 === undefined
      ? { 返す在庫品: overrides.更新の結果 ?? 在庫品のDTO() }
      : { 投げる例外: overrides.更新が投げる例外 },
  );
  const 削除 = new 記憶上の在庫品の削除(...削除の応答たち);

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

/**
 * 本体を文字列のまま送る要求。**JSON として読めない本体**を渡すときに使う
 * （`JSON.stringify` を通すと必ず読める本体になってしまう）。
 */
function 生の本体の要求(method: string, 本体: string, ヘッダ = 認証ヘッダ()) {
  return {
    method,
    headers: { ...ヘッダ, 'content-type': 'application/json' },
    body: 本体,
  };
}

/**
 * JSON として読めればその値、**読めなければ読めた文字列そのもの**を返す。構文エラーで
 * 落とすと、`{ rule }` の代わりに何が返ったのかが読めなくなるため。
 */
function 読める本体(テキスト: string): unknown {
  try {
    return JSON.parse(テキスト) as unknown;
  } catch {
    return テキスト;
  }
}

/**
 * 失敗の応答本体。`{ rule }` のはずのものを読む。
 *
 * 引数の型を `Response` と書かないのは、**このテストのプロジェクトが実行環境の型を
 * 入れていない**ためである（`apps/api/tsconfig.test.json` の `lib` は ES2022、`types` は空）。
 * 本文が読めることだけを求めれば、グローバルに依らずに書ける。
 */
async function 失敗の本体(応答: { text(): Promise<string> }): Promise<unknown> {
  return 読める本体(await 応答.text());
}

/**
 * 規則違反に似せた別の例外。`name` が違うものを規則違反として扱わないことを確かめるのに使う
 * （ADR-032 の決定2 / 結果2 — `name` は外向きの契約である）。
 */
function 規則違反に似せた例外(rule: string, message: string): Error {
  const 例外 = new Error(message);
  例外.name = 'OtherRuleViolation';
  return Object.assign(例外, { rule });
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

  describe('在庫の規則違反の写像', () => {
    it('名称が空だと断られた登録は 400 を返す', async () => {
      // 7章の表: `name.empty` は入力の誤り（`StockItem` の不変条件）。
      const { 経路 } = 準備({
        登録が投げる例外: new PantryRuleViolation('name.empty', '名称が空である'),
      });

      const 応答 = await 経路.request('/stock-items', JSONの要求('POST', { name: '' }));

      expect(応答.status).toBe(400);
      await expect(失敗の本体(応答)).resolves.toEqual({ rule: 'name.empty' });
    });

    it('期限の書式が違うと断られた登録は 400 を返す', async () => {
      // 7章の表: `expiryDate.format` は入力の誤り（`ExpiryDate`）。
      const { 経路 } = 準備({
        登録が投げる例外: new PantryRuleViolation('expiryDate.format', '期限の書式が違う'),
      });

      const 応答 = await 経路.request(
        '/stock-items',
        JSONの要求('POST', { name: 'にんじん', expiryDate: '2026/10/01' }),
      );

      expect(応答.status).toBe(400);
    });

    it('暦に無い日付だと断られた更新は 400 を返す', async () => {
      // 7章の表: `expiryDate.notACalendarDate` も入力の誤りである。
      const { 経路 } = 準備({
        更新が投げる例外: new PantryRuleViolation(
          'expiryDate.notACalendarDate',
          '暦に無い日付である',
        ),
      });

      const 応答 = await 経路.request(
        '/stock-items/s-1',
        JSONの要求('PUT', { amount: '1本', expiryDate: '2026-02-30' }),
      );

      expect(応答.status).toBe(400);
    });

    it('更新する在庫品が見つからないときは 404 を返す', async () => {
      // 7章の表 / B-06 規則8 / C-9: 見つからない。**表が無いと 400 になる行である。**
      const { 経路 } = 準備({
        更新が投げる例外: new PantryRuleViolation('update.notFound', '在庫品が見つからない'),
      });

      const 応答 = await 経路.request(
        '/stock-items/s-1',
        JSONの要求('PUT', { amount: '1本', expiryDate: null }),
      );

      expect(応答.status).toBe(404);
    });

    it('削除する在庫品が見つからないときは 404 を返す', async () => {
      // 7章の表 / ADR-027: `update.notFound` と同じく 404 である。
      const { 経路 } = 準備({
        削除の応答たち: [
          { 投げる例外: new PantryRuleViolation('delete.notFound', '在庫品が見つからない') },
        ],
      });

      const 応答 = await 経路.request('/stock-items/s-1', {
        method: 'DELETE',
        headers: 認証ヘッダ(),
      });

      expect(応答.status).toBe(404);
    });

    it('世帯の食い違いで保存を拒まれたときは 500 を返す', async () => {
      // 7章の表: 呼び出し側の誤りであり、要求を直しても通らないので 4xx にしない。
      const { 経路 } = 準備({
        登録が投げる例外: new PantryRuleViolation('save.householdMismatch', '世帯が食い違う'),
      });

      const 応答 = await 経路.request('/stock-items', JSONの要求('POST', { name: 'にんじん' }));

      expect(応答.status).toBe(500);
      // 本体まで見る。状態コードだけだと、**写像が無くても**（例外が素通りして
      // 既定の 500 になるだけで）緑になってしまい、この行が何も守らない。
      await expect(失敗の本体(応答)).resolves.toEqual({ rule: 'save.householdMismatch' });
    });

    it('表に無い規則違反は 400 を返す', async () => {
      // 7章の表の最後の行: 規則違反は入力の誤りが既定である（列挙漏れを 200 に化けさせない）。
      const { 経路 } = 準備({
        登録が投げる例外: new PantryRuleViolation('stockItem.unknownRule', '表に無い規則違反'),
      });

      const 応答 = await 経路.request('/stock-items', JSONの要求('POST', { name: 'にんじん' }));

      expect(応答.status).toBe(400);
      await expect(失敗の本体(応答)).resolves.toEqual({ rule: 'stockItem.unknownRule' });
    });
  });

  describe('認証の規則違反の写像', () => {
    it('アクセストークンが提示されていないときは 401 を返す', async () => {
      // 7章の表 / NFR-09: 認証を通っていない。
      const { 経路 } = 準備({
        世帯の特定が投げる例外: new IdentityRuleViolation(
          'accessToken.missing',
          'アクセストークンが提示されていない',
        ),
      });

      const 応答 = await 経路.request('/stock-items', { headers: 認証ヘッダ() });

      expect(応答.status).toBe(401);
    });

    it('アクセストークンが検証を通らないときは 401 を返す', async () => {
      // 7章の表 / NFR-09: 期限切れもこの `rule` に畳まれている。
      const { 経路 } = 準備({
        世帯の特定が投げる例外: new IdentityRuleViolation(
          'accessToken.invalid',
          'アクセストークンが検証を通らない',
        ),
      });

      const 応答 = await 経路.request('/stock-items', { headers: 認証ヘッダ() });

      expect(応答.status).toBe(401);
    });

    it('表に無い認証の規則違反も 401 を返す', async () => {
      // 7章の表の最後の行: 列挙漏れを 200 や 500 に化けさせない。
      const { 経路 } = 準備({
        世帯の特定が投げる例外: new IdentityRuleViolation(
          'accessToken.unknownRule',
          '表に無い規則違反',
        ),
      });

      const 応答 = await 経路.request('/stock-items', { headers: 認証ヘッダ() });

      expect(応答.status).toBe(401);
    });

    it('認証の失敗でない失敗は 401 に化けない', async () => {
      // ADR-032 の決定2: 401 に写すのは `IdentityRuleViolation` だけである。
      // 設定の誤りを 401 に写すと、直す先を利用者に探させることになる。
      const { 経路 } = 準備({ 世帯の特定が投げる例外: new Error('鍵の設定が無い') });

      const 応答 = await 経路.request('/stock-items', { headers: 認証ヘッダ() });

      expect(応答.status).toBe(500);
      await expect(失敗の本体(応答)).resolves.toEqual({ rule: 'unexpected' });
    });
  });

  describe('api が自分で断るもの', () => {
    it('登録の本体が JSON として読めないときは 400 を返す', async () => {
      // 7章: `request.notJson`。ドメインの `rule` と衝突させないため `request.` で始める。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items', 生の本体の要求('POST', '{ not json'));

      expect(応答.status).toBe(400);
      await expect(失敗の本体(応答)).resolves.toEqual({ rule: 'request.notJson' });
    });

    it('更新の本体が JSON として読めないときは 400 を返す', async () => {
      // 7章: 登録と同じ扱いを更新でも守る。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items/s-1', 生の本体の要求('PUT', '{ not json'));

      expect(応答.status).toBe(400);
    });

    it('登録の本体がオブジェクトでないときは 400 を返す', async () => {
      // 規則8 / 7章: `request.invalidBody`。オブジェクトであることは形の検査である。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items', 生の本体の要求('POST', '"にんじん"'));

      expect(応答.status).toBe(400);
      await expect(失敗の本体(応答)).resolves.toEqual({ rule: 'request.invalidBody' });
    });

    it('登録の本体が JSON の null のときは 400 を返す', async () => {
      // 規則8: `null` は JSON として読めるが形が合わない。**500 にしない** —
      // 項目を読もうとして落ちるのではなく、形の検査で断る。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items', 生の本体の要求('POST', 'null'));

      expect(応答.status).toBe(400);
      await expect(失敗の本体(応答)).resolves.toEqual({ rule: 'request.invalidBody' });
    });

    it('登録の本体に name が無いときは 400 を返す', async () => {
      // 規則8 / `RegisterStockItemInput`: `name` は文字列で必ず要る。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items', JSONの要求('POST', { amount: '2本' }));

      expect(応答.status).toBe(400);
    });

    it('登録の name が文字列でないときは 400 を返す', async () => {
      // 規則8: 見るのは**型の形だけ**である（空かどうかはドメインが見る＝規則7）。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items', JSONの要求('POST', { name: 123 }));

      expect(応答.status).toBe(400);
    });

    it('登録の ingredientId が文字列でも null でもないときは 400 を返す', async () => {
      // 規則8: `ingredientId` は文字列・`null`・省略のいずれかである。
      const { 経路 } = 準備();

      const 応答 = await 経路.request(
        '/stock-items',
        JSONの要求('POST', { name: 'にんじん', ingredientId: 1 }),
      );

      expect(応答.status).toBe(400);
    });

    it('更新の本体から amount が省略されていたら 400 を返す', async () => {
      // 規則9 / `UpdateStockItemInput`: 更新は常に置き換えであり、省略を許さない。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items/s-1', JSONの要求('PUT', { expiryDate: null }));

      expect(応答.status).toBe(400);
    });

    it('更新の本体から expiryDate が省略されていたら 400 を返す', async () => {
      // 規則9 / FR-13: `null` が「消す」を表すので、省略と `null` は同義にならない。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items/s-1', JSONの要求('PUT', { amount: '1本' }));

      expect(応答.status).toBe(400);
    });

    it('更新の amount が文字列でも null でもないときは 400 を返す', async () => {
      // 規則9 / ADR-010: 分量は自由文字列である。数値を文字列に直して通さない。
      const { 経路 } = 準備();

      const 応答 = await 経路.request(
        '/stock-items/s-1',
        JSONの要求('PUT', { amount: 1, expiryDate: null }),
      );

      expect(応答.status).toBe(400);
    });

    it('更新の本体が JSON の null のときは 400 を返す', async () => {
      // 規則9: 登録と同じく、形の検査で断る。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items/s-1', 生の本体の要求('PUT', 'null'));

      expect(応答.status).toBe(400);
    });

    it('知らない項目が更新の本体にあっても断らずに更新する', async () => {
      // 規則10: 断ると版の前後で更新が止まる。利用者に見える違いも無い。
      const { 経路 } = 準備();

      const 応答 = await 経路.request(
        '/stock-items/s-1',
        JSONの要求('PUT', { amount: '1本', expiryDate: null, memo: '半分' }),
      );

      expect(応答.status).toBe(200);
    });

    it('規則違反でない失敗は 500 を返す', async () => {
      // 7章: DB 障害や設定の誤りは利用者の入力の誤りではない。
      const { 経路 } = 準備({ 一覧が投げる例外: new Error('接続に失敗') });

      const 応答 = await 経路.request('/stock-items', { headers: 認証ヘッダ() });

      expect(応答.status).toBe(500);
      await expect(失敗の本体(応答)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('規則違反に似せた別の例外を規則違反として扱わない', async () => {
      // ADR-032 の決定2 / 結果2: 見分けるのは `name` である。`rule` を持っていても
      // `name` が違えば写さない — 404 に化けさせない。
      const { 経路 } = 準備({
        更新が投げる例外: 規則違反に似せた例外('update.notFound', '在庫品が見つからない'),
      });

      const 応答 = await 経路.request(
        '/stock-items/s-1',
        JSONの要求('PUT', { amount: '1本', expiryDate: null }),
      );

      expect(応答.status).toBe(500);
      await expect(失敗の本体(応答)).resolves.toEqual({ rule: 'unexpected' });
    });
  });

  describe('検査の順序', () => {
    it('認証を通らない登録は、本体が JSON として読めなくても 401 を返す', async () => {
      // 規則5 / NFR-09: 世帯を定めるのが常に先。認証を通らない呼び出しに検証結果を返さない。
      const { 経路 } = 準備({
        世帯の特定が投げる例外: new IdentityRuleViolation(
          'accessToken.invalid',
          'アクセストークンが検証を通らない',
        ),
      });

      const 応答 = await 経路.request('/stock-items', 生の本体の要求('POST', '{ not json'));

      expect(応答.status).toBe(401);
    });

    it('認証を通らない更新は、本体の形が DTO と合わなくても 401 を返す', async () => {
      // 規則5: 本体の形の検査も、世帯が定まってから見る。
      const { 経路 } = 準備({
        世帯の特定が投げる例外: new IdentityRuleViolation(
          'accessToken.invalid',
          'アクセストークンが検証を通らない',
        ),
      });

      const 応答 = await 経路.request('/stock-items/s-1', JSONの要求('PUT', {}));

      expect(応答.status).toBe(401);
    });

    it('認証を通らない削除はユースケースに到達しない', async () => {
      // 規則5 / NFR-09: **呼ばれないこと自体が要件**である（`docs/testing.md` 2章の例外）。
      // 記憶上の実装に持たせた回数を状態として見る。
      const { 経路, 削除 } = 準備({
        世帯の特定が投げる例外: new IdentityRuleViolation(
          'accessToken.missing',
          'アクセストークンが提示されていない',
        ),
      });

      const 応答 = await 経路.request('/stock-items/s-1', {
        method: 'DELETE',
        headers: 認証ヘッダ(),
      });

      expect(応答.status).toBe(401);
      expect(削除.呼ばれた回数).toBe(0);
    });
  });

  describe('認証ヘッダの入口', () => {
    it('Authorization ヘッダが無い一覧の要求は 401 を返す', async () => {
      // 規則3 / NFR-09: api は独自に断らず空文字を渡し、断るのは世帯を定める側である。
      // 外から見えるのは 401 という応答だけである。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items');

      expect(応答.status).toBe(401);
      await expect(失敗の本体(応答)).resolves.toEqual({ rule: 'accessToken.missing' });
    });

    it('方式が Bearer でない要求は 401 を返す', async () => {
      // 規則3: 方式が違えば空文字を渡す。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items', { headers: 認証ヘッダ('Basic YWJj') });

      expect(応答.status).toBe(401);
    });

    it('方式名だけで値の無いヘッダの要求は 401 を返す', async () => {
      // 規則3: 値が無ければ空文字を渡す。
      const { 経路 } = 準備();

      const 応答 = await 経路.request('/stock-items', { headers: 認証ヘッダ('Bearer') });

      expect(応答.status).toBe(401);
    });
  });

  describe('応答本体に載せないもの', () => {
    it('失敗の応答本体は rule だけを持つ', async () => {
      // 規則14 / ADR-032 の決定3: 文言は載せない — 画面が `rule` から選ぶ。
      const { 経路 } = 準備({
        登録が投げる例外: new PantryRuleViolation('name.empty', '名称が空である'),
      });

      const 応答 = await 経路.request('/stock-items', JSONの要求('POST', { name: '' }));

      const 本体 = (await 失敗の本体(応答)) as Record<string, unknown>;
      expect(Object.keys(本体)).toEqual(['rule']);
    });

    it('500 の応答本体に例外の message を載せない', async () => {
      // 規則14 / 7章: `message` は開発者向けであり、接続先が応答に出てはならない。
      const { 経路 } = 準備({
        一覧が投げる例外: new Error('postgres://user:pw@host に繋がらない'),
      });

      const 応答 = await 経路.request('/stock-items', { headers: 認証ヘッダ() });

      const テキスト = await 応答.text();
      expect(読める本体(テキスト)).toEqual({ rule: 'unexpected' });
      expect(テキスト).not.toContain('postgres');
    });

    it('見つからない更新の応答本体に指した識別子を載せない', async () => {
      // 規則14: 識別子を載せない。`message` に入っていても応答には出さない。
      const { 経路 } = 準備({
        更新が投げる例外: new PantryRuleViolation('update.notFound', 's-1 の在庫品が見つからない'),
      });

      const 応答 = await 経路.request(
        '/stock-items/s-1',
        JSONの要求('PUT', { amount: '1本', expiryDate: null }),
      );

      const テキスト = await 応答.text();
      expect(読める本体(テキスト)).toEqual({ rule: 'update.notFound' });
      expect(テキスト).not.toContain('s-1');
    });

    it('認証の失敗の応答本体に世帯を載せない', async () => {
      // 規則14 / C-9 / NFR-09: 世帯は応答に出さない。
      const { 経路 } = 準備({
        世帯の特定が投げる例外: new IdentityRuleViolation(
          'accessToken.invalid',
          'アクセストークンが検証を通らない',
        ),
      });

      const 応答 = await 経路.request('/stock-items', { headers: 認証ヘッダ() });

      // 状態コードも見る。「無いこと」だけを見る検証は、写像が無くても緑になる。
      expect(応答.status).toBe(401);
      const 本体 = (await 失敗の本体(応答)) as Record<string, unknown>;
      expect(Object.keys(本体)).not.toContain('householdId');
    });
  });

  describe('削除の冪等性', () => {
    it('同じ在庫品を2度削除すると2度目は 404 になる', async () => {
      // 規則13 / ADR-027: 削除は冪等でない。2度目は見つからない。
      const { 経路 } = 準備({
        削除の応答たち: [
          { 成功: true },
          { 投げる例外: new PantryRuleViolation('delete.notFound', '在庫品が見つからない') },
        ],
      });

      const 一度目 = await 経路.request('/stock-items/s-1', {
        method: 'DELETE',
        headers: 認証ヘッダ(),
      });
      const 二度目 = await 経路.request('/stock-items/s-1', {
        method: 'DELETE',
        headers: 認証ヘッダ(),
      });

      expect([一度目.status, 二度目.status]).toEqual([204, 404]);
      await expect(失敗の本体(二度目)).resolves.toEqual({ rule: 'delete.notFound' });
    });
  });
});
