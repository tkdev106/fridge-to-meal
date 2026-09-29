import { describe, expect, it } from 'vitest';
import type { ShowMealOutput } from '@fridge-to-meal/contract';
import { createMealRoutes } from '../../../../src/contexts/meal/api/MealRoutes.js';
import { IdentityRuleViolation } from '../../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { FixedIdentifyHousehold } from '../../../support/identity/FixedIdentifyHousehold.js';
import { FixedShowMeal } from '../../../support/meal/FixedShowMeal.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

const idA = mealIdOf('22222222-2222-4222-8222-222222222222');

/**
 * アクセストークンは ASCII で置く。**ヘッダの値に非 ASCII を入れられない**
 * （`Headers` は値を ByteString に変換するため）。先行 `CookingRecordRoutes.test.ts` と同じ。
 */
const accessTokenA = 'access-token-a';

/** 献立1件の出力。**素通しであること**を見るので、中身は空でない形にしておく（規則14）。 */
const mealOutput: ShowMealOutput = {
  mealId: '22222222-2222-4222-8222-222222222222',
  title: '肉じゃが',
  ingredients: [{ name: 'にんじん', kind: 'main', amount: '1本' }],
  steps: ['切る', '煮る'],
  coverage: {
    covered: [{ name: 'にんじん', kind: 'main', amount: '1本', expiryDate: '2026-09-30' }],
    missing: [{ name: '牛肉', kind: 'main', amount: null }],
  },
  cooked: false,
};

/**
 * 世帯の特定と献立詳細の口を代役で組み、経路を1つ作る。
 * テストの本題でない結線をここに隠す（`docs/testing.md` 6章）。
 *
 * 失敗の写像を見るときは `〜Throws` を渡す。**投げる例外と返す値は同時に渡せない** —
 * 代役の応答がどちらか一方であるため。
 */
function setUp(
  overrides: {
    returns?: ShowMealOutput;
    throws?: Error;
    identifyHouseholdThrows?: Error;
  } = {},
) {
  const identifyHousehold = new FixedIdentifyHousehold(
    overrides.identifyHouseholdThrows === undefined
      ? { returns: ourHousehold }
      : { throws: overrides.identifyHouseholdThrows },
  );
  const showMeal = new FixedShowMeal(
    overrides.throws === undefined
      ? { returns: overrides.returns ?? mealOutput }
      : { throws: overrides.throws },
  );

  const routes = createMealRoutes({
    identifyHousehold: identifyHousehold.identify,
    showMeal: showMeal.show,
  });

  return { routes, identifyHousehold, showMeal };
}

/** 経路1本ぶんの道。識別子を上書きするのはそれが本題のときだけである。 */
function mealPath(id: string = idA): string {
  return `/meals/${id}`;
}

/** 認証ヘッダ1つ。方式名と値の組み立てが本題のときだけ引数で上書きする。 */
function authorizationHeaders(value: string = `Bearer ${accessTokenA}`): Record<string, string> {
  return { Authorization: value };
}

/** 本体を持たない GET の要求。この経路が読むのは `:id` とヘッダだけである（規則13）。 */
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
 * 実行環境の型を入れていないためである（先行 `CookingRecordRoutes.test.ts` と同じ）。
 */
async function responseBody(response: { text(): Promise<string> }): Promise<unknown> {
  return parseBody(await response.text());
}

/** deps の形。基準日時の口も在庫の口も取らないことを型として主張する（規則11 / C-8）。 */
type MealRoutesDeps = Parameters<typeof createMealRoutes>[0];

/** deps のキーが2つだけなら `true`、1つでも他のキーがあれば `never`（代入が型検査で落ちる）。 */
type DepsTakeNeitherClockNorStockItemPort = keyof MealRoutesDeps extends
  'identifyHousehold' | 'showMeal'
  ? true
  : never;

