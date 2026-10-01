import type {
  ListStockItemsOutput,
  StockItemDto,
  SuggestMealsOutput,
} from '@fridge-to-meal/contract';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import type { Bindings } from '../../src/main.js';
import { composeDependencies, createApp } from '../../src/main.js';
import type { HouseholdId } from '../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../src/shared/domain/HouseholdId.js';
import { countUser, insertUser } from '../support/db/AuthUsers.js';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';
import type { HouseholdRowCounts } from '../support/db/HouseholdRows.js';
import { countHouseholdRows } from '../support/db/HouseholdRows.js';
import { withTransaction } from '../support/db/WithTransaction.js';
import { accessTokenOf } from '../support/identity/AccessSigning.js';
import { FixedFetchJwks } from '../support/identity/FixedFetchJwks.js';

/**
 * composition root（`main.ts`）の3周目 — ローカル Postgres を通す全経路
 * （B-09 設計書 規則2・7・8・10 / C-9 / NFR-09 / ADR-029 決定3(a) / ADR-042 決定2・3）。
 * **`pnpm test:db` でだけ走る** — `pnpm test` は `apps/api/test/db/**` を除外する。
 *
 * 差し替えるのは JWKS を取りに行く口だけ（設計書 8章）。`HYPERDRIVE.connectionString` には
 * ローカル Postgres の **`authenticator`** を渡す — 所有者（`postgres`）を渡すと行レベル
 * セキュリティが素通りし、世帯の分離（C-9）が無くても緑になる（先行 `stockItemRepository.test.ts`）。
 *
 * **世帯 ID はケースごとに固有の固定値を使い、使い回さない。** 表は `globalSetup` で1度だけ作られ、
 * ファイルとケースをまたいで共有されるため。**後片付けはしない。** 在庫品の識別子は結線側が発行する
 * （規則10）ので、**登録の応答から読む**。「〜の続き」は同じ `it` の中で順に叩き、ケースをまたいで
 * 状態を持たない。
 */
const supabaseUrl = 'https://ninshou.example';
const issuer = 'https://ninshou.example/auth/v1';
const audience = 'authenticated';

const registerHousehold = householdIdOf('b9010000-0000-4000-8000-000000000001');
const twoItemsHousehold = householdIdOf('b9010000-0000-4000-8000-000000000002');
const updateHousehold = householdIdOf('b9010000-0000-4000-8000-000000000003');
const deleteHousehold = householdIdOf('b9010000-0000-4000-8000-000000000004');
const ownerOfListedHousehold = householdIdOf('b9010000-0000-4000-8000-000000000005');
const emptyNeighborHousehold = householdIdOf('b9010000-0000-4000-8000-000000000015');
const ownerOfUpdatedHousehold = householdIdOf('b9010000-0000-4000-8000-000000000006');
const updatingNeighborHousehold = householdIdOf('b9010000-0000-4000-8000-000000000016');
const ownerOfDeletedHousehold = householdIdOf('b9010000-0000-4000-8000-000000000007');
const deletingNeighborHousehold = householdIdOf('b9010000-0000-4000-8000-000000000017');
const rejectedThenRegisterHousehold = householdIdOf('b9010000-0000-4000-8000-000000000008');
const unsavedIdHousehold = householdIdOf('b9010000-0000-4000-8000-000000000009');

// B-56a: 世帯のデータを消す。先頭の並び（`b56a1000`）で他のケースと分けてある。
const deletedDataHousehold = householdIdOf('b56a1000-0001-4000-8000-000000000001');
const fullyDeletedHousehold = householdIdOf('b56a1000-0002-4000-8000-000000000002');
const deletingOwnDataHousehold = householdIdOf('b56a1000-0003-4000-8000-000000000003');
const untouchedNeighborHousehold = householdIdOf('b56a1000-0003-4000-8000-000000000013');
const listAfterDeletionHousehold = householdIdOf('b56a1000-0004-4000-8000-000000000004');
const registerAfterDeletionHousehold = householdIdOf('b56a1000-0005-4000-8000-000000000005');
const neverUsedHousehold = householdIdOf('b56a1000-0006-4000-8000-000000000006');
const deletedTwiceHousehold = householdIdOf('b56a1000-0007-4000-8000-000000000007');

