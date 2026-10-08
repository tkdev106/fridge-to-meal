import type { ShowLatestSuggestionOutput, SuggestMealsOutput } from '@fridge-to-meal/contract';
import { describe, expect, it } from 'vitest';
import { createSuggestionRoutes } from '../../../../src/contexts/meal/api/SuggestionRoutes.js';
import { IdentityRuleViolation } from '../../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { PantryRuleViolation } from '../../../../src/contexts/pantry/domain/error/PantryRuleViolation.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { FixedIdentifyHousehold } from '../../../support/identity/FixedIdentifyHousehold.js';
import {
  FixedShowLatestSuggestion,
  FixedSuggestMeals,
  FixedSuggestNewMeals,
} from '../../../support/meal/FixedSuggestMeals.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

/**
 * アクセストークンは ASCII で置く。**ヘッダの値に非 ASCII を入れられない**
 * （`Headers` は値を ByteString に変換するため）。先行 `StockItemRoutes.test.ts` と同じ。
 */
const accessTokenA = 'access-token-a';

/** 時計が返す基準日時。UTC の正準形（B-48b 設計書 10章の前提）。 */
const nineOClock = '2026-09-23T09:00:00.000Z';
const tenOClock = '2026-09-23T10:00:00.000Z';

/** 要求から基準日時を受け取れてしまったら現れる値。時計の値と区別できるように離しておく。 */
const requestedAsOf = '2020-01-01T00:00:00.000Z';

/** 既定の提案が返す、提案できた結末。名称順でない2件を並べる（規則5: 並びを保つ）。 */
const suggestedOutput: SuggestMealsOutput = {
  outcome: 'suggested',
  suggestion: {
    id: '33333333-3333-4333-8333-333333333333',
    generatedAt: '2026-09-23T08:59:00.000Z',
    entries: [
      {
        mealId: '44444444-4444-4444-8444-444444444444',
        origin: 'reused',
        title: '豚汁',
        ingredients: [
          { name: '豚肉', kind: 'main', amount: '200g' },
          { name: 'みそ', kind: 'seasoning', amount: null },
        ],
        steps: ['豚肉を炒める', 'みそを溶く'],
        coverage: {
          covered: [{ name: '豚肉', kind: 'main', amount: '200g', expiryDate: '2026-09-25' }],
          missing: [{ name: 'みそ', kind: 'seasoning', amount: null }],
        },
      },
      {
        mealId: '55555555-5555-4555-8555-555555555555',
        origin: 'generated',
        title: 'かぼちゃの煮物',
        ingredients: [{ name: 'かぼちゃ', kind: 'main', amount: '1/4個' }],
        steps: ['かぼちゃを煮る'],
        coverage: {
          covered: [{ name: 'かぼちゃ', kind: 'main', amount: '1/4個', expiryDate: null }],
          missing: [],
        },
      },
    ],
  },
};

/** 新しい献立を求める経路が返す結末。既定の提案とは別の中身にする（取り違えを見分けるため）。 */
const newMealsOutput: SuggestMealsOutput = {
  outcome: 'suggested',
  suggestion: {
    id: '66666666-6666-4666-8666-666666666666',
    generatedAt: '2026-09-23T09:00:00.000Z',
    entries: [
      {
        mealId: '77777777-7777-4777-8777-777777777777',
        origin: 'generated',
        title: 'にんじんのきんぴら',
        ingredients: [
          { name: 'にんじん', kind: 'main', amount: '1本' },
          { name: 'しょうゆ', kind: 'seasoning', amount: '大さじ1' },
        ],
        steps: ['にんじんを細く切る', 'しょうゆで炒める'],
        coverage: {
          covered: [{ name: 'にんじん', kind: 'main', amount: '1本', expiryDate: '2026-09-24' }],
          missing: [{ name: 'しょうゆ', kind: 'seasoning', amount: '大さじ1' }],
        },
      },
    ],
  },
};

/**
 * 保存済みの提案を読み取り専用で返す経路の結末（B-58）。**上の2つとまた別の中身**にして、
 * 経路の取り違えを見分けられるようにする。`pantryChanged` を載せるのはこの経路だけ。
 */
const latestOutput: ShowLatestSuggestionOutput = {
  outcome: 'suggested',
  pantryChanged: true,
  suggestion: {
    id: '88888888-8888-4888-8888-888888888888',
    generatedAt: '2026-09-22T09:00:00.000Z',
    entries: [
      {
        mealId: '99999999-9999-4999-8999-999999999999',
        origin: 'reused',
        title: 'キャベツの塩炒め',
        ingredients: [{ name: 'キャベツ', kind: 'main', amount: '1/4玉' }],
        steps: ['キャベツを炒める'],
        coverage: {
          covered: [{ name: 'キャベツ', kind: 'main', amount: '1/4玉', expiryDate: '2026-09-26' }],
          missing: [],
        },
      },
    ],
  },
};