describe('献立詳細の経路 MealRoutes', () => {
  describe('経路の配置', () => {
    it('GET /meals/:id は献立1件を 200 で返す', async () => {
      // 規則15 / FR-30: 読み取りだけで費用も副作用も無いので GET に置く。
      const { routes } = setUp();

      const response = await routes.request(mealPath(), getRequest());

      expect(response.status).toBe(200);
    });

    it('ユースケースの出力を詰め替えず素通しする', async () => {
      // 規則14 / B-50b 規則6: 整形も詰め替えもしない。
      const { routes } = setUp();

      const response = await routes.request(mealPath(), getRequest());

      await expect(responseBody(response)).resolves.toEqual(mealOutput);
    });

    it('調理記録の有無 cooked を詰め替えずに応答に載せる', async () => {
      // 規則7 / FR-31 / ADR-070: 標本の既定は偽なので、真が届けば素通しである。
      const { routes } = setUp({ returns: { ...mealOutput, cooked: true } });

      const response = await routes.request(mealPath(), getRequest());

      expect(response.status).toBe(200);
      await expect(responseBody(response)).resolves.toMatchObject({ cooked: true });
    });

    it('POST /meals/:id では献立を返さない', async () => {
      // 規則15 / ADR-065 決定2: 読み取りの口は GET だけである。
      const { routes, showMeal } = setUp();

      const response = await routes.request(mealPath(), {
        method: 'POST',
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(404);
      expect(showMeal.callCount).toBe(0);
    });
  });

  describe('ユースケースへの受け渡し', () => {
    it('認証で定まった世帯を第1引数に渡す', async () => {
      // 規則13 / C-9: 世帯はアクセストークンから定まり、必ず第1引数で渡る。
      const { routes, showMeal } = setUp();

      await routes.request(mealPath(), getRequest());

      expect(showMeal.receivedHouseholdId).toBe(ourHousehold);
    });

    it('経路の識別子を加工せずに第2引数に渡す', async () => {
      // 規則13 / ADR-026 / ADR-032 結果1: 書式も長さも見ない。空白も落とさない。
      const { routes, showMeal } = setUp();

      await routes.request(mealPath('%20m-1%20'), getRequest());

      expect(showMeal.receivedMealId).toBe(mealIdOf(' m-1 '));
    });

    it('クエリの householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      // C-9 / 規則13 / NFR-09: 世帯を利用者の入力から受け取らない。
      const { routes, showMeal } = setUp();

      await routes.request(`${mealPath()}?householdId=${neighborHousehold}`, getRequest());

      expect(showMeal.receivedHouseholdId).toBe(ourHousehold);
    });

    it('本体が JSON として読めなくても献立を 200 で返す', async () => {
      // 規則13: 本体を1つも読まないので、読めない本体に断りが無い。
      const { routes } = setUp();

      const response = await routes.request(mealPath(), {
        method: 'GET',
        headers: { ...authorizationHeaders(), 'content-type': 'application/json' },
      });

      expect(response.status).toBe(200);
    });

    it('認証が通らない要求には 401 を返し、応答の本体に献立の中身を1つも載せない', async () => {
      // 規則13 / NFR-09: 世帯を定めるのが常に先である。
      const { routes } = setUp({
        identifyHouseholdThrows: new IdentityRuleViolation(
          'accessToken.invalid',
          'アクセストークンが検証を通らない',
        ),
      });

      const response = await routes.request(mealPath(), getRequest());

      expect(response.status).toBe(401);
      const text = await response.text();
      expect(Object.keys(parseBody(text) as Record<string, unknown>)).toEqual(['rule']);
      expect(text).not.toContain('肉じゃが');
      expect(text).not.toContain('にんじん');
      expect(text).not.toContain('煮る');
    });

    it('経路の依存に基準日時の口を取らない', () => {
      // 規則11 / C-8: 時刻に依存する判断が1つも無く、在庫にも触れない。口を足した時点で
      // この行が typecheck で落ちる（先行 `CookingRecordRoutes.test.ts`「依存の形」）。
      const assertion: DepsTakeNeitherClockNorStockItemPort = true;

      expect(assertion).toBe(true);
    });
  });

  describe('アクセストークンの取り出し', () => {
    it('Authorization の Bearer の後ろの値をアクセストークンとして渡す', async () => {
      // ADR-032: 取り出しは `api/AccessToken.ts` の共有のものである。
      const { routes, identifyHousehold } = setUp();

      await routes.request(mealPath(), getRequest());

      expect(identifyHousehold.receivedAccessToken).toBe('access-token-a');
    });

    it('Authorization ヘッダが無い要求は 401 を返す', async () => {
      // 7章2行目 / ADR-032: 判定は `IdentifyHousehold` に残り、api は空文字を渡す。
      const { routes } = setUp();

      const response = await routes.request(mealPath(), {});

      expect(response.status).toBe(401);
    });
  });

  describe('失敗の写像', () => {
    it('指した献立がその世帯に無いときは 404 を返し rule を載せる', async () => {
      // 7章1行目 / C-9: 他世帯の献立を指した回も同じ断りである。
      const { routes } = setUp({
        throws: new MealRuleViolation('showMeal.mealNotFound', '指定された献立が見つかりません'),
      });

      const response = await routes.request(mealPath(), getRequest());

      expect(response.status).toBe(404);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'showMeal.mealNotFound' });
    });

    it('見つからない応答の本体に指した識別子も世帯も載せない', async () => {
      // C-9 / NFR-09: `message` に入っていても応答には出さない。
      const { routes } = setUp({
        throws: new MealRuleViolation(
          'showMeal.mealNotFound',
          `世帯 ${ourHousehold} の献立 ${idA} が見つからない`,
        ),
      });

      const response = await routes.request(mealPath(), getRequest());

      const text = await response.text();
      expect(Object.keys(parseBody(text) as Record<string, unknown>)).toEqual(['rule']);
      expect(text).not.toContain(idA);
      expect(text).not.toContain(ourHousehold);
    });

    it('表に無い献立の規則違反は 400 ではなく 500 を返す', async () => {
      // 7章3行目 / ADR-062 決定3: 入力を受け取る経路でも 400 を既定にしない。
      const { routes } = setUp({
        throws: new MealRuleViolation('showMeal.unknownRule', '表に無い規則'),
      });

      const response = await routes.request(mealPath(), getRequest());

      expect(response.status).toBe(500);
    });

    it('規則違反でない失敗が起きたら 500 の unexpected を返す', async () => {
      // 7章4行目 / ADR-045 決定3: 写せない失敗は 500 の unexpected に畳む。
      const { routes } = setUp({ throws: new Error('接続が切れた') });

      const response = await routes.request(mealPath(), getRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('500 の応答本体に例外の message を載せない', async () => {
      // NFR-09 / ADR-045 決定3: 接続文字列や設定の中身が応答に漏れる経路を作らない。
      const { routes } = setUp({ throws: new Error('setsuzoku-moji-retsu-himitsu') });

      const response = await routes.request(mealPath(), getRequest());

      const text = await response.text();
      expect(parseBody(text)).toEqual({ rule: 'unexpected' });
      expect(text).not.toContain('setsuzoku-moji-retsu-himitsu');
    });
  });
});