// B-56d: データのあとに利用者も消す。先頭の並び（`b56d3000`）で他のケースと分けてある。
const deletedUserHousehold = householdIdOf('b56d3000-0001-4000-8000-000000000001');
const deletingOwnUserHousehold = householdIdOf('b56d3000-0002-4000-8000-000000000002');
const untouchedUserHousehold = householdIdOf('b56d3000-0002-4000-8000-000000000012');

/** どの世帯も保存していない在庫品の識別子（#15）。 */
const unsavedStockItemId = 'b9990000-0000-4000-8000-0000000000ff';

/**
 * 本物の依存で組んだ環境。接続文字列は要求のたびにここから読まれ、クライアントは要求ごとに
 * 作って閉じられる（規則8）— テスト側で接続を開いたり閉じたりしない。
 */
const env: Bindings = {
  HYPERDRIVE: { connectionString: APP_CONNECTION_STRING },
  SUPABASE_URL: supabaseUrl,
};

/** 全ケースが同じ組み立てを叩く（設計書 8章）。認証器は環境1つにつき1つ（規則4）。 */
const app = createApp(composeDependencies(env, { fetchJwks: new FixedFetchJwks().fetchJwks }));

/**
 * 行数を読むための接続（B-56a）。経路の結線とは別に持ち、`authenticator` で繋いで
 * トランザクションの中でクレームを張る — 所有者で繋ぐと RLS が素通りする。
 */
const rowConnection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await rowConnection.end();
});

