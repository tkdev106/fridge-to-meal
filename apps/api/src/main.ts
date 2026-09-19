// composition root。
//
// **実装クラスを new してよいのはこのファイルだけである**（ADR-002 / CLAUDE.md）。
// ここでリポジトリとポートの実装を組み立て、ユースケースに注入し、api 層に渡す。
//
// 結線するのは在庫（pantry）の4経路と、その前に立つ世帯の認証（identity）である。
// コンテキストをまたいで両方の全層を import してよいのは、依存表の `main.ts` の行だけ
// （CLAUDE.md「依存は外から内へ」）。

import { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import type { ExecutionContext } from 'hono';
import postgres from 'postgres';
import type {
  AccessTokenVerification,
  FetchJwks,
} from './contexts/identity/infrastructure/HouseholdAuthenticatorImpl.js';
import { HouseholdAuthenticatorImpl } from './contexts/identity/infrastructure/HouseholdAuthenticatorImpl.js';
import { identifyHousehold } from './contexts/identity/usecase/IdentifyHousehold.js';
import { createStockItemRoutes } from './contexts/pantry/api/StockItemRoutes.js';
import type { StockItemIdGenerator } from './contexts/pantry/domain/port/StockItemIdGenerator.js';
import { stockItemIdOf } from './contexts/pantry/domain/value/StockItemId.js';
import type { HouseholdTransaction } from './contexts/pantry/infrastructure/db/HouseholdTransaction.js';
import { withHouseholdTransaction } from './contexts/pantry/infrastructure/db/HouseholdTransaction.js';
import { StockItemRepositoryImpl } from './contexts/pantry/infrastructure/StockItemRepositoryImpl.js';
import { deleteStockItem } from './contexts/pantry/usecase/DeleteStockItem.js';
import { listStockItems } from './contexts/pantry/usecase/ListStockItems.js';
import { registerStockItem } from './contexts/pantry/usecase/RegisterStockItem.js';
import { updateStockItem } from './contexts/pantry/usecase/UpdateStockItem.js';
import type { HouseholdId } from './shared/domain/HouseholdId.js';

/**
 * Workers から渡される束縛のうち、読むものだけ（B-09 設計書 規則14・15）。
 * `HYPERDRIVE` は workers-types の `Hyperdrive` を名指しせず、読む1項目の構造型で受ける —
 * テスト側（tsconfig.test.json は types: []）が同じ型を満たせるようにするため（先行 `JwksResponse`）。
 *
 * 接続文字列は Hyperdrive の binding が持つ（ADR-042 決定2）。環境変数で接続先を渡す道は置かない。
 */
export type Bindings = {
  readonly HYPERDRIVE: { readonly connectionString: string };
  readonly SUPABASE_URL: string;
};

/** Supabase Auth の経路。JWKS も `iss` もこの下に居る（ADR-043 決定3。実測は B-07f）。 */
const AUTH_PATH = '/auth/v1';

/** アクセストークンの `aud`。Supabase Auth が発行するものは常にこの値である（ADR-043 決定3）。 */
const ACCESS_TOKEN_AUDIENCE = 'authenticated';

/**
 * `SUPABASE_URL` から検証の3値を導く（B-09 設計書 規則3 / ADR-043 決定3）。
 *
 * 前後の空白と末尾の `/` を落としてから連結する — `//auth/v1` のような形を作らない。
 * **空（空白のみを含む）なら `jwksUri` と `issuer` も空文字にする。** `/auth/v1` だけの値を
 * 作ると認証器の「設定が空」の断りに乗らず、鍵を取りに行ってから失敗することになる（ADR-045）。
 * 取りに行く先は公開鍵の一覧なので、別の環境変数を置かない。
 */
export function accessTokenVerificationOf(supabaseUrl: string): AccessTokenVerification {
  const baseUrl = supabaseUrl.trim().replace(/\/+$/, '');
  const authUrl = baseUrl === '' ? '' : `${baseUrl}${AUTH_PATH}`;

  return {
    jwksUri: authUrl === '' ? '' : `${authUrl}/.well-known/jwks.json`,
    algorithm: 'ES256',
    issuer: authUrl,
    audience: ACCESS_TOKEN_AUDIENCE,
  };
}

/** api 層が受け取る形そのもの。ユースケースから導出し、ここで型を新設しない（ADR-032 決定1 と同じ手）。 */
export type AppDependencies = Parameters<typeof createStockItemRoutes>[0];

/** 差し替えられる出口。既定は実行環境の `fetch`。テストは `FixedFetchJwks` を渡す。 */
export type CompositionPorts = { readonly fetchJwks?: FetchJwks };

/**
 * 在庫品の識別子の発行（ADR-026 / B-09 設計書 規則10）。`stock_items.id` は `uuid` 列。
 * 乱数を読むのはここだけで、ユースケースの本体には出さない（`docs/testing.md` 5章）。
 * `crypto` は Workers のグローバルであり、`node:crypto` を import しない。
 */
const generateStockItemId: StockItemIdGenerator = () => stockItemIdOf(crypto.randomUUID());

/**
 * 在庫のユースケース1つを **1要求1トランザクション**で包む（B-09 設計書 規則7・8 /
 * ADR-029 決定3(a) / ADR-042 決定2・決定3）。
 *
 * ユースケースの工場はリポジトリを構築時に取るため、**工場の呼び出し自体をトランザクションの
 * 中に置く**。`StockItemRepositoryImpl` はその `tx` で生成し、外に持ち出さない。世帯は
 * ユースケースの第1引数と同じものを `withHouseholdTransaction` に渡す（C-9）。
 *
 * **接続文字列は要求のたびに binding から読み、クライアントは要求ごとに作って閉じる。**
 * Workers は要求をまたいで TCP 接続を使い回せない。閉じるのは成功でも失敗でも（`finally`）。
 * `prepare: false` と `fetch_types: false` は Hyperdrive 経由で要る（ADR-042 決定3）。
 *
 * `HYPERDRIVE` の binding が無ければ `connectionString` を読むところで例外になり、api 層の
 * `catch` が 500 `unexpected` に畳む（規則9 / ADR-045）。**認証を通ったあと**にしか呼ばれない
 * ので、認証を通らない要求は DB に触れない。
 */
function transactionPerRequest<Args extends unknown[], Result>(
  env: Bindings,
  build: (tx: HouseholdTransaction) => (householdId: HouseholdId, ...args: Args) => Promise<Result>,
): (householdId: HouseholdId, ...args: Args) => Promise<Result> {
  return async (householdId, ...args) => {
    const connectionString = env.HYPERDRIVE.connectionString;
    const client = postgres(connectionString, { prepare: false, fetch_types: false });

    try {
      return await withHouseholdTransaction(drizzle(client), householdId, (tx) =>
        build(tx)(householdId, ...args),
      );
    } finally {
      await client.end();
    }
  };
}

/**
 * 実装クラスの `new` はこの関数の中だけ（B-09 設計書 規則11 / ADR-002 / ADR-029 決定5）。
 *
 * 呼ぶたびに認証器を1つ作る — 保持は default export の側（規則4 / ADR-043 結果2）。
 * `SUPABASE_URL` が無い環境でもここでは投げない。空として認証器に渡し、断るのは検証時である
 * （認証器の「設定が空」の断り。ADR-045 により 401 ではなく 500 に畳まれる）。
 *
 * `fetchJwks` が与えられなければ（`undefined`）認証器の既定（実行環境の `fetch`）に任せる。
 */
export function composeDependencies(env: Bindings, ports?: CompositionPorts): AppDependencies {
  // `SUPABASE_URL` は型の上では必ずあるが、束縛を欠いた環境でも組み立て自体は投げない（規則1・5）。
  const supabaseUrl: string | undefined = env.SUPABASE_URL;
  const householdAuthenticator = new HouseholdAuthenticatorImpl(
    accessTokenVerificationOf(supabaseUrl ?? ''),
    ports?.fetchJwks,
  );

  return {
    identifyHousehold: identifyHousehold({ householdAuthenticator }),
    registerStockItem: transactionPerRequest(env, (tx) =>
      registerStockItem({
        stockItemRepository: new StockItemRepositoryImpl(tx),
        generateStockItemId,
      }),
    ),
    listStockItems: transactionPerRequest(env, (tx) =>
      listStockItems({ stockItemRepository: new StockItemRepositoryImpl(tx) }),
    ),
    updateStockItem: transactionPerRequest(env, (tx) =>
      updateStockItem({ stockItemRepository: new StockItemRepositoryImpl(tx) }),
    ),
    deleteStockItem: transactionPerRequest(env, (tx) =>
      deleteStockItem({ stockItemRepository: new StockItemRepositoryImpl(tx) }),
    ),
  };
}

/**
 * `/health` と在庫の4経路を1つの Hono にする。`new` するのは Hono だけ（B-09 設計書 規則1・2）。
 *
 * 在庫の経路は**接頭辞なし**で根にマウントする（`POST /stock-items` 等。FR-01 / FR-04 /
 * FR-05 / FR-06 / ADR-003）。web からの到達（接頭辞・CORS）は B-22 が決める。
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  /** 疎通確認。結線に依らず応え、環境を1つも読まない。Supabase 無料プランの一時停止よけにも使える（`docs/requirements.md` 11章 未決事項7）。 */
  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.route('/', createStockItemRoutes(deps));

  return app;
}

/**
 * 環境 `env` 1つにつき1つの組み立て（B-09 設計書 規則4 / ADR-043 結果2）。
 *
 * Workers は同じ isolate の要求に同じ `env` オブジェクトを渡すので、これに載せて認証器を
 * 要求ごとに作り直さない — 作り直すと JWKS を要求ごとに取りに行く。外れても正しさは
 * 壊れず、遅くなるだけ（設計書 10章）。
 *
 * **この入口にはテストが無い。** `fetchJwks` を差し替えられず本物の `fetch` で JWKS へ出るため
 * `pnpm test` では観察できない（`docs/testing.md` 5章）。認証器の再利用は `composeDependencies`
 * 1回ぶんの組み立てに対して `test/main.test.ts` が押さえている。
 */
const appsByEnv = new WeakMap<Bindings, Hono>();

function appFor(env: Bindings): Hono {
  const composed = appsByEnv.get(env);
  if (composed !== undefined) return composed;

  const app = createApp(composeDependencies(env));
  appsByEnv.set(env, app);
  return app;
}

/** Workers の入口。同じ `env` には同じ組み立てを返し、`fetch` は Hono に委ねる。 */
export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Response | Promise<Response> {
    return appFor(env).fetch(request, env, ctx);
  },
};
