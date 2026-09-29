// composition root。
//
// **実装クラスを new してよいのはこのファイルだけである**（ADR-002 / CLAUDE.md）。
// ここでリポジトリとポートの実装を組み立て、ユースケースに注入し、api 層に渡す。
//
// 結線するのは在庫（pantry）の4経路と献立（meal）の提案の3経路・食材名の1経路・調理記録の1経路・献立詳細の1経路・献立の一覧の1経路・世帯のデータを消す1経路、その前に立つ
// 世帯の認証（identity）である。コンテキストをまたいで全層を import してよいのは、依存表の `main.ts` の
// 行だけ（CLAUDE.md「依存は外から内へ」）。

import { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import type { ExecutionContext } from 'hono';
import { cors } from 'hono/cors';
import postgres from 'postgres';
import type {
  AccessTokenVerification,
  FetchJwks,
} from './contexts/identity/infrastructure/HouseholdAuthenticatorImpl.js';
import { HouseholdAuthenticatorImpl } from './contexts/identity/infrastructure/HouseholdAuthenticatorImpl.js';
import { identifyHousehold } from './contexts/identity/usecase/IdentifyHousehold.js';
import type { CookingRecordRoutesDeps } from './contexts/meal/api/CookingRecordRoutes.js';
import { createCookingRecordRoutes } from './contexts/meal/api/CookingRecordRoutes.js';
import type { HouseholdDataRoutesDeps } from './contexts/meal/api/HouseholdDataRoutes.js';
import { createHouseholdDataRoutes } from './contexts/meal/api/HouseholdDataRoutes.js';
import type { IngredientNameRoutesDeps } from './contexts/meal/api/IngredientNameRoutes.js';
import { createIngredientNameRoutes } from './contexts/meal/api/IngredientNameRoutes.js';
import type { MealListRoutesDeps } from './contexts/meal/api/MealListRoutes.js';
import { createMealListRoutes } from './contexts/meal/api/MealListRoutes.js';
import type { MealRoutesDeps } from './contexts/meal/api/MealRoutes.js';
import { createMealRoutes } from './contexts/meal/api/MealRoutes.js';
import type { SuggestionRoutesDeps } from './contexts/meal/api/SuggestionRoutes.js';
import { createSuggestionRoutes } from './contexts/meal/api/SuggestionRoutes.js';
import type { MealIdGenerator } from './contexts/meal/domain/port/MealIdGenerator.js';
import type { SuggestionIdGenerator } from './contexts/meal/domain/port/SuggestionIdGenerator.js';
import { mealIdOf } from './contexts/meal/domain/value/MealId.js';
import { suggestionIdOf } from './contexts/meal/domain/value/SuggestionId.js';
import { MealRepositoryImpl } from './contexts/meal/infrastructure/MealRepositoryImpl.js';
import { PlaceholderMealGenerator } from './contexts/meal/infrastructure/PlaceholderMealGenerator.js';
import { SuggestionRepositoryImpl } from './contexts/meal/infrastructure/SuggestionRepositoryImpl.js';
import { addCookingRecord } from './contexts/meal/usecase/AddCookingRecord.js';
import { suggestMeals, suggestNewMeals } from './contexts/meal/usecase/SuggestMeals.js';
import { showLatestSuggestion } from './contexts/meal/usecase/ShowLatestSuggestion.js';
import { showMeal } from './contexts/meal/usecase/ShowMeal.js';
import { listMeals } from './contexts/meal/usecase/ListMeals.js';
import { listIngredientNames } from './contexts/meal/usecase/ListIngredientNames.js';
import { deleteHouseholdData } from './contexts/meal/usecase/DeleteHouseholdData.js';
import { createStockItemRoutes } from './contexts/pantry/api/StockItemRoutes.js';
import type { StockItemIdGenerator } from './contexts/pantry/domain/port/StockItemIdGenerator.js';
import { stockItemIdOf } from './contexts/pantry/domain/value/StockItemId.js';
import type { HouseholdTransaction } from './shared/infrastructure/db/HouseholdTransaction.js';
import { withHouseholdTransaction } from './shared/infrastructure/db/HouseholdTransaction.js';
import { StockItemRepositoryImpl } from './contexts/pantry/infrastructure/StockItemRepositoryImpl.js';
import { deleteStockItem } from './contexts/pantry/usecase/DeleteStockItem.js';
import { deleteHouseholdStockItems } from './contexts/pantry/usecase/DeleteHouseholdStockItems.js';
import { listSavedStockItemNames } from './contexts/pantry/usecase/ListSavedStockItemNames.js';
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
export type AppDependencies = Parameters<typeof createStockItemRoutes>[0] &
  SuggestionRoutesDeps &
  IngredientNameRoutesDeps &
  CookingRecordRoutesDeps &
  MealRoutesDeps &
  MealListRoutesDeps &
  HouseholdDataRoutesDeps;

/** 差し替えられる出口。既定は実行環境の `fetch`。テストは `FixedFetchJwks` を渡す。 */
export type CompositionPorts = { readonly fetchJwks?: FetchJwks };

/**
 * 在庫品の識別子の発行（ADR-026 / B-09 設計書 規則10）。`stock_items.id` は `uuid` 列。
 * 乱数を読むのはここだけで、ユースケースの本体には出さない（`docs/testing.md` 5章）。
 * `crypto` は Workers のグローバルであり、`node:crypto` を import しない。
 */
const generateStockItemId: StockItemIdGenerator = () => stockItemIdOf(crypto.randomUUID());

/**
 * 献立と提案の識別子の発行（B-48c）。`meals.id` / `suggestions.id` はどちらも `uuid` 列。
 * 在庫品と同じく、乱数を読むのはここだけである。
 */
const generateMealId: MealIdGenerator = () => mealIdOf(crypto.randomUUID());
const generateSuggestionId: SuggestionIdGenerator = () => suggestionIdOf(crypto.randomUUID());

/**
 * 基準日時（ADR-062 決定1）。**呼ばれるたびに時計を読む** — 組み立て時に1度だけ読んで固定すると、
 * isolate が生きている間ずっと同じ時刻で期限と1日の上限を判じることになる。
 * 時計を読むのはここだけで、ユースケースにも経路にも書かない（`docs/testing.md` 5章）。
 */
const now = (): string => new Date().toISOString();

/**
 * ユースケース1つを **1要求1トランザクション**で包む（B-09 設計書 規則7・8 /
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
  // 状態を持たないので2つの入口で共有する（B-47 規則11）。選ぶ設定は置かない（ADR-060）。
  const mealGenerator = new PlaceholderMealGenerator();

  /**
   * 提案の依存を1つの `tx` から組む（B-48c）。`listStockItems` は**同じ `tx` の素のもの**を渡す —
   * 在庫の経路用の包み済みを渡すと、1要求に2本目の接続とトランザクションが開き、
   * 在庫の読みと提案の書き込みが別の時点になる（ADR-029 決定3(a) / ADR-033 決定2）。
   */
  const mealSuggestionDepsOf = (tx: HouseholdTransaction) => ({
    listStockItems: listStockItems({ stockItemRepository: new StockItemRepositoryImpl(tx) }),
    mealRepository: new MealRepositoryImpl(tx),
    suggestionRepository: new SuggestionRepositoryImpl(tx),
    mealGenerator,
    generateMealId,
    generateSuggestionId,
  });

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
    suggestMeals: transactionPerRequest(env, (tx) => suggestMeals(mealSuggestionDepsOf(tx))),
    suggestNewMeals: transactionPerRequest(env, (tx) => suggestNewMeals(mealSuggestionDepsOf(tx))),
    // 読み取り専用の口も同じ1要求1トランザクションで包む（B-58 / ADR-029 決定3(a)）。
    // **生成器も採番も渡さない** — 生成も保存もしないので、渡すと「呼ばない」が型から読めなくなる。
    showLatestSuggestion: transactionPerRequest(env, (tx) =>
      showLatestSuggestion({
        listStockItems: listStockItems({ stockItemRepository: new StockItemRepositoryImpl(tx) }),
        mealRepository: new MealRepositoryImpl(tx),
        suggestionRepository: new SuggestionRepositoryImpl(tx),
      }),
    ),
    // 食材名の口も同じ1要求1トランザクションで包む（B-50b 10章 / ADR-029 決定3(a)）。
    // **`mealSuggestionDepsOf` を使い回さない** — 提案のリポジトリも生成器も採番も要らず、
    // 渡すと「生成も保存もしない」が型から読めなくなるうえ、この経路が提案の都合に縛られる。
    // `listStockItems` は**同じ `tx` の素のもの**を渡す（包み済みを渡すと1要求に2本目の
    // 接続とトランザクションが開き、在庫と献立を別の時点で読むことになる）。
    // 保存したことのある名称（B-50d）も同じ `tx` から引く。
    listIngredientNames: transactionPerRequest(env, (tx) =>
      listIngredientNames({
        listStockItems: listStockItems({ stockItemRepository: new StockItemRepositoryImpl(tx) }),
        listSavedStockItemNames: listSavedStockItemNames({
          stockItemRepository: new StockItemRepositoryImpl(tx),
        }),
        mealRepository: new MealRepositoryImpl(tx),
      }),
    ),
    // 調理記録の口も同じ1要求1トランザクションで包む（B-51 規則12 / ADR-029 決定3(a)）。
    // **`mealSuggestionDepsOf` を使い回さない** — 生成器も採番も提案のリポジトリも要らず、
    // 渡すと「生成も保存もしない／提案に触らない」が型から読めなくなる。
    // **在庫の口を1つも渡さない** — 記録しても在庫は減らさない（C-8）。
    addCookingRecord: transactionPerRequest(env, (tx) =>
      addCookingRecord({ mealRepository: new MealRepositoryImpl(tx) }),
    ),
    // 献立詳細の口も同じ1要求1トランザクションで包む（B-52 / ADR-029 決定3(a)）。
    // **`mealSuggestionDepsOf` を使い回さない** — 生成器も採番も提案のリポジトリも要らず、
    // 渡すと「生成も保存もしない」が型から読めなくなる。
    // `listStockItems` は**同じ `tx` の素のもの**を渡す（包み済みを渡すと1要求に2本目の
    // 接続とトランザクションが開き、在庫と献立を別の時点で読むことになる）。
    showMeal: transactionPerRequest(env, (tx) =>
      showMeal({
        listStockItems: listStockItems({ stockItemRepository: new StockItemRepositoryImpl(tx) }),
        mealRepository: new MealRepositoryImpl(tx),
      }),
    ),
    // 献立の一覧の口も同じ1要求1トランザクションで包む（B-54a / ADR-068 / ADR-029 決定3(a)）。
    // **献立のリポジトリしか渡さない** — 在庫も提案も読まないことが依存の形から読める（C-8）。
    listMeals: transactionPerRequest(env, (tx) =>
      listMeals({ mealRepository: new MealRepositoryImpl(tx) }),
    ),
    // 世帯のデータを消す口も同じ1要求1トランザクションで包む（B-56a 規則13 / ADR-029 決定3(a)）。
    // 3つのリポジトリを**同じ `tx`** から作り、在庫の口も同じ `tx` の素のものを渡す — どれかが
    // 投げたら巻き戻しで1行も消えない（規則8）。生成器・採番・`now` は渡さない。
    deleteHouseholdData: transactionPerRequest(env, (tx) =>
      deleteHouseholdData({
        deleteHouseholdStockItems: deleteHouseholdStockItems({
          stockItemRepository: new StockItemRepositoryImpl(tx),
        }),
        mealRepository: new MealRepositoryImpl(tx),
        suggestionRepository: new SuggestionRepositoryImpl(tx),
      }),
    ),
    now,
  };
}