/**
 * 時計の代役。**呼ばれるたびに与えた列から次の値を返す**（`docs/testing.md` 5章 — 現在時刻に
 * 触れない）。用意した数より多く読まれたら投げる — 足りないまま緑にしないため。
 */
function sequentialClock(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) {
      throw new Error(`用意した時刻が尽きた（用意したのは ${values.length} 件）`);
    }
    return value;
  };
}

/**
 * 2つの入口と世帯の特定と時計を代役で組み、経路を1つ作る。
 * テストの本題でない結線をここに隠す（`docs/testing.md` 6章）。
 *
 * 失敗の写像を見るときは `〜Throws` を渡す。**投げる例外と返す値は同時に渡せない** —
 * 代役の応答がどちらか一方であるため。
 */
function setUp(
  overrides: {
    suggestOutput?: SuggestMealsOutput;
    suggestThrows?: Error;
    newMealsOutput?: SuggestMealsOutput;
    newMealsThrows?: Error;
    identifyHouseholdThrows?: Error;
    clockValues?: readonly string[];
    latestOutput?: ShowLatestSuggestionOutput;
    latestThrows?: Error;
  } = {},
) {
  const identifyHousehold = new FixedIdentifyHousehold(
    overrides.identifyHouseholdThrows === undefined
      ? { returns: ourHousehold }
      : { throws: overrides.identifyHouseholdThrows },
  );
  const suggestMeals = new FixedSuggestMeals(
    overrides.suggestThrows === undefined
      ? { returns: overrides.suggestOutput ?? suggestedOutput }
      : { throws: overrides.suggestThrows },
  );
  const suggestNewMeals = new FixedSuggestNewMeals(
    overrides.newMealsThrows === undefined
      ? { returns: overrides.newMealsOutput ?? newMealsOutput }
      : { throws: overrides.newMealsThrows },
  );

  const showLatestSuggestion = new FixedShowLatestSuggestion(
    overrides.latestThrows === undefined
      ? { returns: overrides.latestOutput ?? latestOutput }
      : { throws: overrides.latestThrows },
  );

  const logLines: string[] = [];

  const routes = createSuggestionRoutes({
    identifyHousehold: identifyHousehold.identify,
    suggestMeals: suggestMeals.suggest,
    suggestNewMeals: suggestNewMeals.suggest,
    showLatestSuggestion: showLatestSuggestion.show,
    now: sequentialClock(...(overrides.clockValues ?? [nineOClock])),
    writeLog: (line) => logLines.push(line),
  });

  return {
    routes,
    identifyHousehold,
    suggestMeals,
    suggestNewMeals,
    showLatestSuggestion,
    logLines,
  };
}

/** 認証ヘッダ1つ。方式名と値の組み立てが本題のときだけ引数で上書きする。 */
function authorizationHeaders(value: string = `Bearer ${accessTokenA}`): Record<string, string> {
  return { Authorization: value };
}

/** 本体を持たない POST。この2経路は本体を読まない（規則3）。 */
function postRequest(headers: Record<string, string> = authorizationHeaders()) {
  return { method: 'POST', headers };
}

