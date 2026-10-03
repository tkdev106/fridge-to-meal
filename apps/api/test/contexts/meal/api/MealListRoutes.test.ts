import { describe, expect, it } from 'vitest';
import type { ListMealsOutput } from '@fridge-to-meal/contract';
import { createMealListRoutes } from '../../../../src/contexts/meal/api/MealListRoutes.js';
import { IdentityRuleViolation } from '../../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { FixedIdentifyHousehold } from '../../../support/identity/FixedIdentifyHousehold.js';
import { FixedListMeals } from '../../../support/meal/FixedListMeals.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

/**
 * アクセストークンは ASCII で置く。**ヘッダの値に非 ASCII を入れられない**
 * （`Headers` は値を ByteString に変換するため）。先行 `MealRoutes.test.ts` と同じ。
 */
const accessTokenA = 'access-token-a';

/** 献立の一覧。**素通しであること**を見るので、両方の列を空でない形にしておく（規則10）。 */
const listMealsOutput: ListMealsOutput = {
  seen: [
    {
      mealId: '22222222-2222-4222-8222-222222222222',
      title: '肉じゃが',
      ingredientCount: 3,
      generatedAt: '2026-09-14T03:00:00.000Z',
    },
  ],
  cooked: [
    {
      mealId: '33333333-3333-4333-8333-333333333333',
      title: 'きんぴらごぼう',
      ingredientCount: 2,
      cookedAt: '2026-09-20T10:00:00.000Z',
    },
  ],
};

/**
 * 世帯の特定と献立の一覧の口を代役で組み、経路を1つ作る。
 * テストの本題でない結線をここに隠す（`docs/testing.md` 6章）。
 *
 * 失敗の写像を見るときは `〜Throws` を渡す。**投げる例外と返す値は同時に渡せない** —
 * 代役の応答がどちらか一方であるため。
 */
function setUp(
  overrides: {
    throws?: Error;
    identifyHouseholdThrows?: Error;
  } = {},
) {
  const identifyHousehold = new FixedIdentifyHousehold(
    overrides.identifyHouseholdThrows === undefined
      ? { returns: ourHousehold }
      : { throws: overrides.identifyHouseholdThrows },
  );
  const listMeals = new FixedListMeals(
    overrides.throws === undefined ? { returns: listMealsOutput } : { throws: overrides.throws },
  );

  const routes = createMealListRoutes({
    identifyHousehold: identifyHousehold.identify,
    listMeals: listMeals.list,
  });

  return { routes, identifyHousehold, listMeals };
}

const mealsPath = '/meals';

/** 認証ヘッダ1つ。方式名と値の組み立てが本題のときだけ引数で上書きする。 */
function authorizationHeaders(value: string = `Bearer ${accessTokenA}`): Record<string, string> {
  return { Authorization: value };
}

