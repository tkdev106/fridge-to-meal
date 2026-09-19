import type { ListStockItemsOutput, StockItemDto } from '@fridge-to-meal/contract';
import { describe, expect, it } from 'vitest';
import type { Bindings } from '../src/main.js';
import { accessTokenVerificationOf, composeDependencies, createApp } from '../src/main.js';
import { householdIdOf } from '../src/shared/domain/HouseholdId.js';
import type { AccessTokenClaims } from './support/identity/AccessSigning.js';
import { accessTokenOf, publicAccessTokenKey } from './support/identity/AccessSigning.js';
import { FixedFetchJwks } from './support/identity/FixedFetchJwks.js';
import { FixedIdentifyHousehold } from './support/identity/FixedIdentifyHousehold.js';
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
 * 依存をすべて代役にして組んだ app（規則1・2 の確認）。結線の相手を差し替えるのではなく、
 * **経路がどこに置かれるか**だけを見るためのもの（設計書 8章末尾）。
 */
function appWithFixedDependencies(overrides: { listOutput?: ListStockItemsOutput } = {}) {
  return createApp({
    identifyHousehold: new FixedIdentifyHousehold({ returns: ourHousehold }).identify,
    registerStockItem: new FixedRegisterStockItem({ returns: stockItemDto() }).register,
    listStockItems: new FixedListStockItems({
      returns: overrides.listOutput ?? { stockItems: [stockItemDto()] },
    }).list,
    updateStockItem: new FixedUpdateStockItem({ returns: stockItemDto() }).update,
    deleteStockItem: new FixedDeleteStockItem({ succeeds: true }).delete,
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
});