/**
 * CORS で許す要求元の**明示の一覧**（B-22 設計書 規則12 / ADR-048 決定2 / NFR-08 / NFR-09）。
 *
 * `*` にも要求元の反射にもしない — web は `Authorization` にアクセストークンを載せて来るので
 * （ADR-043）、未知の origin からの往復をブラウザに許させる理由が1つも無い。
 *
 * **いま2つしか無いのは、本番の配信先がまだ決まっていないためである**（ADR-046 結果3 /
 * B-22 設計書 10章）。開発の web は `http://localhost:5173`（`vite.config.ts` の `server.port`）で、
 * `127.0.0.1` で開く人が居るため同じ開発サーバを2つの名で挙げている。
 * **配信先が決まった周に、その origin をこの一覧へ足す** — 先回りで未知の origin を許さない。
 */
const ALLOWED_WEB_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/**
 * CORS で許す method。**画面の有無ではなく結線済みの経路に合わせる**（B-22 設計書 規則13 / B-09）。
 * 在庫の4経路と提案の2経路（どちらも `POST`）で使うのがこの4つであり、Worker が持たない `HEAD` / `PATCH` は挙げない。
 *
 * **`OPTIONS` も挙げない。** preflight に応えるのはミドルウェア自身であり、`next()` を呼ぶ前に
 * 204 を返す — 経路に届かないものを許可の一覧に並べる必要はない（ADR-048 決定3）。
 */
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE'];

