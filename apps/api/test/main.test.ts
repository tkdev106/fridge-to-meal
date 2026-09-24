import type {
  ListStockItemsOutput,
  StockItemDto,
  SuggestMealsOutput,
} from '@fridge-to-meal/contract';
import { describe, expect, it } from 'vitest';
import type { Bindings } from '../src/main.js';
import { accessTokenVerificationOf, composeDependencies, createApp } from '../src/main.js';
import { householdIdOf } from '../src/shared/domain/HouseholdId.js';
import type { AccessTokenClaims } from './support/identity/AccessSigning.js';
import { accessTokenOf, publicAccessTokenKey } from './support/identity/AccessSigning.js';
import { FixedFetchJwks } from './support/identity/FixedFetchJwks.js';
import { FixedIdentifyHousehold } from './support/identity/FixedIdentifyHousehold.js';
import {
  FixedShowLatestSuggestion,
  FixedSuggestMeals,
  FixedSuggestNewMeals,
} from './support/meal/FixedSuggestMeals.js';
import {
  FixedDeleteStockItem,
  FixedListStockItems,
  FixedRegisterStockItem,
  FixedUpdateStockItem,
} from './support/pantry/FixedStockItemUsecases.js';

/**
 * 環境に置く値はすべて架空である（B-09 設計書 11章）。`SUPABASE_URL` から導いた
 * 3値は `HouseholdAuthenticatorImpl.test.ts` が設定に直接与えていたものと同じ literal になる。
 */
const supabaseUrl = 'https://ninshou.example';
const issuer = 'https://ninshou.example/auth/v1';
const audience = 'authenticated';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('22222222-2222-4222-8222-222222222222');

/**
 * 認証で断られる要求と `/health` だけが使う環境。接続文字列はどこにも繋がらない架空の値で、
 * **認証を通る要求には渡さない** — 通ったあと在庫のユースケースが接続を試みるため
 * （`docs/testing.md` 5章）。
 */
const env: Bindings = {
  HYPERDRIVE: { connectionString: 'postgres://never-connected.invalid/postgres' },
  SUPABASE_URL: supabaseUrl,
};

/**
 * `HYPERDRIVE` の binding を欠いた環境（規則9）。認証を通る要求はこちらで組む —
 * 通ったあとに接続文字列が読めずに 500 になり、ネットワークには出ない。
 */
const envWithoutHyperdrive = { SUPABASE_URL: supabaseUrl } as Bindings;

/** 実時刻からの固定オフセットで秒を置く。`exp` の本題は前後関係だけである。 */
function secondsFromNow(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

/** 署名・`kid`・`iss`・`aud`・期限・`sub` のどれも通る中身。本題のクレームだけを重ねて使う。 */
function validClaims(): AccessTokenClaims {
  return { sub: ourHousehold, exp: secondsFromNow(3600), iss: issuer, aud: audience };
}

/** 在庫品1件の DTO。本題でない項目をここに隠す（`docs/testing.md` 6章）。 */
function stockItemDto(overrides: Partial<StockItemDto> = {}): StockItemDto {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'にんじん',
    ingredientId: null,
    amount: null,
    expiryDate: null,
    ...overrides,
  };
}

/**
 * 既定の提案の入口の代役が返す結末（B-48c）。新しい献立の入口とは**違う結末**にしておく —
 * 経路が2つの入口を取り違えたとき（規則2 / ADR-051 決定2）に本体の違いとして現れるように。
 */
const suggestMealsOutcome: SuggestMealsOutput = { outcome: 'insufficientStockItems' };

/** 新しい献立を求める入口（FR-36）の代役が返す結末。上とは違う値である。 */
const suggestNewMealsOutcome: SuggestMealsOutput = { outcome: 'generationLimitReached' };

/** 組み立てに渡す固定の基準日時（B-48c 規則7）。テストは時計を読まない（`docs/testing.md` 5章）。 */
const fixedNow = '2026-09-23T12:00:00.000Z';

/**
 * 依存をすべて代役にして組んだ app（規則1・2 の確認）。結線の相手を差し替えるのではなく、
 * **経路がどこに置かれるか**だけを見るためのもの（設計書 8章末尾）。
 *
 * 提案の2つの入口の代役は、受け取った世帯と基準日時を観察するテストが外から渡す（B-48c）。
 */