/** 本体を JSON で送る POST。本体の項目を見ないこと（規則3・4）を確かめるときに使う。 */
function jsonPostRequest(body: unknown, headers = authorizationHeaders()) {
  return {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * 本体を文字列のまま送る POST。**JSON として読めない本体**を渡すときに使う
 * （`JSON.stringify` を通すと必ず読める本体になってしまう）。
 */
function rawBodyPostRequest(body: string, headers = authorizationHeaders()) {
  return {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body,
  };
}

/** JSON として読めればその値、読めなければ読めた文字列そのものを返す。 */
function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * 応答本体を読む。引数の型を `Response` と書かないのは、このテストのプロジェクトが
 * 実行環境の型を入れていないためである（先行 `StockItemRoutes.test.ts` と同じ）。
 */
async function responseBody(response: { text(): Promise<string> }): Promise<unknown> {
  return parseBody(await response.text());
}

/** 規則違反に似せた別の例外。`name` が違うものを規則違反として扱わないことを確かめる（ADR-032）。 */
function ruleViolationLike(rule: string, message: string): Error {
  const error = new Error(message);
  error.name = 'OtherRuleViolation';
  return Object.assign(error, { rule });
}

/** `name` だけが献立の規則違反で、`rule` を持たない例外。 */
function mealRuleViolationWithoutRule(message: string): Error {
  const error = new Error(message);
  error.name = 'MealRuleViolation';
  return error;
}

function accessTokenInvalid(): IdentityRuleViolation {
  return new IdentityRuleViolation('accessToken.invalid', 'アクセストークンが検証を通らない');
}

describe('提案の経路 SuggestionRoutes', () => {
  describe('経路の配置と取り違え', () => {
    it('既定の提案 POST /suggestions は提案を求めて 200 を返す', async () => {
      // 規則1 / FR-16 / ADR-048 決定4: 接頭辞なしの POST。
      const { routes, suggestMeals } = setUp();

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(200);
      expect(suggestMeals.callCount).toBe(1);
    });

    it('既定の提案は新しい献立を求める入口を呼ばない', async () => {
      // ADR-051 決定2: 既定の口が明示操作を兼ねない。
      const { routes, suggestNewMeals } = setUp();

      await routes.request('/suggestions', postRequest());

      expect(suggestNewMeals.callCount).toBe(0);
    });

    it('新しい献立を求める POST /suggestions/new-meals は 200 を返す', async () => {
      // 規則1 / FR-36。
      const { routes } = setUp();

      const response = await routes.request('/suggestions/new-meals', postRequest());

      expect(response.status).toBe(200);
    });

    it('新しい献立を求める経路は既定の提案の入口を呼ばない', async () => {
      // FR-21 / ADR-051: 明示操作は再利用に回らない。
      const { routes, suggestMeals } = setUp();

      await routes.request('/suggestions/new-meals', postRequest());

      expect(suggestMeals.callCount).toBe(0);
    });

    it('GET /suggestions では提案を求めない', async () => {
      // 規則1 / ADR-062 決定1: 副作用と費用のある操作を安全な method に載せない。
      // 状態コードは見ない — ADR-062 は GET に何を返すかを決めていない。
      const { routes, suggestMeals } = setUp();

      await routes.request('/suggestions', { headers: authorizationHeaders() });

      expect(suggestMeals.callCount).toBe(0);
    });
  });

  describe('世帯の受け渡し', () => {
    it('既定の提案は認証で定まった世帯をユースケースの第1引数に渡す', async () => {
      // C-9: 世帯は提示されたアクセストークンからだけ定まる。
      const { routes, suggestMeals } = setUp();

      await routes.request('/suggestions', postRequest());

      expect(suggestMeals.receivedHouseholdId).toBe(ourHousehold);
    });

    it('新しい献立を求める経路は認証で定まった世帯をユースケースの第1引数に渡す', async () => {
      // C-9。
      const { routes, suggestNewMeals } = setUp();

      await routes.request('/suggestions/new-meals', postRequest());

      expect(suggestNewMeals.receivedHouseholdId).toBe(ourHousehold);
    });

    it('既定の提案は要求本体の householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      // C-9 / 規則3: 要求から世帯を読める道を作らない。
      const { routes, suggestMeals } = setUp();

      await routes.request('/suggestions', jsonPostRequest({ householdId: neighborHousehold }));

      expect(suggestMeals.receivedHouseholdId).toBe(ourHousehold);
    });

    it('新しい献立を求める経路は要求本体の householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      // C-9 / 規則3。
      const { routes, suggestNewMeals } = setUp();

      await routes.request(
        '/suggestions/new-meals',
        jsonPostRequest({ householdId: neighborHousehold }),
      );

      expect(suggestNewMeals.receivedHouseholdId).toBe(ourHousehold);
    });

    it('既定の提案はクエリの householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      // C-9 / 規則3: クエリも読まない。
      const { routes, suggestMeals } = setUp();

      await routes.request(`/suggestions?householdId=${neighborHousehold}`, postRequest());

      expect(suggestMeals.receivedHouseholdId).toBe(ourHousehold);
    });
  });

  describe('検査の順序', () => {
    it('認証を通らない既定の提案は提案を求めない', async () => {
      // 規則2 / NFR-09: **呼ばれないこと自体が要件**である（`docs/testing.md` 2章の例外）。
      const { routes, suggestMeals } = setUp({ identifyHouseholdThrows: accessTokenInvalid() });

      await routes.request('/suggestions', postRequest());

      expect(suggestMeals.callCount).toBe(0);
    });

    it('認証を通らない新しい献立の要求は生成を求めない', async () => {
      // 規則2 / NFR-09 / NFR-C2: 認証を通らない要求で費用を使わない。
      const { routes, suggestNewMeals } = setUp({ identifyHouseholdThrows: accessTokenInvalid() });

      await routes.request('/suggestions/new-meals', postRequest());

      expect(suggestNewMeals.callCount).toBe(0);
    });

    it('認証を通らない既定の提案は 401 を返す', async () => {
      // 規則2 / ADR-032。
      const { routes } = setUp({ identifyHouseholdThrows: accessTokenInvalid() });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(401);
    });
  });

  describe('要求の本体を読まない', () => {
    it('既定の提案は本体が JSON として読めなくても 200 を返す', async () => {
      // 規則3: この2経路は本体を読まないので、`request.*` の断りを持たない。
      const { routes } = setUp();

      const response = await routes.request('/suggestions', rawBodyPostRequest('{not json'));

      expect(response.status).toBe(200);
    });

    it('新しい献立を求める経路は本体が JSON として読めなくても 200 を返す', async () => {
      // 規則3。
      const { routes } = setUp();

      const response = await routes.request(
        '/suggestions/new-meals',
        rawBodyPostRequest('{not json'),
      );

      expect(response.status).toBe(200);
    });
  });

  describe('基準日時', () => {
    it('既定の提案はサーバの時刻から得た基準日時をユースケースの第2引数に渡す', async () => {
      // 規則4 / ADR-049 決定2: 基準日時は deps.now() から得る。
      const { routes, suggestMeals } = setUp({ clockValues: [nineOClock] });

      await routes.request('/suggestions', postRequest());

      expect(suggestMeals.receivedAsOf).toBe('2026-09-23T09:00:00.000Z');
    });

    it('新しい献立を求める経路はサーバの時刻から得た基準日時をユースケースの第2引数に渡す', async () => {
      // 規則4 / ADR-049 決定2。
      const { routes, suggestNewMeals } = setUp({ clockValues: [nineOClock] });

      await routes.request('/suggestions/new-meals', postRequest());

      expect(suggestNewMeals.receivedAsOf).toBe('2026-09-23T09:00:00.000Z');
    });

    it('本体やクエリの asOf を見ず、サーバの時刻から得た基準日時だけを渡す', async () => {
      // 規則4 / ADR-062 理由(4): 受け取ると24時間の窓と期限切れの判定を利用者が動かせる。
      const { routes, suggestMeals } = setUp({ clockValues: [nineOClock] });

      await routes.request(
        `/suggestions?asOf=${requestedAsOf}`,
        jsonPostRequest({ asOf: requestedAsOf }),
      );

      expect(suggestMeals.receivedAsOf).toBe('2026-09-23T09:00:00.000Z');
    });

    it('基準日時は要求ごとに時刻を読み直す', async () => {
      // 規則4: 1要求につき1回読む。経路を作ったときに読んだ値を使い回さない。
      const { routes, suggestMeals } = setUp({ clockValues: [nineOClock, tenOClock] });

      await routes.request('/suggestions', postRequest());
      await routes.request('/suggestions', postRequest());

      expect(suggestMeals.receivedAsOf).toBe('2026-09-23T10:00:00.000Z');
    });
  });

  describe('3つの結末', () => {
    it('提案できた結末は 200 を返す', async () => {
      // 規則5 / ADR-041 / ADR-062 決定2。
      const { routes } = setUp({ suggestOutput: suggestedOutput });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(200);
    });

    it('提案できた結末の応答本体はユースケースの出力そのままである', async () => {
      // 規則5 / ADR-003: 詰め替えも整形もしない。提案の1件の並びも保つ。
      const { routes } = setUp({ suggestOutput: suggestedOutput });

      const response = await routes.request('/suggestions', postRequest());

      await expect(responseBody(response)).resolves.toEqual({
        outcome: 'suggested',
        suggestion: {
          id: '33333333-3333-4333-8333-333333333333',
          generatedAt: '2026-09-23T08:59:00.000Z',
          entries: [
            {
              mealId: '44444444-4444-4444-8444-444444444444',
              origin: 'reused',
              title: '豚汁',
              ingredients: [
                { name: '豚肉', kind: 'main', amount: '200g' },
                { name: 'みそ', kind: 'seasoning', amount: null },
              ],
              steps: ['豚肉を炒める', 'みそを溶く'],
              coverage: {
                covered: [{ name: '豚肉', kind: 'main', amount: '200g', expiryDate: '2026-09-25' }],
                missing: [{ name: 'みそ', kind: 'seasoning', amount: null }],
              },
            },
            {
              mealId: '55555555-5555-4555-8555-555555555555',
              origin: 'generated',
              title: 'かぼちゃの煮物',
              ingredients: [{ name: 'かぼちゃ', kind: 'main', amount: '1/4個' }],
              steps: ['かぼちゃを煮る'],
              coverage: {
                covered: [{ name: 'かぼちゃ', kind: 'main', amount: '1/4個', expiryDate: null }],
                missing: [],
              },
            },
          ],
        },
      });
    });

    it('在庫が足りない結末は 200 を返す', async () => {
      // 規則5 / ADR-041 / ADR-062 決定2: S-4 は失敗でも規則違反でもない。
      const { routes } = setUp({ suggestOutput: { outcome: 'insufficientStockItems' } });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(200);
    });

    it('在庫が足りない結末の応答本体は outcome だけを持つ', async () => {
      // 規則5 / ADR-041 決定1。
      const { routes } = setUp({ suggestOutput: { outcome: 'insufficientStockItems' } });

      const response = await routes.request('/suggestions', postRequest());

      await expect(responseBody(response)).resolves.toEqual({
        outcome: 'insufficientStockItems',
      });
    });

    it('上限に達した結末は 200 を返す', async () => {
      // 規則5 / ADR-049 結果5 / ADR-062 決定2: S-7 も 4xx にしない。
      const { routes } = setUp({ suggestOutput: { outcome: 'generationLimitReached' } });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(200);
    });

    it('上限に達した結末の応答本体は outcome だけを持つ', async () => {
      // 規則5 / ADR-049 結果5。
      const { routes } = setUp({ suggestOutput: { outcome: 'generationLimitReached' } });

      const response = await routes.request('/suggestions', postRequest());

      await expect(responseBody(response)).resolves.toEqual({
        outcome: 'generationLimitReached',
      });
    });

    it('在庫に食材が無い結末は 200 を返す', async () => {
      // ADR-091 決定4 / ADR-041 決定1: S-9 は失敗でも規則違反でもない。
      const { routes } = setUp({ suggestOutput: { outcome: 'noIngredientInPantry' } });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(200);
    });

    it('新しい献立を求める経路の応答本体はユースケースの出力そのままである', async () => {
      // 規則5 / FR-36: 既定の提案とは別の中身を返させ、どちらの出力かを見分ける。
      const { routes } = setUp({ newMealsOutput });

      const response = await routes.request('/suggestions/new-meals', postRequest());

      await expect(responseBody(response)).resolves.toEqual({
        outcome: 'suggested',
        suggestion: {
          id: '66666666-6666-4666-8666-666666666666',
          generatedAt: '2026-09-23T09:00:00.000Z',
          entries: [
            {
              mealId: '77777777-7777-4777-8777-777777777777',
              origin: 'generated',
              title: 'にんじんのきんぴら',
              ingredients: [
                { name: 'にんじん', kind: 'main', amount: '1本' },
                { name: 'しょうゆ', kind: 'seasoning', amount: '大さじ1' },
              ],
              steps: ['にんじんを細く切る', 'しょうゆで炒める'],
              coverage: {
                covered: [
                  { name: 'にんじん', kind: 'main', amount: '1本', expiryDate: '2026-09-24' },
                ],
                missing: [{ name: 'しょうゆ', kind: 'seasoning', amount: '大さじ1' }],
              },
            },
          ],
        },
      });
    });

    it('新しい献立を求める経路でも上限に達した結末は 200 を返す', async () => {
      // 規則5 / ADR-049 結果7: 明示操作にも1日の上限が当たる。
      const { routes } = setUp({ newMealsOutput: { outcome: 'generationLimitReached' } });

      const response = await routes.request('/suggestions/new-meals', postRequest());

      expect(response.status).toBe(200);
      await expect(responseBody(response)).resolves.toEqual({
        outcome: 'generationLimitReached',
      });
    });
  });

  describe('断った結末のログ', () => {
    it('在庫が足りない結末はログに1行残す', async () => {
      const { routes, logLines } = setUp({ suggestOutput: { outcome: 'insufficientStockItems' } });

      await routes.request('/suggestions', postRequest());

      expect(logLines).toEqual(['api.suggestion.declined insufficientStockItems']);
    });

    it('上限に達した結末はログに1行残す', async () => {
      const { routes, logLines } = setUp({ suggestOutput: { outcome: 'generationLimitReached' } });

      await routes.request('/suggestions', postRequest());

      expect(logLines).toEqual(['api.suggestion.declined generationLimitReached']);
    });

    it('新しい献立を求める経路でも上限に達した結末はログに1行残す', async () => {
      const { routes, logLines } = setUp({
        newMealsOutput: { outcome: 'generationLimitReached' },
      });

      await routes.request('/suggestions/new-meals', postRequest());

      expect(logLines).toEqual(['api.suggestion.declined generationLimitReached']);
    });

    it('在庫に食材が無い結末はログに1行残す', async () => {
      // ADR-091 決定4 / ADR-062 決定2: 在庫品の名称は出さない
      const { routes, logLines } = setUp({ suggestOutput: { outcome: 'noIngredientInPantry' } });

      await routes.request('/suggestions', postRequest());

      expect(logLines).toEqual(['api.suggestion.declined noIngredientInPantry']);
    });

    it('提案できた結末はログに残さない', async () => {
      const { routes, logLines } = setUp();

      await routes.request('/suggestions', postRequest());

      expect(logLines).toEqual([]);
    });
  });

  describe('認証ヘッダの入口', () => {
    it('Authorization の Bearer の後ろの値をアクセストークンとして渡す', async () => {
      // 規則10 / C-9 / NFR-09。
      const { routes, identifyHousehold } = setUp();

      await routes.request('/suggestions', postRequest());

      expect(identifyHousehold.receivedAccessToken).toBe('access-token-a');
    });

    it('方式名が小文字の bearer でも世帯を定めて提案を返す', async () => {
      // 規則10: 方式名の照合は大小を区別しない。
      const { routes, identifyHousehold } = setUp();

      const response = await routes.request(
        '/suggestions',
        postRequest(authorizationHeaders(`bearer ${accessTokenA}`)),
      );

      expect(response.status).toBe(200);
      expect(identifyHousehold.receivedAccessToken).toBe('access-token-a');
    });

    it('アクセストークンの中の空白を落とさずにそのまま渡す', async () => {
      // 規則10: 正規化は腐敗防止層の仕事であり、api は加工しない。
      const { routes, identifyHousehold } = setUp();

      await routes.request(
        '/suggestions',
        postRequest(authorizationHeaders('Bearer access token a')),
      );

      expect(identifyHousehold.receivedAccessToken).toBe('access token a');
    });

    it('Bearer と値の区切りは最初の1空白とする', async () => {
      // 規則10: 区切りを「連続する空白」と読むと、api が正規化を1つ持つことになる。
      const { routes, identifyHousehold } = setUp();

      await routes.request(
        '/suggestions',
        postRequest(authorizationHeaders(`Bearer  ${accessTokenA}`)),
      );

      expect(identifyHousehold.receivedAccessToken).toBe(' access-token-a');
    });

    it('Authorization ヘッダが無い要求は 401 を返す', async () => {
      // 規則10 / NFR-09: api は独自に断らず空文字を渡し、断るのは世帯を定める側である。
      const { routes } = setUp();

      const response = await routes.request('/suggestions', postRequest({}));

      expect(response.status).toBe(401);
    });

    it('方式が Bearer でない要求は 401 を返す', async () => {
      // 規則10: 方式が違えば空文字を渡す。
      const { routes } = setUp();

      const response = await routes.request(
        '/suggestions',
        postRequest(authorizationHeaders('Basic YWJj')),
      );

      expect(response.status).toBe(401);
    });

    it('方式名だけで値の無いヘッダの要求は 401 を返す', async () => {
      // 規則10: 値が無ければ空文字を渡す。
      const { routes } = setUp();

      const response = await routes.request(
        '/suggestions',
        postRequest(authorizationHeaders('Bearer')),
      );

      expect(response.status).toBe(401);
    });

    it('新しい献立を求める経路もヘッダが無ければ 401 を返す', async () => {
      // 規則10: 2経路で同じ規則を守る。
      const { routes } = setUp();

      const response = await routes.request('/suggestions/new-meals', postRequest({}));

      expect(response.status).toBe(401);
    });
  });

  describe('献立の規則違反の写像', () => {
    it('生成結果が0件で断られた既定の提案は 502 を返す', async () => {
      // 規則7 / NFR-07 / ADR-062 決定3: 上流が使える応答を返さなかったことを示す。
      const { routes } = setUp({
        suggestThrows: new MealRuleViolation('mealGenerator.empty', '生成結果が0件'),
      });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(502);
    });

    it('生成結果が0件で断られた新しい献立の要求は 502 を返す', async () => {
      // 規則7 / NFR-07。
      const { routes } = setUp({
        newMealsThrows: new MealRuleViolation('mealGenerator.empty', '生成結果が0件'),
      });

      const response = await routes.request('/suggestions/new-meals', postRequest());

      expect(response.status).toBe(502);
    });

    it('生成結果が0件の断りは応答本体の rule で mealGenerator.empty と読める', async () => {
      // 規則8 / ADR-032 決定3: 画面は rule で S-6 と読む。
      const { routes } = setUp({
        suggestThrows: new MealRuleViolation('mealGenerator.empty', '生成結果が0件'),
      });

      const response = await routes.request('/suggestions', postRequest());

      await expect(responseBody(response)).resolves.toEqual({ rule: 'mealGenerator.empty' });
    });

    it('世帯の食い違いで保存を拒まれたときは 500 を返し rule を載せる', async () => {
      // 規則7 / C-9: 呼び出し側の誤りであり、利用者の入力ではない。
      const { routes } = setUp({
        suggestThrows: new MealRuleViolation('save.householdMismatch', '世帯が食い違う'),
      });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'save.householdMismatch' });
    });

    it('保存済みの献立と中身が食い違って拒まれたときは 500 を返し rule を載せる', async () => {
      // 規則7 / C-3。
      const { routes } = setUp({
        suggestThrows: new MealRuleViolation('save.contentMismatch', '保存済みの献立と食い違う'),
      });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'save.contentMismatch' });
    });

    it('在庫に食材が無いという規則違反が上がってきたら 500 を返し rule を載せる', async () => {
      // ADR-091 決定3 / ADR-062 決定3: ユースケースが受け止めるはずの規則違反であり、
      // 上がってきたら写像の表に無いものとして扱う（表に行を足さない）。
      const { routes } = setUp({
        suggestThrows: new MealRuleViolation('mealGenerator.noIngredient', '在庫に食材が無い'),
      });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({
        rule: 'mealGenerator.noIngredient',
      });
    });

    it('表に無い献立の規則違反は 400 ではなく 500 を返し rule を載せる', async () => {
      // 規則7 / ADR-062 決定3: この2経路は利用者の入力を受け取らないので、既定を 400 にしない。
      const { routes } = setUp({
        suggestThrows: new MealRuleViolation('suggestion.entries.empty', '提案の1件が無い'),
      });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'suggestion.entries.empty' });
    });
  });

  describe('認証の規則違反の写像', () => {
    it('アクセストークンが提示されていない既定の提案は 401 を返す', async () => {
      // 規則6 / ADR-032: 認証の規則違反は一律 401。
      const { routes } = setUp({
        identifyHouseholdThrows: new IdentityRuleViolation(
          'accessToken.missing',
          'アクセストークンが提示されていない',
        ),
      });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(401);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'accessToken.missing' });
    });

    it('アクセストークンが検証を通らない新しい献立の要求は 401 を返す', async () => {
      // 規則6 / ADR-032。
      const { routes } = setUp({ identifyHouseholdThrows: accessTokenInvalid() });

      const response = await routes.request('/suggestions/new-meals', postRequest());

      expect(response.status).toBe(401);
    });

    it('表に無い認証の規則違反も 401 を返す', async () => {
      // 規則6: 認証の規則違反は列挙を持たず、表に無い rule も 401 に落とす。
      const { routes } = setUp({
        identifyHouseholdThrows: new IdentityRuleViolation(
          'accessToken.unknownRule',
          '表に無い認証の規則違反',
        ),
      });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(401);
    });

    it('世帯の特定で起きた認証でない失敗は 401 に化けない', async () => {
      // ADR-045: サーバ側の不備を利用者のアクセストークンのせいにしない。
      const { routes } = setUp({ identifyHouseholdThrows: new Error('鍵の設定が無い') });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });
  });

  describe('規則違反として読まないもの', () => {
    it('在庫の規則違反は献立の経路で規則違反として扱わない', async () => {
      // 規則6: 献立の経路が読むのは MealRuleViolation と IdentityRuleViolation だけ。
      const { routes } = setUp({
        suggestThrows: new PantryRuleViolation('name.empty', '名称が空である'),
      });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('規則違反に似せた別の name の例外を規則違反として扱わない', async () => {
      // 規則6 / ADR-032 決定2・結果2: 見分けるのは name である。502 に化けさせない。
      const { routes } = setUp({
        suggestThrows: ruleViolationLike('mealGenerator.empty', '生成結果が0件'),
      });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('name が MealRuleViolation でも rule を持たない例外は規則違反として扱わない', async () => {
      // 規則6: name と rule の両方がそろったものだけを規則違反として読む。
      const { routes } = setUp({
        suggestThrows: mealRuleViolationWithoutRule('rule を持たない'),
      });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });
  });

  describe('写せない失敗', () => {
    it('既定の提案で規則違反でない失敗が起きたら 500 の unexpected を返す', async () => {
      // 規則9 / ADR-061 決定1 / ADR-045 決定3: 指す献立が引けないなどの素の Error。
      const { routes } = setUp({ suggestThrows: new Error('指す献立が引けない') });

      const response = await routes.request('/suggestions', postRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('新しい献立の要求で規則違反でない失敗が起きたら 500 の unexpected を返す', async () => {
      // 規則9: 生成の呼び出しの失敗も同じく畳む。
      const { routes } = setUp({ newMealsThrows: new Error('生成の呼び出しに失敗') });

      const response = await routes.request('/suggestions/new-meals', postRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });
  });

  describe('応答本体に載せないもの', () => {
    it('失敗の応答本体は rule だけを持つ', async () => {
      // 規則8 / ADR-032 決定3: 文言は載せない — 画面が rule から選ぶ。
      const { routes } = setUp({
        suggestThrows: new MealRuleViolation('mealGenerator.empty', '生成結果が0件'),
      });

      const response = await routes.request('/suggestions', postRequest());

      const body = (await responseBody(response)) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(['rule']);
    });

    it('写せない失敗の 500 の応答本体に例外の message を載せない', async () => {
      // 規則9 / NFR-09: 接続先が応答に出てはならない。
      const { routes } = setUp({
        suggestThrows: new Error('postgres://user:pw@host に繋がらない'),
      });

      const response = await routes.request('/suggestions', postRequest());

      const text = await response.text();
      expect(parseBody(text)).toEqual({ rule: 'unexpected' });
      expect(text).not.toContain('postgres');
    });

    it('献立の規則違反の 500 の応答本体に例外の message を載せない', async () => {
      // 規則8 / NFR-09: message に入った世帯の目印を応答に出さない。
      const { routes } = setUp({
        suggestThrows: new MealRuleViolation('save.householdMismatch', 'h-other の世帯と食い違う'),
      });

      const response = await routes.request('/suggestions', postRequest());

      const text = await response.text();
      expect(parseBody(text)).toEqual({ rule: 'save.householdMismatch' });
      expect(text).not.toContain('h-other');
    });
  });
  describe('保存済みの提案を読み取り専用で返す経路（B-58）', () => {
    it('GET /suggestions/latest は保存済みの提案を求めて 200 を返す', async () => {
      const { routes, showLatestSuggestion } = setUp();

      const response = await routes.request('/suggestions/latest', {
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(200);
      expect(showLatestSuggestion.callCount).toBe(1);
    });

    it('読み取り専用の経路は提案の2つの入口をどちらも呼ばない', async () => {
      // 読み取りが生成を起こしてしまえば、NFR-C2 の枠を利用者の求めなしに消費する。
      const { routes, suggestMeals, suggestNewMeals } = setUp();

      await routes.request('/suggestions/latest', { headers: authorizationHeaders() });

      expect(suggestMeals.callCount).toBe(0);
      expect(suggestNewMeals.callCount).toBe(0);
    });

    it('応答本体はユースケースの出力そのままである', async () => {
      const { routes } = setUp();

      const response = await routes.request('/suggestions/latest', {
        headers: authorizationHeaders(),
      });

      await expect(response.json()).resolves.toEqual(latestOutput);
    });

    it('保存済みの提案が無い結末も 200 で outcome だけを返す', async () => {
      const { routes } = setUp({ latestOutput: { outcome: 'none' } });

      const response = await routes.request('/suggestions/latest', {
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ outcome: 'none' });
    });

    it('認証で定まった世帯をユースケースの第1引数に渡す', async () => {
      const { routes, showLatestSuggestion } = setUp();

      await routes.request('/suggestions/latest', { headers: authorizationHeaders() });

      expect(showLatestSuggestion.receivedHouseholdId).toBe(ourHousehold);
    });

    it('クエリの householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      const { routes, showLatestSuggestion } = setUp();

      await routes.request(`/suggestions/latest?householdId=${neighborHousehold}`, {
        headers: authorizationHeaders(),
      });

      expect(showLatestSuggestion.receivedHouseholdId).toBe(ourHousehold);
    });

    it('認証を通らない要求は保存済みの提案を求めない', async () => {
      const { routes, showLatestSuggestion } = setUp({
        identifyHouseholdThrows: new IdentityRuleViolation(
          'accessToken.invalid',
          'アクセストークンが検証を通らない',
        ),
      });

      await routes.request('/suggestions/latest', { headers: authorizationHeaders() });

      expect(showLatestSuggestion.callCount).toBe(0);
    });

    it('Authorization ヘッダが無い要求は 401 を返す', async () => {
      const { routes } = setUp({
        identifyHouseholdThrows: new IdentityRuleViolation(
          'accessToken.missing',
          'アクセストークンが無い',
        ),
      });

      const response = await routes.request('/suggestions/latest');

      expect(response.status).toBe(401);
    });

    it('規則違反でない失敗が起きたら 500 の unexpected を返す', async () => {
      const { routes } = setUp({ latestThrows: new Error('接続が切れた') });

      const response = await routes.request('/suggestions/latest', {
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ rule: 'unexpected' });
    });

    it('指す献立が引けない失敗も 401 に化けない', async () => {
      // ADR-045: サーバ側の不備を利用者のアクセストークンのせいにしない。
      const { routes } = setUp({ latestThrows: new Error('提案の指す献立が引けない') });

      const response = await routes.request('/suggestions/latest', {
        headers: authorizationHeaders(),
      });

      expect(response.status).not.toBe(401);
    });

    it('時計を読まない', async () => {
      // 時刻に依存する判断を1つも持たない経路である（B-58）。用意した時刻を使い切らない。
      const { routes } = setUp({ clockValues: [] });

      const response = await routes.request('/suggestions/latest', {
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(200);
    });
  });
});