/**
 * CORS で許す要求ヘッダ（B-22 設計書 規則13 / ADR-043）。アクセストークンを運ぶ `Authorization` と、
 * 本体を持つ経路の `Content-Type` の2つだけ。**明示すると hono は要求されたヘッダを写さなくなる** —
 * 写せば許可の一覧が要求元の言い値になる。
 */
const ALLOWED_HEADERS = ['Authorization', 'Content-Type'];

/**
 * `/health` と在庫の4経路、提案の3経路、食材名の1経路、調理記録の1経路、献立詳細の1経路を1つの Hono にする。`new` するのは Hono だけ（B-09 設計書 規則1・2）。
 *
 * 在庫の経路は**接頭辞なし**で根にマウントする（`POST /stock-items` 等。FR-01 / FR-04 /
 * FR-05 / FR-06 / ADR-003）。提案の経路も同じく根に置く（`POST /suggestions` と
 * `POST /suggestions/new-meals`。ADR-062 決定1 / B-48c）。食材名の1経路も同じく根に置く
 * （`GET /ingredient-names`。FR-02 / ADR-048 決定4 / B-50b）。調理記録の1経路も同じである
 * （`POST /meals/:id/cooking-records`。FR-22 / FR-31 / B-51）。献立詳細の1経路も同じである
 * （`GET /meals/:id`。FR-30 / FR-32 / B-52）— **調理記録の経路より後ろに置いても前に置いても
 * 食い合わない**（道が違う）。**接頭辞は増やさない**（B-22 設計書 規則15）— この Worker の origin は
 * 在庫と献立の API と `/health` しか出さないので、`/api` で切り分ける相手が居ない。接頭辞が効くのは
 * web と api が1つのドメインを分け合うときで、**その配信先はまだ決まっていない。**
 *
 * **CORS は経路より前に `app.use('*', …)` で置く**（B-22 設計書 規則11・14 / ADR-046 結果3）。
 * `/health` も経路の1つなので、その前である。後ろに挿すと、通った応答にしか許可のヘッダが付かず、
 * **断りの応答（401 / 500）が素のまま出る** — するとサーバが断ったことがブラウザでは CORS の失敗に
 * 化け、web は断られた理由を読めなくなる（ADR-045 は不備を利用者のせいにしないことを求めている）。
 * 認証を要さずに preflight が通るのも、この位置に居るからである。
 *
 * `credentials` は真にしない（規則12）— トークンはヘッダで運び、Cookie の経路を作らない。
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: ALLOWED_WEB_ORIGINS,
      allowMethods: ALLOWED_METHODS,
      allowHeaders: ALLOWED_HEADERS,
    }),
  );

  /** 疎通確認。結線に依らず応え、環境を1つも読まない。Supabase 無料プランの一時停止よけにも使える（`docs/requirements.md` 11章 未決事項7）。 */
  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.route('/', createStockItemRoutes(deps));
  app.route('/', createSuggestionRoutes(deps));
  app.route('/', createIngredientNameRoutes(deps));
  app.route('/', createCookingRecordRoutes(deps));
  app.route('/', createMealRoutes(deps));
  // `GET /meals` は `GET /meals/:id` と形が違い、食い合わない（B-54a）。
  app.route('/', createMealListRoutes(deps));
  app.route('/', createHouseholdDataRoutes(deps));

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