/** 実時刻からの固定オフセットで秒を置く。`exp` の本題は前後関係だけである。 */
function secondsFromNow(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

/** 与えた世帯として通るアクセストークン。署名・`kid`・`iss`・`aud`・期限のどれも通る。 */
function accessTokenFor(household: HouseholdId): Promise<string> {
  return accessTokenOf({ sub: household, exp: secondsFromNow(3600), iss: issuer, aud: audience });
}

/** 認証ヘッダ1つ。値は ASCII に限る（`Headers` は非 ASCII を受け付けない）。 */
function bearerHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** 本体を JSON で送る要求。 */
function jsonRequest(method: string, body: unknown, headers: Record<string, string>) {
  return {
    method,
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * JSON として読めればその値、**読めなければ読めた文字列そのもの**を返す。構文エラーで
 * 落とすと、`{ rule }` の代わりに何が返ったのかが読めなくなるため。
 */
function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * 失敗の応答本体。`{ rule }` のはずのものを読む。
 *
 * 引数の型を `Response` と書かないのは、**このテストのプロジェクトが実行環境の型を
 * 入れていない**ためである（`apps/api/tsconfig.test.json` の `types` は空）。
 */
async function failureBody(response: { text(): Promise<string> }): Promise<unknown> {
  return parseBody(await response.text());
}

/** 与えた世帯で `POST /stock-items` を叩く。応答はそのまま返す — 状態コードを見るのは呼ぶ側。 */
async function postStockItem(household: HouseholdId, body: unknown) {
  return app.request(
    '/stock-items',
    jsonRequest('POST', body, bearerHeaders(await accessTokenFor(household))),
  );
}

/**
 * 「〜の続き」の下ごしらえ。登録が 201 で通ったことを確かめてから、発行された在庫品を返す。
 * 本題でないところで黙って失敗すると、続きの `expect` が別の理由で落ちて読めなくなるため。
 */
async function registeredStockItem(household: HouseholdId, body: unknown): Promise<StockItemDto> {
  const response = await postStockItem(household, body);
  expect(response.status).toBe(201);
  return (await response.json()) as StockItemDto;
}

/** 与えた世帯で `GET /stock-items` を叩く。 */
async function getStockItems(household: HouseholdId) {
  return app.request('/stock-items', { headers: bearerHeaders(await accessTokenFor(household)) });
}

/** 一覧を 200 で読む。状態コードが本題でないケースの続きで使う。 */
async function listedStockItems(household: HouseholdId): Promise<StockItemDto[]> {
  const response = await getStockItems(household);
  expect(response.status).toBe(200);
  return ((await response.json()) as ListStockItemsOutput).stockItems;
}

/** 与えた世帯で `PUT /stock-items/:id` を叩く。 */
async function putStockItem(household: HouseholdId, stockItemId: string, body: unknown) {
  return app.request(
    `/stock-items/${stockItemId}`,
    jsonRequest('PUT', body, bearerHeaders(await accessTokenFor(household))),
  );
}

/** 与えた世帯で `DELETE /stock-items/:id` を叩く。 */
async function deleteStockItemRequest(household: HouseholdId, stockItemId: string) {
  return app.request(`/stock-items/${stockItemId}`, {
    method: 'DELETE',
    headers: bearerHeaders(await accessTokenFor(household)),
  });
}

/** 与えた世帯で `DELETE /household-data` を叩く（B-56a）。 */
async function deleteHouseholdDataRequest(household: HouseholdId) {
  return app.request('/household-data', {
    method: 'DELETE',
    headers: bearerHeaders(await accessTokenFor(household)),
  });
}

/**
 * 世帯の利用者と9表すべての行を置く下ごしらえ（B-56a / B-56d）。利用者は `auth.users` に
 * 役を切り替える前の `authenticator` で置く（B-56d 設計書 規則11）。行は**既存の経路だけを通す** — 在庫品2件
 * （`にんじん` / `たまねぎ`）を登録し、新しい献立を求め（仮の生成器が在庫品1件につき献立1件、
 * 材料1件・手順2件を返す。ADR-060）、1件目の献立に調理記録を1件足す。本題でないところで
 * 黙って失敗すると続きの `expect` が別の理由で落ちるので、各段の状態コードを確かめる。
 */
async function seedHouseholdData(household: HouseholdId): Promise<void> {
  await insertUser(rowConnection, household);
  await registeredStockItem(household, { name: 'にんじん' });
  await registeredStockItem(household, { name: 'たまねぎ' });

  const suggestResponse = await app.request('/suggestions/new-meals', {
    method: 'POST',
    headers: bearerHeaders(await accessTokenFor(household)),
  });
  expect(suggestResponse.status).toBe(200);
  const outcome = (await suggestResponse.json()) as SuggestMealsOutput;
  if (outcome.outcome !== 'suggested') throw new Error(`提案が得られなかった: ${outcome.outcome}`);
  const firstMealId = outcome.suggestion.entries[0]?.mealId;
  if (firstMealId === undefined) throw new Error('提案に献立が1件も無い');

  const recordResponse = await app.request(`/meals/${firstMealId}/cooking-records`, {
    method: 'POST',
    headers: bearerHeaders(await accessTokenFor(household)),
  });
  expect(recordResponse.status).toBe(204);
}

/** その世帯の9表の行数を、クレームを張った別のトランザクションで読む。 */
function rowCountsOf(household: HouseholdId): Promise<HouseholdRowCounts> {
  return withTransaction(rowConnection, household, (tx) => countHouseholdRows(tx, household));
}

/** 9表とも0行。 */
const noRows: HouseholdRowCounts = {
  stock_items: 0,
  stock_item_names: 0,
  meals: 0,
  meal_ingredients: 0,
  cooking_steps: 0,
  cooking_records: 0,
  suggestions: 0,
  suggestion_entries: 0,
  pantry_snapshot_stock_items: 0,
};

/**
 * `seedHouseholdData` が置く行数。在庫品2件と名称2件、献立2件（材料各1件・手順各2件）、
 * 調理記録1件、提案1件（1件が2つ・在庫スナップショットの在庫品2件）。
 */
const seededRows: HouseholdRowCounts = {
  stock_items: 2,
  stock_item_names: 2,
  meals: 2,
  meal_ingredients: 2,
  cooking_steps: 4,
  cooking_records: 1,
  suggestions: 1,
  suggestion_entries: 2,
  pantry_snapshot_stock_items: 2,
};

describe('composition root main（ローカル Postgres を通す全経路）', () => {
  describe('在庫の4経路が DB まで通る', () => {
    it('結線した経路で在庫品を登録できる', async () => {
      // 規則2・7・10 / FR-01: 接頭辞なしの経路 → 1要求1トランザクション → 結線側が発行した id で行が入る。
      const response = await postStockItem(registerHousehold, {
        name: 'にんじん',
        amount: '2本',
        expiryDate: '2026-10-01',
      });

      expect(response.status).toBe(201);
      const registered = (await response.json()) as StockItemDto;
      expect(typeof registered.id).toBe('string');
      expect(registered).toMatchObject({
        name: 'にんじん',
        ingredientId: null,
        amount: '2本',
        expiryDate: '2026-10-01',
      });
    });

    it('登録した在庫品が同じ世帯の一覧に出る', async () => {
      // 規則7 / FR-04: 登録のトランザクションが確定し、次の要求の別のトランザクションから読める。
      const registered = await registeredStockItem(registerHousehold, { name: 'にんじん' });

      const response = await getStockItems(registerHousehold);

      expect(response.status).toBe(200);
      const { stockItems } = (await response.json()) as ListStockItemsOutput;
      const listed = stockItems.filter((stockItem) => stockItem.id === registered.id);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.name).toBe('にんじん');
    });

    it('同じ世帯で2件登録すると別々の id で一覧に2件出る', async () => {
      // 規則10 / ADR-026: 識別子は要求ごとに発行され、衝突しない。
      const first = await registeredStockItem(twoItemsHousehold, { name: 'にんじん' });
      const second = await registeredStockItem(twoItemsHousehold, { name: 'たまねぎ' });

      const stockItems = await listedStockItems(twoItemsHousehold);

      expect(first.id).not.toBe(second.id);
      expect(stockItems).toHaveLength(2);
      expect(new Set(stockItems.map((stockItem) => stockItem.id))).toEqual(
        new Set([first.id, second.id]),
      );
    });

    it('結線した経路で在庫品の分量と期限を更新できる', async () => {
      // 規則2・7 / FR-05。
      const registered = await registeredStockItem(updateHousehold, {
        name: 'にんじん',
        amount: '2本',
        expiryDate: '2026-10-01',
      });

      const response = await putStockItem(updateHousehold, registered.id, {
        amount: '1本',
        expiryDate: '2026-10-02',
      });

      expect(response.status).toBe(200);
      const updated = (await response.json()) as StockItemDto;
      expect(updated.amount).toBe('1本');
      expect(updated.expiryDate).toBe('2026-10-02');
    });

    it('更新した値が次の一覧に見える', async () => {
      // 規則7・8: 更新のトランザクションが確定し、要求ごとに作り直したクライアントから読める。
      const registered = await registeredStockItem(updateHousehold, {
        name: 'たまねぎ',
        amount: '2本',
        expiryDate: '2026-10-01',
      });
      const updateResponse = await putStockItem(updateHousehold, registered.id, {
        amount: '1本',
        expiryDate: '2026-10-02',
      });
      expect(updateResponse.status).toBe(200);

      const stockItems = await listedStockItems(updateHousehold);

      const listed = stockItems.find((stockItem) => stockItem.id === registered.id);
      expect(listed).toMatchObject({ amount: '1本', expiryDate: '2026-10-02' });
    });

    it('結線した経路で在庫品を削除できる', async () => {
      // 規則2・7 / FR-06: 204 は本体を持たない。
      const registered = await registeredStockItem(deleteHousehold, { name: 'にんじん' });

      const response = await deleteStockItemRequest(deleteHousehold, registered.id);

      expect(response.status).toBe(204);
      await expect(response.text()).resolves.toBe('');
    });

    it('削除した在庫品は次の一覧に出ない', async () => {
      // 規則7 / FR-06。
      const registered = await registeredStockItem(deleteHousehold, { name: 'たまねぎ' });
      const deleteResponse = await deleteStockItemRequest(deleteHousehold, registered.id);
      expect(deleteResponse.status).toBe(204);

      const stockItems = await listedStockItems(deleteHousehold);

      expect(stockItems.filter((stockItem) => stockItem.id === registered.id)).toEqual([]);
    });
  });

  describe('世帯の分離は結線後も保たれる', () => {
    it('世帯 A で登録した在庫品は世帯 B のトークンの一覧に出ない', async () => {
      // C-9 / NFR-09 / ADR-029 決定3(a): クレームはアクセストークンの世帯で張られ、他世帯の行は見えない。
      const registered = await registeredStockItem(ownerOfListedHousehold, { name: 'にんじん' });

      const neighborResponse = await getStockItems(emptyNeighborHousehold);

      expect(neighborResponse.status).toBe(200);
      await expect(neighborResponse.json()).resolves.toEqual({ stockItems: [] });
      // 裏取り: 持ち主の一覧には出る — 出なければ「誰にも見えない」で緑になっている。
      const ownerStockItems = await listedStockItems(ownerOfListedHousehold);
      expect(ownerStockItems.map((stockItem) => stockItem.id)).toContain(registered.id);
    });

    it('他世帯の在庫品を指した更新は 404 update.notFound になる', async () => {
      // C-9 / ADR-032 決定3: 他世帯の在庫品は「無い」ものとして写す。存在を教えない。
      const registered = await registeredStockItem(ownerOfUpdatedHousehold, {
        name: 'にんじん',
        amount: '2本',
      });

      const response = await putStockItem(updatingNeighborHousehold, registered.id, {
        amount: '9本',
        expiryDate: null,
      });

      expect(response.status).toBe(404);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'update.notFound' });
    });

    it('他世帯から更新を試みても持ち主の在庫品は変わらない', async () => {
      // C-9 / NFR-09: 断られただけでなく、行も書き換わっていないこと。
      const registered = await registeredStockItem(ownerOfUpdatedHousehold, {
        name: 'たまねぎ',
        amount: '2本',
      });
      const neighborResponse = await putStockItem(updatingNeighborHousehold, registered.id, {
        amount: '9本',
        expiryDate: null,
      });
      expect(neighborResponse.status).toBe(404);

      const stockItems = await listedStockItems(ownerOfUpdatedHousehold);

      const listed = stockItems.find((stockItem) => stockItem.id === registered.id);
      expect(listed?.amount).toBe('2本');
    });

    it('他世帯の在庫品を指した削除は 404 delete.notFound になる', async () => {
      // C-9 / ADR-027。
      const registered = await registeredStockItem(ownerOfDeletedHousehold, { name: 'にんじん' });

      const response = await deleteStockItemRequest(deletingNeighborHousehold, registered.id);

      expect(response.status).toBe(404);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'delete.notFound' });
    });

    it('他世帯から削除を試みても持ち主の一覧に残る', async () => {
      // C-9 / NFR-09。
      const registered = await registeredStockItem(ownerOfDeletedHousehold, { name: 'たまねぎ' });
      const neighborResponse = await deleteStockItemRequest(
        deletingNeighborHousehold,
        registered.id,
      );
      expect(neighborResponse.status).toBe(404);

      const stockItems = await listedStockItems(ownerOfDeletedHousehold);

      expect(stockItems.map((stockItem) => stockItem.id)).toContain(registered.id);
    });
  });

  describe('規則違反の写像は結線後も変わらない', () => {
    it('名称が空の登録は結線後も 400 name.empty になる', async () => {
      // ADR-032 決定3 / `StockItem` の不変条件: 空白だけの名称はドメインが断り、api が 400 に写す。
      const response = await postStockItem(rejectedThenRegisterHousehold, { name: '   ' });

      expect(response.status).toBe(400);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'name.empty' });
    });

    it('規則違反で断られた要求のあとも、同じ組み立てで次の登録が通る', async () => {
      // 規則8: 失敗した要求でもクライアントは閉じられ（`finally`）、次の要求は新しい接続で通る。
      const rejectedResponse = await postStockItem(rejectedThenRegisterHousehold, { name: '   ' });
      expect(rejectedResponse.status).toBe(400);

      const response = await postStockItem(rejectedThenRegisterHousehold, { name: 'にんじん' });

      expect(response.status).toBe(201);
      const stockItems = await listedStockItems(rejectedThenRegisterHousehold);
      expect(stockItems).toHaveLength(1);
    });

    it('存在しない id の更新は自世帯でも 404 update.notFound になる', async () => {
      // B-06 規則8: 他世帯のものと区別せず、同じ「無い」として写す。
      const response = await putStockItem(unsavedIdHousehold, unsavedStockItemId, {
        amount: '1本',
        expiryDate: null,
      });

      expect(response.status).toBe(404);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'update.notFound' });
    });
  });

  describe('世帯のデータを消す経路が DB まで通る（B-56a）', () => {
    it('結線した経路で世帯のデータを消すと 204 が返る', async () => {
      // 規則10・13 / FR-27: 接頭辞なしの DELETE → 1要求1トランザクション → 本体なし。
      await seedHouseholdData(deletedDataHousehold);

      const response = await deleteHouseholdDataRequest(deletedDataHousehold);

      expect(response.status).toBe(204);
    });

    it('世帯のデータを消すと、その世帯の行は9表のどれにも残らない', async () => {
      // 規則2・5・13 / NFR-13: 在庫・保存したことのある名称・献立と子3表・提案と子2表。
      await seedHouseholdData(fullyDeletedHousehold);
      const response = await deleteHouseholdDataRequest(fullyDeletedHousehold);
      expect(response.status).toBe(204);

      await expect(rowCountsOf(fullyDeletedHousehold)).resolves.toEqual(noRows);
    });

    it('他世帯が自分の世帯のデータを消しても、こちらの世帯の行は9表とも1行も消えない', async () => {
      // 規則3・4 / C-9 / NFR-09: 消すのはアクセストークンの世帯の行だけである。
      await seedHouseholdData(untouchedNeighborHousehold);
      await seedHouseholdData(deletingOwnDataHousehold);
      const response = await deleteHouseholdDataRequest(deletingOwnDataHousehold);
      expect(response.status).toBe(204);

      await expect(rowCountsOf(untouchedNeighborHousehold)).resolves.toEqual(seededRows);
    });

    it('世帯のデータを消したあとも、同じアクセストークンで在庫の一覧が 200 の空で返る', async () => {
      // 利用者を消しても、トークンは期限まで通る（ADR-071 結果2。api では断らない）。
      await seedHouseholdData(listAfterDeletionHousehold);
      const deleteResponse = await deleteHouseholdDataRequest(listAfterDeletionHousehold);
      expect(deleteResponse.status).toBe(204);

      const response = await getStockItems(listAfterDeletionHousehold);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ stockItems: [] });
    });

    it('世帯のデータを消したあと、同じアクセストークンで登録した在庫品は一覧に出る', async () => {
      // 利用者を消しても、トークンは期限まで通る（ADR-071 結果2。api では断らない）。
      await seedHouseholdData(registerAfterDeletionHousehold);
      const deleteResponse = await deleteHouseholdDataRequest(registerAfterDeletionHousehold);
      expect(deleteResponse.status).toBe(204);
      const registered = await registeredStockItem(registerAfterDeletionHousehold, {
        name: 'ごぼう',
      });

      const stockItems = await listedStockItems(registerAfterDeletionHousehold);

      expect(stockItems.map((stockItem) => stockItem.id)).toEqual([registered.id]);
    });

    it('行が1行も無い世帯のデータを消しても 204 が返る', async () => {
      // 規則7 / 7章4行目: 消す物が無いのは失敗ではない。
      const response = await deleteHouseholdDataRequest(neverUsedHousehold);

      expect(response.status).toBe(204);
    });

    it('同じ世帯のデータを続けて2度消しても、2度目も 204 が返る', async () => {
      // 規則7: 2度目の呼び出しも同じ結末。
      // 規則7（B-56d）: 1度目で利用者が消えていても、2度目は断らない。
      await seedHouseholdData(deletedTwiceHousehold);
      const firstResponse = await deleteHouseholdDataRequest(deletedTwiceHousehold);
      expect(firstResponse.status).toBe(204);

      const response = await deleteHouseholdDataRequest(deletedTwiceHousehold);

      expect(response.status).toBe(204);
    });
  });

  describe('世帯のデータを消す経路は利用者も消す（B-56d）', () => {
    it('世帯のデータを消すと、その世帯の利用者も auth.users から消える', async () => {
      // B-56d 設計書 規則5・10 / FR-27 / ADR-071 決定2: 同じ要求・同じトランザクションで利用者まで消す。
      await seedHouseholdData(deletedUserHousehold);

      const response = await deleteHouseholdDataRequest(deletedUserHousehold);

      expect(response.status).toBe(204);
      await expect(countUser(rowConnection, deletedUserHousehold)).resolves.toBe(0);
    });

    it('他世帯が自分の世帯のデータを消しても、こちらの利用者は auth.users に残る', async () => {
      // B-56d 設計書 規則8 / C-9 / NFR-09: 誰を消すかはアクセストークンの世帯のクレームが決める。
      await seedHouseholdData(untouchedUserHousehold);
      await seedHouseholdData(deletingOwnUserHousehold);
      const response = await deleteHouseholdDataRequest(deletingOwnUserHousehold);
      expect(response.status).toBe(204);

      await expect(countUser(rowConnection, untouchedUserHousehold)).resolves.toBe(1);
    });
  });
});