function appWithFixedDependencies(
  overrides: {
    listOutput?: ListStockItemsOutput;
    suggestMeals?: FixedSuggestMeals;
    suggestNewMeals?: FixedSuggestNewMeals;
    showLatestSuggestion?: FixedShowLatestSuggestion;
  } = {},
) {
  const suggestMeals =
    overrides.suggestMeals ?? new FixedSuggestMeals({ returns: suggestMealsOutcome });
  const suggestNewMeals =
    overrides.suggestNewMeals ?? new FixedSuggestNewMeals({ returns: suggestNewMealsOutcome });
  const showLatestSuggestion =
    overrides.showLatestSuggestion ??
    new FixedShowLatestSuggestion({ returns: { outcome: 'none' } });

  return createApp({
    identifyHousehold: new FixedIdentifyHousehold({ returns: ourHousehold }).identify,
    registerStockItem: new FixedRegisterStockItem({ returns: stockItemDto() }).register,
    listStockItems: new FixedListStockItems({
      returns: overrides.listOutput ?? { stockItems: [stockItemDto()] },
    }).list,
    updateStockItem: new FixedUpdateStockItem({ returns: stockItemDto() }).update,
    deleteStockItem: new FixedDeleteStockItem({ succeeds: true }).delete,
    suggestMeals: suggestMeals.suggest,
    suggestNewMeals: suggestNewMeals.suggest,
    showLatestSuggestion: showLatestSuggestion.show,
    now: () => fixedNow,
  });
}

/**
 * 本物の依存で組んだ app。差し替えるのは JWKS を取りに行く口だけ（設計書 8章）。
 * `FixedFetchJwks` は「取りに行かないこと」を状態として観察するために返す（`docs/testing.md` 2章）。
 */