/** 本体を持たない GET の要求。この経路が読むのはヘッダだけである（規則10）。 */
function getRequest(headers = authorizationHeaders()) {
  return { headers };
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
 * 応答本体を読む。引数の型を `Response` と書かないのは、このテストのプロジェクトが
 * 実行環境の型を入れていないためである（先行 `MealRoutes.test.ts` と同じ）。
 */
async function responseBody(response: { text(): Promise<string> }): Promise<unknown> {
  return parseBody(await response.text());
}

/** deps の形。基準日時の口も在庫の口も取らないことを型として主張する（規則9 / C-8）。 */
type MealListRoutesDeps = Parameters<typeof createMealListRoutes>[0];

/** deps のキーが2つだけなら `true`、1つでも他のキーがあれば `never`（代入が型検査で落ちる）。 */
type DepsTakeNeitherClockNorStockItemPort = keyof MealListRoutesDeps extends
  'identifyHousehold' | 'listMeals'
  ? true
  : never;

describe('献立の一覧の経路 MealListRoutes', () => {
  describe('経路の配置', () => {
    it('GET /meals は献立の一覧を 200 で返す', async () => {
      // 規則10 / FR-28: 読み取りだけで費用も副作用も無いので GET に置く。
      const { routes } = setUp();

      const response = await routes.request(mealsPath, getRequest());

      expect(response.status).toBe(200);
    });

    it('ユースケースの出力を詰め替えず素通しする', async () => {
      // 規則10 / 先行 `MealRoutes.ts`: 整形も詰め替えもしない。
      const { routes } = setUp();

      const response = await routes.request(mealsPath, getRequest());

      await expect(responseBody(response)).resolves.toEqual(listMealsOutput);
    });

    it('POST /meals では献立の一覧を返さない', async () => {
      // 規則10 / ADR-065 決定2: 読み取りの口は GET だけである。
      const { routes, listMeals } = setUp();

      const response = await routes.request(mealsPath, {
        method: 'POST',
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(404);
      expect(listMeals.callCount).toBe(0);
    });
  });

  describe('ユースケースへの受け渡し', () => {
    it('認証で定まった世帯をユースケースに渡す', async () => {
      // 規則10 / C-9: 世帯はアクセストークンから定まる。
      const { routes, listMeals } = setUp();

      await routes.request(mealsPath, getRequest());

      expect(listMeals.receivedHouseholdId).toBe(ourHousehold);
    });

    it('クエリの householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      // C-9 / 規則10 / NFR-09: 世帯を利用者の入力から受け取らない。
      const { routes, listMeals } = setUp();

      await routes.request(`${mealsPath}?householdId=${neighborHousehold}`, getRequest());

      expect(listMeals.receivedHouseholdId).toBe(ourHousehold);
    });

    it('本体が JSON として読めなくても献立の一覧を 200 で返す', async () => {
      // 規則10: 本体を1つも読まないので、読めない本体に断りが無い。
      const { routes } = setUp();

      const response = await routes.request(mealsPath, {
        method: 'GET',
        headers: { ...authorizationHeaders(), 'content-type': 'application/json' },
      });

      expect(response.status).toBe(200);
    });

    it('認証が通らない要求には 401 を返し、応答の本体に献立の名称を1つも載せない', async () => {
      // 7章1行目 / 規則10 / NFR-09: 世帯を定めるのが常に先である。
      const { routes } = setUp({
        identifyHouseholdThrows: new IdentityRuleViolation(
          'accessToken.invalid',
          'アクセストークンが検証を通らない',
        ),
      });

      const response = await routes.request(mealsPath, getRequest());

      expect(response.status).toBe(401);
      const text = await response.text();
      expect(Object.keys(parseBody(text) as Record<string, unknown>)).toEqual(['rule']);
      expect(text).not.toContain('肉じゃが');
      expect(text).not.toContain('きんぴらごぼう');
    });

    it('経路の依存に基準日時の口も在庫の口も取らない', () => {
      // 規則9 / C-8: 時刻に依存する判断が1つも無く、在庫を読まない。口を足した時点で
      // この行が typecheck で落ちる（先行 `MealRoutes.test.ts`）。
      const assertion: DepsTakeNeitherClockNorStockItemPort = true;

      expect(assertion).toBe(true);
    });
  });

  describe('アクセストークンの取り出し', () => {
    it('Authorization の Bearer の後ろの値をアクセストークンとして渡す', async () => {
      // ADR-032: 取り出しは `api/AccessToken.ts` の共有のものである。
      const { routes, identifyHousehold } = setUp();

      await routes.request(mealsPath, getRequest());

      expect(identifyHousehold.receivedAccessToken).toBe('access-token-a');
    });

    it('Authorization ヘッダが無い要求は 401 を返す', async () => {
      // 7章1行目 / ADR-032: 判定は `IdentifyHousehold` に残り、api は空文字を渡す。
      const { routes } = setUp();

      const response = await routes.request(mealsPath, {});

      expect(response.status).toBe(401);
    });
  });

  describe('失敗の写像', () => {
    it('表に無い献立の規則違反は 500 を返す', async () => {
      // 7章3行目 / ADR-062 決定3: 表に無い規則は 500。新しい rule は足さない。
      const { routes } = setUp({
        throws: new MealRuleViolation('listMeals.unknownRule', '表に無い規則'),
      });

      const response = await routes.request(mealsPath, getRequest());

      expect(response.status).toBe(500);
    });

    it('規則違反でない失敗が起きたら 500 の unexpected を返す', async () => {
      // 7章3行目 / ADR-045 決定3: 写せない失敗は 500 の unexpected に畳む。
      const { routes } = setUp({ throws: new Error('接続が切れた') });

      const response = await routes.request(mealsPath, getRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('500 の応答本体に例外の message を載せない', async () => {
      // NFR-09 / ADR-045 決定3: 接続文字列や設定の中身が応答に漏れる経路を作らない。
      const { routes } = setUp({ throws: new Error('setsuzoku-moji-retsu-himitsu') });

      const response = await routes.request(mealsPath, getRequest());

      const text = await response.text();
      expect(parseBody(text)).toEqual({ rule: 'unexpected' });
      expect(text).not.toContain('setsuzoku-moji-retsu-himitsu');
    });
  });
});