function composedApp(bindings: Bindings, fetchJwks: FixedFetchJwks = new FixedFetchJwks()) {
  const app = createApp(composeDependencies(bindings, { fetchJwks: fetchJwks.fetchJwks }));
  return { app, fetchJwks };
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

describe('composition root main', () => {
  describe('在庫の経路の配置', () => {
    it('登録の経路を接頭辞なしの POST /stock-items に置く', async () => {
      // 規則2 / FR-01 / ADR-003: `createStockItemRoutes` の経路をそのまま根にマウントする。
      const app = appWithFixedDependencies();

      const response = await app.request(
        '/stock-items',
        jsonRequest('POST', { name: 'にんじん' }, bearerHeaders('x')),
      );

      expect(response.status).toBe(201);
    });

    it('一覧の経路を接頭辞なしの GET /stock-items に置く', async () => {
      // 規則2 / FR-04。本体まで見る — 状態コードだけだと別の 200 でも緑になる。
      const app = appWithFixedDependencies({
        listOutput: {
          stockItems: [
            stockItemDto({ id: 's-1', name: 'にんじん', amount: '2本', expiryDate: '2026-10-01' }),
          ],
        },
      });

      const response = await app.request('/stock-items', { headers: bearerHeaders('x') });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
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

    it('更新の経路を接頭辞なしの PUT /stock-items/:id に置く', async () => {
      // 規則2 / FR-05。
      const app = appWithFixedDependencies();

      const response = await app.request(
        '/stock-items/s-1',
        jsonRequest('PUT', { amount: '1本', expiryDate: null }, bearerHeaders('x')),
      );

      expect(response.status).toBe(200);
    });

    it('削除の経路を接頭辞なしの DELETE /stock-items/:id に置く', async () => {
      // 規則2 / FR-06。
      const app = appWithFixedDependencies();

      const response = await app.request('/stock-items/s-1', {
        method: 'DELETE',
        headers: bearerHeaders('x'),
      });

      expect(response.status).toBe(204);
    });
  });

  describe('提案の経路の配置', () => {
    // B-48c。代役の deps で組み、経路がどこに置かれ、どちらの入口に何が届くかだけを見る。
    const webOrigin = 'http://localhost:5173';

    it('既定の提案の経路を接頭辞なしの POST /suggestions に置き、既定の提案の入口の結末を返す', async () => {
      // 規則1・2 / FR-16 / ADR-048 決定4 / ADR-051 決定2: 本体まで見る — 取り違えれば別の結末になる。
      const app = appWithFixedDependencies();

      const response = await app.request('/suggestions', {
        method: 'POST',
        headers: bearerHeaders('x'),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ outcome: 'insufficientStockItems' });
    });

    it('新しい献立を求める経路を接頭辞なしの POST /suggestions/new-meals に置き、新しい献立の入口の結末を返す', async () => {
      // 規則1・2 / FR-36 / ADR-051 決定2: 明示操作の入口は既定の提案の入口を兼ねない。
      const app = appWithFixedDependencies();

      const response = await app.request('/suggestions/new-meals', {
        method: 'POST',
        headers: bearerHeaders('x'),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ outcome: 'generationLimitReached' });
    });

    it('提案の経路には組み立てに渡した now の値が基準日時として届く', async () => {
      // 規則7 / ADR-062 決定1: 基準日時は要求から受け取らず、deps の now() を読む。
      const suggestMeals = new FixedSuggestMeals({ returns: suggestMealsOutcome });
      const app = appWithFixedDependencies({ suggestMeals });

      await app.request('/suggestions', { method: 'POST', headers: bearerHeaders('x') });

      expect(suggestMeals.receivedAsOf).toBe('2026-09-23T12:00:00.000Z');
    });

    it('提案の経路には識別の口で定まった世帯が届く', async () => {
      // C-9 / 規則9: 世帯はアクセストークンから定まり、ユースケースの第1引数に渡る。
      const suggestNewMeals = new FixedSuggestNewMeals({ returns: suggestNewMealsOutcome });
      const app = appWithFixedDependencies({ suggestNewMeals });

      await app.request('/suggestions/new-meals', { method: 'POST', headers: bearerHeaders('x') });

      expect(suggestNewMeals.receivedHouseholdId).toBe('11111111-1111-4111-8111-111111111111');
    });

    it('保存済みの提案の経路を接頭辞なしの GET /suggestions/latest に置き、その入口の結末を返す', async () => {
      // B-58 / ADR-065 決定1: 読み取り専用の経路は提案の2つの入口を兼ねない。
      const suggestMeals = new FixedSuggestMeals({ returns: suggestMealsOutcome });
      const suggestNewMeals = new FixedSuggestNewMeals({ returns: suggestNewMealsOutcome });
      const app = appWithFixedDependencies({ suggestMeals, suggestNewMeals });

      const response = await app.request('/suggestions/latest', { headers: bearerHeaders('x') });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ outcome: 'none' });
      expect(suggestMeals.callCount).toBe(0);
      expect(suggestNewMeals.callCount).toBe(0);
    });

    it('保存済みの提案の経路には識別の口で定まった世帯が届く', async () => {
      // C-9: 世帯はアクセストークンから定まる。
      const showLatestSuggestion = new FixedShowLatestSuggestion({ returns: { outcome: 'none' } });
      const app = appWithFixedDependencies({ showLatestSuggestion });

      await app.request('/suggestions/latest', { headers: bearerHeaders('x') });

      expect(showLatestSuggestion.receivedHouseholdId).toBe('11111111-1111-4111-8111-111111111111');
    });

    it('アクセストークンを付けない OPTIONS /suggestions は 401 にならず 204 で通る', async () => {
      // 規則11 / ADR-048 決定3: preflight は認証を要さずに通る。
      const app = appWithFixedDependencies();

      const response = await app.request('/suggestions', {
        method: 'OPTIONS',
        headers: { Origin: webOrigin, 'Access-Control-Request-Method': 'POST' },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    });

    it('/suggestions への preflight が許す method は GET・POST・PUT・DELETE の4つのままである', async () => {
      // 規則11 / ADR-062 結果4: 提案の2経路は POST だけで、新しい method を足さない。
      const app = appWithFixedDependencies();

      const response = await app.request('/suggestions', {
        method: 'OPTIONS',
        headers: { Origin: webOrigin, 'Access-Control-Request-Method': 'POST' },
      });

      const allowMethodsHeader: string = response.headers.get('Access-Control-Allow-Methods') ?? '';
      const allowedMethods = allowMethodsHeader
        .split(',')
        .map((each) => each.trim())
        .filter((each) => each !== '')
        .sort();
      expect(allowedMethods).toEqual(['DELETE', 'GET', 'POST', 'PUT']);
    });

    it('アクセストークンの無い POST /suggestions の 401 にも許可の origin が付く', async () => {
      // 7章 / ADR-048 決定2: 断りの応答にも許可の origin が付かなければ、web は断られた理由を読めない。
      const app = appWithFixedDependencies();

      const response = await app.request('/suggestions', {
        method: 'POST',
        headers: { Origin: webOrigin },
      });

      expect(response.status).toBe(401);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'accessToken.missing' });
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    });
  });

  describe('提案の経路の結線', () => {
    // B-48c 7章。composeDependencies の本物の結線で、差し替えるのは JWKS を取りに行く口だけ。

    it('SUPABASE_URL が空の環境で提案を要求すると 500 unexpected になり 401 にならない', async () => {
      // ADR-045 決定3: サーバ側の不備を利用者のアクセストークンのせいにしない。
      const { app } = composedApp({ ...env, SUPABASE_URL: '' });

      const response = await app.request('/suggestions', {
        method: 'POST',
        headers: bearerHeaders(await accessTokenOf(validClaims())),
      });

      expect(response.status).toBe(500);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('JWKS を取りに行けないと提案は 500 unexpected になり 401 にならない', async () => {
      // ADR-045 / NFR-09: 取得の失敗は 500 に畳まれ、message は本体に出さない。
      const { app } = composedApp(
        env,
        FixedFetchJwks.delivering({ throws: new Error('kagi-server-todokanai') }),
      );

      const response = await app.request('/suggestions', {
        method: 'POST',
        headers: bearerHeaders(await accessTokenOf(validClaims())),
      });

      expect(response.status).toBe(500);
      const text = await response.text();
      expect(parseBody(text)).toEqual({ rule: 'unexpected' });
      expect(text).not.toContain('kagi-server-todokanai');
    });

    it('認証を通ったあと HYPERDRIVE の binding が無ければ既定の提案は 500 unexpected になる', async () => {
      // 規則12 / ADR-045: 接続文字列が読めないのはサーバ側の不備である。
      const { app } = composedApp(envWithoutHyperdrive);

      const response = await app.request('/suggestions', {
        method: 'POST',
        headers: bearerHeaders(await accessTokenOf(validClaims())),
      });

      expect(response.status).toBe(500);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('認証を通ったあと HYPERDRIVE の binding が無ければ新しい献立の要求も 500 unexpected になる', async () => {
      // 規則12 / FR-36 / ADR-045。
      const { app } = composedApp(envWithoutHyperdrive);

      const response = await app.request('/suggestions/new-meals', {
        method: 'POST',
        headers: bearerHeaders(await accessTokenOf(validClaims())),
      });

      expect(response.status).toBe(500);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('HYPERDRIVE の binding が無くても、アクセストークンの無い提案の要求は 401 accessToken.missing のままである', async () => {
      // 規則12 / NFR-C2: 世帯を定めるのが常に先。認証を通らない要求は DB に触れず、生成も呼ばない。
      const { app } = composedApp(envWithoutHyperdrive);

      const response = await app.request('/suggestions', { method: 'POST' });

      expect(response.status).toBe(401);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'accessToken.missing' });
    });

    it('在庫の経路と提案の経路に続けて要求しても JWKS の取得は1回である', async () => {
      // 規則8 / ADR-043 結果2: 認証器は環境1つにつき1つで、在庫と提案で共有する。
      // 認証を通ったあとは binding 欠落で 500 になる — 2つとも同じ結末であることも見る。
      const { app, fetchJwks } = composedApp(envWithoutHyperdrive);
      const accessToken = await accessTokenOf(validClaims());

      const stockItems = await app.request('/stock-items', { headers: bearerHeaders(accessToken) });
      const suggestions = await app.request('/suggestions', {
        method: 'POST',
        headers: bearerHeaders(accessToken),
      });

      expect([stockItems.status, suggestions.status]).toEqual([500, 500]);
      expect(fetchJwks.callCount).toBe(1);
    });
  });

  describe('疎通確認 GET /health', () => {
    it('GET /health は HYPERDRIVE も SUPABASE_URL も無い環境でも ok を返す', async () => {
      // 規則1: 結線に依らず応える。環境を1つも読まない。
      const { app } = composedApp({} as Bindings);

      const response = await app.request('/health');

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'ok' });
    });

    it('GET /health を叩いても JWKS を取りに行かない', async () => {
      // 規則1 / ADR-043 結果2: 鍵を取りに行くのは最初の検証のときであり、疎通確認では起きない。
      // **取りに行かないこと**が要件なので、記憶上の実装の回数を状態として見る（`docs/testing.md` 2章）。
      const { app, fetchJwks } = composedApp({} as Bindings);

      await app.request('/health');

      expect(fetchJwks.callCount).toBe(0);
    });
  });

  describe('検証の設定の導出 accessTokenVerificationOf', () => {
    it('SUPABASE_URL から jwksUri を <url>/auth/v1/.well-known/jwks.json に導く', () => {
      // 規則3 / ADR-043 決定3: 取りに行く先は公開鍵の一覧であり、別の環境変数を置かない。
      const verification = accessTokenVerificationOf('https://ninshou.example');

      expect(verification.jwksUri).toBe('https://ninshou.example/auth/v1/.well-known/jwks.json');
    });

    it('SUPABASE_URL から issuer を <url>/auth/v1 に導き、audience は authenticated にする', () => {
      // 規則3 / ADR-043 決定2・3: `issuer` / `audience` は省略できず、アルゴリズムは ES256 の1つだけ。
      const verification = accessTokenVerificationOf('https://ninshou.example');

      expect(verification.issuer).toBe('https://ninshou.example/auth/v1');
      expect(verification.audience).toBe('authenticated');
      expect(verification.algorithm).toBe('ES256');
    });

    it('SUPABASE_URL の末尾の / を落として連結する', () => {
      // 規則3: `//auth/v1` のような形を作らない。
      const verification = accessTokenVerificationOf('https://ninshou.example/');

      expect(verification.jwksUri).toBe('https://ninshou.example/auth/v1/.well-known/jwks.json');
      expect(verification.issuer).toBe('https://ninshou.example/auth/v1');
    });

    it('SUPABASE_URL の前後の空白を落として連結する', () => {
      // 規則3。
      const verification = accessTokenVerificationOf('  https://ninshou.example  ');

      expect(verification.jwksUri).toBe('https://ninshou.example/auth/v1/.well-known/jwks.json');
      expect(verification.issuer).toBe('https://ninshou.example/auth/v1');
    });

    it('SUPABASE_URL が空文字なら jwksUri と issuer を空文字にする', () => {
      // 規則3 / 7章: 認証器の「設定が空」の断りに乗せるため、`/auth/v1` のような形を作らない。
      const verification = accessTokenVerificationOf('');

      expect(verification.jwksUri).toBe('');
      expect(verification.issuer).toBe('');
    });

    it('SUPABASE_URL が空白だけでも jwksUri と issuer を空文字にする', () => {
      // 規則3: 空白のみも「空」である。
      const verification = accessTokenVerificationOf('   ');

      expect(verification.jwksUri).toBe('');
      expect(verification.issuer).toBe('');
    });
  });

  describe('設定と鍵の失敗は 401 に化けない', () => {
    it('SUPABASE_URL が空の環境で在庫の一覧を要求すると 500 unexpected になり 401 にならない', async () => {
      // 規則5 / ADR-045 決定3: サーバ側の不備を利用者のアクセストークンのせいにしない。
      const { app } = composedApp({ ...env, SUPABASE_URL: '' });

      const response = await app.request('/stock-items', {
        headers: bearerHeaders(await accessTokenOf(validClaims())),
      });

      expect(response.status).toBe(500);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('SUPABASE_URL が空のときは JWKS を取りに行かずに断る', async () => {
      // 7章 / B-07g 規則5: 設定が空なら鍵を取りに行く前に断る。取りに行かないことが要件なので回数を見る。
      const { app, fetchJwks } = composedApp({ ...env, SUPABASE_URL: '' });

      await app.request('/stock-items', {
        headers: bearerHeaders(await accessTokenOf(validClaims())),
      });

      expect(fetchJwks.callCount).toBe(0);
    });

    it('JWKS を取りに行けないと在庫の一覧は 500 unexpected になり 401 にならない', async () => {
      // 規則5 / ADR-045 / NFR-09: 取得の失敗は包まずに素通りし、500 に畳まれる。`message` は本体に出さない。
      const { app } = composedApp(
        env,
        FixedFetchJwks.delivering({ throws: new Error('kagi-server-todokanai') }),
      );

      const response = await app.request('/stock-items', {
        headers: bearerHeaders(await accessTokenOf(validClaims())),
      });

      expect(response.status).toBe(500);
      const text = await response.text();
      expect(parseBody(text)).toEqual({ rule: 'unexpected' });
      expect(text).not.toContain('kagi-server-todokanai');
    });

    it('JWKS の応答が ok でないと在庫の一覧は 500 unexpected になる', async () => {
      // 規則5 / B-07g 規則7: 本体が鍵の形をしていても、`ok` でない応答を信用しない。
      const { app } = composedApp(
        env,
        FixedFetchJwks.delivering({ ok: false, body: { keys: [publicAccessTokenKey] } }),
      );

      const response = await app.request('/stock-items', {
        headers: bearerHeaders(await accessTokenOf(validClaims())),
      });

      expect(response.status).toBe(500);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });
  });

  describe('アクセストークンの規則違反は結線後も 401 である', () => {
    it('アクセストークンが無い要求は結線後も 401 accessToken.missing になる', async () => {
      // 規則6 / ADR-032 表2。規則5 の対 — 片方だけだと「全部 500」でも緑になる（設計書 11章）。
      const { app } = composedApp(env);

      const response = await app.request('/stock-items');

      expect(response.status).toBe(401);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'accessToken.missing' });
    });

    it('署名が本文と合わないアクセストークンは結線後も 401 accessToken.invalid になる', async () => {
      // 規則6 / ADR-043 結果4: 別の世帯ぶんの署名を継いだだけで通ってはいけない。
      const { app } = composedApp(env);
      const forOurHousehold = await accessTokenOf(validClaims());
      const forNeighborHousehold = await accessTokenOf({
        ...validClaims(),
        sub: neighborHousehold,
      });
      const [headerPart = '', payloadPart = ''] = forOurHousehold.split('.');
      const [, , otherSignaturePart = ''] = forNeighborHousehold.split('.');

      const response = await app.request('/stock-items', {
        headers: bearerHeaders(`${headerPart}.${payloadPart}.${otherSignaturePart}`),
      });

      expect(response.status).toBe(401);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'accessToken.invalid' });
    });

    it('SUPABASE_URL から導いた issuer と食い違う iss のアクセストークンは 401 accessToken.invalid になる', async () => {
      // 規則3・6 / ADR-043 決定3: 結線が `issuer` を空にしていれば照合が消え、この行が赤くなる。
      const { app } = composedApp(env);

      const response = await app.request('/stock-items', {
        headers: bearerHeaders(
          await accessTokenOf({ ...validClaims(), iss: 'https://hoka.example/auth/v1' }),
        ),
      });

      expect(response.status).toBe(401);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'accessToken.invalid' });
    });

    it('期限の切れたアクセストークンは結線後も 401 accessToken.expired になる', async () => {
      // 規則6: 期限切れは取り直せば回復する失敗なので、`invalid` と分けて写す。
      const { app } = composedApp(env);

      const response = await app.request('/stock-items', {
        headers: bearerHeaders(
          await accessTokenOf({ ...validClaims(), exp: secondsFromNow(-3600) }),
        ),
      });

      expect(response.status).toBe(401);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'accessToken.expired' });
    });
  });

  describe('HYPERDRIVE の binding が無いとき', () => {
    it('認証を通ったあと HYPERDRIVE の binding が無ければ 500 unexpected になる', async () => {
      // 規則9 / ADR-045: 接続文字列が読めないのはサーバ側の不備であり、応答に接続文字列も message も載せない。
      const { app } = composedApp(envWithoutHyperdrive);

      const response = await app.request('/stock-items', {
        headers: bearerHeaders(await accessTokenOf(validClaims())),
      });

      expect(response.status).toBe(500);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('HYPERDRIVE の binding が無くても、認証を通らない要求は 401 のままである', async () => {
      // 規則9 / B-08 規則5: 世帯を定めるのが常に先。認証を通らない要求は DB に触れない。
      const { app } = composedApp(envWithoutHyperdrive);

      const response = await app.request('/stock-items');

      expect(response.status).toBe(401);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'accessToken.missing' });
    });
  });

  describe('認証器の再利用', () => {
    it('同じ組み立てに2度要求しても JWKS の取得は1回である', async () => {
      // 規則4 / ADR-043 結果2: 認証器は環境1つにつき1つ。要求ごとに作り直すと取得が2回になる。
      // 認証を通ったあとは binding 欠落で 500 になる（規則9）— 2回とも同じ結末であることも見る。
      const { app, fetchJwks } = composedApp(envWithoutHyperdrive);
      const accessToken = await accessTokenOf(validClaims());

      const first = await app.request('/stock-items', { headers: bearerHeaders(accessToken) });
      const second = await app.request('/stock-items', { headers: bearerHeaders(accessToken) });

      expect([first.status, second.status]).toEqual([500, 500]);
      expect(fetchJwks.callCount).toBe(1);
    });

    it('同じ組み立てに同時に2つ要求しても JWKS の取得は1回である', async () => {
      // 規則4: 1度目の取得が終わる前に来た検証も同じ取得を待つ。
      const { app, fetchJwks } = composedApp(envWithoutHyperdrive);
      const accessToken = await accessTokenOf(validClaims());

      await Promise.all([
        app.request('/stock-items', { headers: bearerHeaders(accessToken) }),
        app.request('/stock-items', { headers: bearerHeaders(accessToken) }),
      ]);

      expect(fetchJwks.callCount).toBe(1);
    });
  });

  describe('web からの到達 CORS', () => {
    // B-22 設計書 規則11〜15。開発の web は :5173 で開く（`vite.config.ts` の `server.port`）。
    // `127.0.0.1` で開く人が居るため、許可の一覧は2つである（設計書 10章 前提2）。
    const webOrigin = 'http://localhost:5173';
    const loopbackWebOrigin = 'http://127.0.0.1:5173';
    /** 許可の一覧に無い要求元。架空の値である（B-09 設計書 11章と同じ流儀）。 */
    const unknownOrigin = 'https://akunin.example';

    /** 要求元1つ。単純要求にも preflight にも同じ形で載る。 */
    function originHeaders(origin: string): Record<string, string> {
      return { Origin: origin };
    }

    /**
     * preflight の要求。**`Authorization` を付けない** — 付けずに通ることが規則14 の本題である。
     */
    function preflightRequest(origin: string, extraHeaders: Record<string, string> = {}) {
      return {
        method: 'OPTIONS',
        headers: {
          ...originHeaders(origin),
          'Access-Control-Request-Method': 'GET',
          ...extraHeaders,
        },
      };
    }

    /**
     * 一覧のヘッダを要素に開く。**並び順は約束の対象ではない**（HTTP はどちらの順でも同じ許可を
     * 表す）ので、突き合わせる側で揃える。ヘッダの名は大小を区別しないため小文字に落とす。
     */
    function headerValues(
      response: { headers: { get(name: string): string | null } },
      name: string,
    ): string[] {
      const value = response.headers.get(name) ?? '';
      return value
        .split(',')
        .map((each) => each.trim())
        .filter((each) => each !== '')
        .sort();
    }

    it('開発の web の origin からの GET /stock-items には許可の origin をそのまま返す', async () => {
      // 規則11・12 / FR-04 / ADR-046 結果3: ミドルウェアは経路より前に置き、許可の origin をそのまま返す。
      const app = appWithFixedDependencies();

      const response = await app.request('/stock-items', {
        headers: { ...bearerHeaders('x'), ...originHeaders(webOrigin) },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    });

    it('127.0.0.1 の origin も許可の一覧に入っている', async () => {
      // 規則12 / 設計書 10章 前提2: 同じ開発サーバを別の host 名で開く人が居る。
      const app = appWithFixedDependencies();

      const response = await app.request('/stock-items', {
        headers: { ...bearerHeaders('x'), ...originHeaders(loopbackWebOrigin) },
      });

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:5173');
    });

    it('許していない origin には許可の origin を返さない', async () => {
      // 規則12 / NFR-08 / NFR-09: `*` にも要求元の反射にもしない。許可の一覧は明示である。
      // 断るのは状態コードではなく**ヘッダを付けないこと**で、塞ぐのはブラウザの側である。
      const app = appWithFixedDependencies();

      const response = await app.request('/stock-items', {
        headers: { ...bearerHeaders('x'), ...originHeaders(unknownOrigin) },
      });

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(null);
    });

    it('許可の応答に資格情報の許可を付けない', async () => {
      // 規則12 / ADR-043: トークンはヘッダで運ぶ。Cookie の経路を作らない。
      const app = appWithFixedDependencies();

      const response = await app.request('/stock-items', {
        headers: { ...bearerHeaders('x'), ...originHeaders(webOrigin) },
      });

      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe(null);
    });

    it('アクセストークンを付けない OPTIONS /stock-items は 401 にならず 204 で通る', async () => {
      // 規則14 / ADR-046 結果3: preflight は認証を要さずに通る。認証にも経路にも届かない。
      const app = appWithFixedDependencies();

      const response = await app.request('/stock-items', preflightRequest(webOrigin));

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    });

    it('preflight が許す method は結線済みの4つである', async () => {
      // 規則13 / FR-01 / FR-04 / FR-05 / FR-06 / B-09: 画面の有無ではなく結線済みの経路に合わせる。
      // `HEAD` と `PATCH` は Worker が持たないので、この突き合わせに現れてはいけない。
      const app = appWithFixedDependencies();

      const response = await app.request('/stock-items', preflightRequest(webOrigin));

      expect(headerValues(response, 'Access-Control-Allow-Methods')).toEqual([
        'DELETE',
        'GET',
        'POST',
        'PUT',
      ]);
    });

    it('preflight が許すヘッダは Authorization と Content-Type だけで、要求されたヘッダを写さない', async () => {
      // 規則13 / ADR-043: 許すのは2つだけ。要求されたものを写すと、許可の一覧が要求元の言い値になる。
      const app = appWithFixedDependencies();

      const response = await app.request(
        '/stock-items',
        preflightRequest(webOrigin, { 'Access-Control-Request-Headers': 'x-nazo-header' }),
      );

      const allowedHeaders = headerValues(response, 'Access-Control-Allow-Headers').map((each) =>
        each.toLowerCase(),
      );
      expect(allowedHeaders).toEqual(['authorization', 'content-type']);
      expect(allowedHeaders).not.toContain('x-nazo-header');
    });

    it('アクセストークンの無い GET /stock-items の 401 にも許可の origin が付く', async () => {
      // 規則14 / ADR-045 / NFR-09: 付かなければ、サーバが断ったことがブラウザでは CORS の失敗に化け、
      // web の `failed` の理由を誰も読めなくなる。ミドルウェアを経路より前に置くのはこのためである。
      const app = appWithFixedDependencies();

      const response = await app.request('/stock-items', { headers: originHeaders(webOrigin) });

      expect(response.status).toBe(401);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'accessToken.missing' });
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    });

    it('サーバ側の不備による 500 にも許可の origin が付く', async () => {
      // 規則14 / ADR-045: 500 も断りである。`SUPABASE_URL` が空の環境で 500 になる経路を流用する。
      const { app } = composedApp({ ...env, SUPABASE_URL: '' });

      const response = await app.request('/stock-items', {
        headers: {
          ...bearerHeaders(await accessTokenOf(validClaims())),
          ...originHeaders(webOrigin),
        },
      });

      expect(response.status).toBe(500);
      await expect(failureBody(response)).resolves.toEqual({ rule: 'unexpected' });
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    });

    it('接頭辞を付けた /api/stock-items には経路を置かない', async () => {
      // 規則15 / B-09 / ADR-003: 接頭辞は増やさない。Worker の origin は API と `/health` しか出さない。
      const app = appWithFixedDependencies();

      const response = await app.request('/api/stock-items', {
        headers: { ...bearerHeaders('x'), ...originHeaders(webOrigin) },
      });

      expect(response.status).toBe(404);
    });

    it('開発の web の origin からの GET /health にも許可の origin が付く', async () => {
      // 規則11 / ADR-046 結果3: ミドルウェアは `app.use('*', …)` で**すべての経路の前**に立つ。
      // `/health` も経路の1つであり、その後ろに挿した置き方はここで赤くなる。
      const app = appWithFixedDependencies();

      const response = await app.request('/health', { headers: originHeaders(webOrigin) });

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    });
  });
});
